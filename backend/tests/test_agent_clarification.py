import json

import pytest
from agents import ModelResponse, Usage
from fastapi.testclient import TestClient
from openai.types.responses import ResponseOutputMessage, ResponseOutputText
from pydantic import ValidationError
from test_agent_server import request_body
from test_agent_server import store as store
from test_agent_stream import StreamingModel

from money_graph.agent import Answer, Claim, answer_preview, checked_answer
from money_graph.investigation import Investigation
from money_graph.server import create_app


@pytest.fixture
def case(store):
    return Investigation(store)


def clarification(**overrides):
    return Answer(
        **{
            "kind": "clarification",
            "summary": "Не понял запрос. Что вы хотите узнать о выбранном клиенте?",
            "claims": [],
            "hypotheses": [],
            "limitations": [],
            **overrides,
        }
    )


def test_clarification_does_not_reuse_previous_evidence_or_add_analytical_sections(case):
    case.execute("get_node", gid="100000000000000002")
    current = Investigation(case.store)
    current.evidence.update(case.evidence)

    answer, cards = checked_answer(clarification(), current)

    assert current.calls == 0
    assert cards == []
    assert answer == {
        "kind": "clarification",
        "summary": clarification().summary,
        "findings": [],
        "hypotheses": [],
        "limitations": [],
    }


@pytest.mark.parametrize(
    "overrides",
    [
        {"claims": [Claim(evidence_id="old", field="total", value=17)]},
        {"hypotheses": ["Возможно, клиент является посредником."]},
        {"limitations": ["Граф неполный."]},
        {"kind": "investigation"},
        {"kind": "unknown"},
    ],
)
def test_answer_contract_keeps_clarifications_separate_from_grounded_investigations(overrides):
    with pytest.raises(ValidationError):
        clarification(**overrides)


def test_clarification_cannot_hide_an_investigation_that_already_ran(case):
    case.execute("get_node", gid="100000000000000002")

    with pytest.raises(ValueError, match="предшествовать"):
        checked_answer(clarification(), case)


def test_streamed_clarification_keeps_its_kind_while_text_is_incomplete():
    content = clarification().model_dump_json()
    for length in range(1, len(content) + 1):
        preview = answer_preview(content[:length])
        if preview["summary"]:
            assert preview["kind"] == "clarification"
            assert clarification().summary.startswith(preview["summary"])
            assert preview["findings"] == []


class ClarificationThenInvestigationModel(StreamingModel):
    def __init__(self):
        super().__init__()
        self.finish.set()
        self.inputs = []

    async def get_response(self, **kwargs):
        self.inputs.append(kwargs["input"])
        messages = [item for item in kwargs["input"] if item.get("role") == "user"]
        if json.loads(messages[-1]["content"])["question"] != "папвап":
            return await super().get_response(**kwargs)
        self.calls += 1
        assert kwargs["output_schema"].is_strict_json_schema()
        return ModelResponse(
            output=[
                ResponseOutputMessage(
                    type="message",
                    id="clarification-1",
                    role="assistant",
                    status="completed",
                    content=[
                        ResponseOutputText(
                            type="output_text",
                            text=clarification().model_dump_json(),
                            annotations=[],
                        )
                    ],
                )
            ],
            usage=Usage(),
            response_id=None,
        )


@pytest.mark.parametrize("stream", [False, True])
def test_api_clarification_then_clear_question_reuses_conversation_with_real_sdk(
    store, monkeypatch, stream
):
    monkeypatch.setenv("OPENAI_API_KEY", "test-not-a-real-key")
    model = ClarificationThenInvestigationModel()

    with TestClient(create_app(store=store, model=model)) as client:

        def ask(**overrides):
            response = client.post(
                "/api/agent/chat",
                json=request_body(store, date_from="2026-07-01", date_to="2026-07-31", **overrides),
                headers={"Accept": "text/event-stream"} if stream else {},
            )
            assert response.status_code == 200, response.text
            if not stream:
                return response.json(), []
            events = [
                json.loads(line[6:])
                for line in response.text.splitlines()
                if line.startswith("data: ")
            ]
            assert events[-1]["type"] == "result", events
            return events[-1]["response"], events

        first, events = ask(message="папвап")
        assert first["answer"]["kind"] == "clarification"
        assert first["answer"]["summary"] == clarification().summary
        assert first["answer"]["findings"] == []
        assert first["answer"]["limitations"] == []
        assert first["evidence"] == []
        assert model.calls == 1
        assert not any(event.get("phase") == "tool" for event in events)
        assert all(
            event["kind"] == "clarification"
            for event in events
            if event["type"] == "answer_preview"
        )

        second, _ = ask(
            message="Покажи пути от исходных клиентов к выбранному клиенту.",
            conversation_id=first["conversation_id"],
        )
        assert second["conversation_id"] == first["conversation_id"]
        assert second["answer"]["kind"] == "investigation"
        assert second["answer"]["findings"]
        assert second["answer"]["limitations"]
        assert second["evidence"][0]["paths"][0]["node_ids"] == [
            "100000000000000001",
            "100000000000000002",
        ]
        assert model.calls == 3
        assert any(
            item.get("role") == "assistant"
            and "clarification" in json.dumps(item, ensure_ascii=False)
            for item in model.inputs[1]
        )
