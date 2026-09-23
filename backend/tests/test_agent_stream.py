import asyncio
import json

import pytest

pytest.importorskip("agents")
pytest.importorskip("fastapi")

from openai.types.responses import (
    Response,
    ResponseCompletedEvent,
    ResponseReasoningSummaryTextDeltaEvent,
    ResponseTextDeltaEvent,
)
from test_agent_server import ScriptedModel, request_body
from test_analysis_exports import fixture_dataset

from money_graph.agent import (
    ChatRequest,
    answer_preview,
    checked_answer,
    stream_investigation,
)
from money_graph.analysis import analyze
from money_graph.investigation import Investigation, InvestigationStore


@pytest.fixture
def store():
    return InvestigationStore(
        analyze(
            fixture_dataset(
                [(100000000000000001, 100000000000000002, "2026-07-01", 100)],
                seeds={100000000000000001},
                depths={100000000000000002: 4},
            )
        )
    )


class StreamingModel(ScriptedModel):
    def __init__(self):
        super().__init__()
        self.finish = asyncio.Event()
        self.closed = asyncio.Event()

    async def stream_response(
        self,
        system_instructions,
        input,
        model_settings,
        tools,
        output_schema,
        handoffs,
        tracing,
        **kwargs,
    ):
        settings = model_settings
        assert settings.reasoning.effort == "low"
        assert settings.reasoning.summary == "auto"
        response = await self.get_response(
            input=input, model_settings=model_settings, output_schema=output_schema
        )
        for index, delta in enumerate(["Проверяю связи.", "Формирую вывод."]):
            yield ResponseReasoningSummaryTextDeltaEvent(
                type="response.reasoning_summary_text.delta",
                delta=delta,
                item_id=f"reasoning-{self.calls}",
                summary_index=index,
                output_index=0,
                sequence_number=index,
            )
        if response.output[0].type == "message":
            try:
                content = response.output[0].content[0].text
                for index in range(0, len(content), 7):
                    yield ResponseTextDeltaEvent(
                        type="response.output_text.delta",
                        delta=content[index : index + 7],
                        item_id="message-1",
                        content_index=0,
                        output_index=1,
                        sequence_number=index + 2,
                        logprobs=[],
                    )
                await self.finish.wait()
            finally:
                self.closed.set()
        yield ResponseCompletedEvent(
            type="response.completed",
            sequence_number=10000,
            response=Response(
                id=f"response-{self.calls}",
                created_at=0,
                model="scripted",
                object="response",
                output=response.output,
                parallel_tool_calls=False,
                tool_choice="auto",
                tools=[],
                status="completed",
            ),
        )


def test_sdk_streams_reasoning_tools_and_partial_text_before_verified_answer(store):
    async def scenario():
        model = StreamingModel()
        investigation = Investigation(store)
        events = []
        partial = asyncio.Event()

        async def emit(event):
            events.append(event)
            if event["type"] == "answer_preview" and event["summary"]:
                partial.set()

        task = asyncio.create_task(
            stream_investigation(ChatRequest(**request_body(store)), investigation, [], model, emit)
        )
        await asyncio.wait_for(partial.wait(), 2)
        assert not task.done()
        model.finish.set()
        answer, history = await asyncio.wait_for(task, 2)
        result, evidence = checked_answer(answer, investigation)
        previews = [event for event in events if event["type"] == "answer_preview"]
        assert len(previews) > 3
        assert previews[0]["summary"] != result["summary"]
        assert previews[-1]["summary"] == result["summary"]
        assert previews[-1]["findings"] == result["hypotheses"]
        assert result["findings"][0]["text"] not in json.dumps(previews, ensure_ascii=False)
        assert "evidence_ids" not in json.dumps(previews)
        reasoning = "".join(
            event["delta"] for event in events if event["type"] == "reasoning_delta"
        )
        assert reasoning == "\n\n".join(["Проверяю связи.", "Формирую вывод."] * 2)
        tools = [event for event in events if event.get("phase") == "tool"]
        assert [event["state"] for event in tools] == ["started", "completed"]
        assert all(event["tool"] == "trace_seed_paths" for event in tools)
        assert tools[0]["call_id"] == tools[1]["call_id"]
        assert events[-1] == {"type": "status", "phase": "validating"}
        assert evidence[0]["paths"]
        assert any(item.get("type") == "function_call_output" for item in history)
        assert model.closed.is_set()

    asyncio.run(scenario())


def test_cancelling_stream_closes_inflight_sdk_model(store):
    async def scenario():
        model = StreamingModel()
        started = asyncio.Event()

        async def emit(event):
            if event["type"] == "answer_preview":
                started.set()

        task = asyncio.create_task(
            stream_investigation(
                ChatRequest(**request_body(store)), Investigation(store), [], model, emit
            )
        )
        await asyncio.wait_for(started.wait(), 2)
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
        await asyncio.wait_for(model.closed.wait(), 2)

    asyncio.run(scenario())


def test_stopped_consumer_closes_inflight_sdk_model(store):
    async def scenario():
        model = StreamingModel()

        async def emit(event):
            if event["type"] == "answer_preview":
                raise ConnectionError("Consumer stopped")

        with pytest.raises(ConnectionError, match="Consumer stopped"):
            await stream_investigation(
                ChatRequest(**request_body(store)), Investigation(store), [], model, emit
            )
        await asyncio.wait_for(model.closed.wait(), 2)

    asyncio.run(scenario())


def test_partial_answer_handles_split_escaped_unicode_quotes_and_newlines():
    summary = 'Связь «А» → "Б"\nПеревод 💸'
    finding = 'Получено 100,00 ₸\nДальше: "неизвестно"'
    serialized = json.dumps(
        {
            "summary": summary,
            "hypotheses": [finding],
            "claims": [{"evidence_id": "private-id", "field": "total", "value": 1}],
        },
        ensure_ascii=True,
    )
    for end in range(1, len(serialized) + 1):
        preview = answer_preview(serialized[:end])
        assert summary.startswith(preview["summary"])
        assert all(finding.startswith(value) for value in preview["findings"])
    assert answer_preview(serialized) == {
        "type": "answer_preview",
        "summary": summary,
        "findings": [finding],
    }


@pytest.mark.parametrize("content", ["[]", "null", "42", '{"summary":123,"hypotheses":4}'])
def test_invalid_partial_types_never_leak_as_preview(content):
    assert answer_preview(content) == {"type": "answer_preview", "summary": "", "findings": []}
