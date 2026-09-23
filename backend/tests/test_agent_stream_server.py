import asyncio
import json

import pytest
from test_analysis_exports import fixture_dataset

pytest.importorskip("agents")
pytest.importorskip("fastapi")

from fastapi.testclient import TestClient

from money_graph.agent import Answer, Claim
from money_graph.analysis import analyze
from money_graph.investigation import InvestigationStore
from money_graph.server import AgentStreamResponse, create_app


@pytest.fixture
def store(monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "test-not-a-real-key")
    return InvestigationStore(
        analyze(
            fixture_dataset(
                [(100000000000000001, 100000000000000002, "2026-07-01", 100)],
                seeds={100000000000000001},
                depths={100000000000000002: 4},
            )
        )
    )


def body(store, **overrides):
    return {
        "analysis_id": store.analysis_id,
        "message": "Почему этот узел важен?",
        "selected_gid": "100000000000000002",
        **overrides,
    }


async def successful_runner(request, investigation, history, model, emit):
    result = investigation.execute("get_node", gid=request.selected_gid)
    return Answer(
        summary="Наблюдаемый конец цепочки.",
        claims=[Claim(evidence_id=result["evidence_id"], field="truncated_by_depth", value=True)],
        hypotheses=[],
        limitations=[],
    ), [*history, {"role": "user", "content": request.message}]


class StreamRequest:
    def __init__(self, app, payload, version="2.4", send=None):
        self.received = asyncio.Queue()
        self.events = asyncio.Queue()
        self.event_log = []
        self.messages = []
        encoded = json.dumps(payload).encode()
        self.received.put_nowait({"type": "http.request", "body": encoded, "more_body": False})
        self.scope = {
            "type": "http",
            "asgi": {"version": "3.0", "spec_version": version},
            "http_version": "1.1",
            "method": "POST",
            "scheme": "http",
            "path": "/api/agent/chat",
            "raw_path": b"/api/agent/chat",
            "query_string": b"",
            "root_path": "",
            "headers": [
                (b"host", b"testserver"),
                (b"accept", b"text/event-stream"),
                (b"content-type", b"application/json"),
                (b"content-length", str(len(encoded)).encode()),
            ],
            "client": ("127.0.0.1", 1234),
            "server": ("testserver", 80),
        }
        self.task = asyncio.create_task(app(self.scope, self.received.get, send or self.send))

    async def send(self, message):
        self.messages.append(message)
        if message["type"] == "http.response.body":
            for line in message.get("body", b"").decode().splitlines():
                if line.startswith("data: "):
                    event = json.loads(line[6:])
                    self.events.put_nowait(event)
                    self.event_log.append(event)

    async def event(self):
        return await asyncio.wait_for(self.events.get(), timeout=2)

    async def finish(self):
        await asyncio.wait_for(self.task, timeout=2)

    async def disconnect(self):
        self.received.put_nowait({"type": "http.disconnect"})
        await self.finish()


@pytest.mark.parametrize("version", ["2.3", "2.4"])
def test_progress_arrives_before_completion_and_session_is_reusable(store, version):
    async def scenario():
        complete = asyncio.Event()
        calls = []

        async def runner(request, investigation, history, model, emit):
            calls.append(list(history))
            await emit({"type": "reasoning_delta", "delta": "Проверяю связи."})
            await emit({"type": "answer_preview", "summary": "Наблюдаемый", "findings": []})
            await complete.wait()
            return await successful_runner(request, investigation, history, model, emit)

        app = create_app(store=store, stream_runner=runner)
        async with app.router.lifespan_context(app):
            first = StreamRequest(app, body(store), version)
            assert await first.event() == {"type": "status", "phase": "thinking"}
            assert (await first.event())["delta"] == "Проверяю связи."
            assert (await first.event())["summary"] == "Наблюдаемый"
            assert not first.task.done()
            competing = StreamRequest(app, body(store), version)
            await competing.finish()
            assert competing.messages[0]["status"] == 429
            assert len(calls) == 1
            complete.set()
            result = await first.event()
            await first.finish()
            assert result["type"] == "result"
            response = result["response"]
            assert response["evidence"][0]["node_ids"] == ["100000000000000002"]
            assert response["answer"]["limitations"]
            headers = dict(first.messages[0]["headers"])
            assert headers[b"content-type"].startswith(b"text/event-stream")
            assert headers[b"cache-control"] == b"no-store"
            assert headers[b"x-accel-buffering"] == b"no"
            second = StreamRequest(
                app,
                body(store, conversation_id=response["conversation_id"], message="Дальше"),
                version,
            )
            await second.finish()
            assert (
                second.event_log[-1]["response"]["conversation_id"] == response["conversation_id"]
            )
            assert calls == [[], [{"role": "user", "content": body(store)["message"]}]]

    asyncio.run(scenario())


@pytest.mark.parametrize("version", ["2.3", "2.4"])
def test_disconnect_cancels_provider_and_releases_capacity(store, version):
    async def scenario():
        started = asyncio.Event()
        cancelled = asyncio.Event()

        async def runner(*args):
            if cancelled.is_set():
                return await successful_runner(*args)
            started.set()
            try:
                await asyncio.sleep(30)
            finally:
                cancelled.set()

        app = create_app(store=store, stream_runner=runner)
        async with app.router.lifespan_context(app):
            first = StreamRequest(app, body(store), version)
            await first.event()
            await asyncio.wait_for(started.wait(), timeout=2)
            await first.disconnect()
            assert cancelled.is_set()
            second = StreamRequest(app, body(store), version)
            await second.finish()
            assert second.messages[0]["status"] == 200
            assert second.event_log[-1]["type"] == "result"

    asyncio.run(scenario())


def test_timeout_emits_error_cancels_provider_and_releases_capacity(store):
    cancelled = []

    async def runner(*args):
        if cancelled:
            return await successful_runner(*args)
        try:
            await asyncio.sleep(30)
        finally:
            cancelled.append(True)

    with TestClient(create_app(store=store, stream_runner=runner, timeout=0.02)) as client:
        response = client.post(
            "/api/agent/chat", json=body(store), headers={"accept": "text/event-stream"}
        )
        assert response.status_code == 200
        assert '"type": "error"' in response.text
        assert "не успел" in response.text
        assert '"type": "result"' not in response.text
        assert cancelled == [True]
        second = client.post(
            "/api/agent/chat", json=body(store), headers={"accept": "text/event-stream"}
        )
        assert '"type": "result"' in second.text


@pytest.mark.parametrize("failure", ["provider", "evidence", "history"])
def test_failed_stream_does_not_commit_history_or_expose_provider_details(store, failure):
    histories = []

    async def runner(request, investigation, history, model, emit):
        histories.append(list(history))
        if request.message == "fail":
            await emit({"type": "status", "phase": "answer"})
            if failure == "provider":
                raise RuntimeError("Authorization: Bearer secret; customer details")
            answer, _ = await successful_runner(request, investigation, history, model, emit)
            if failure == "evidence":
                answer.claims[0].evidence_id = "invented-secret"
            return answer, ["x" * 180_001] if failure == "history" else ["bad"]
        return await successful_runner(request, investigation, history, model, emit)

    with TestClient(create_app(store=store, stream_runner=runner)) as client:

        def ask(**overrides):
            response = client.post(
                "/api/agent/chat",
                json=body(store, **overrides),
                headers={"accept": "text/event-stream"},
            )
            return [
                json.loads(line[6:])
                for line in response.text.splitlines()
                if line.startswith("data: ")
            ]

        first = ask()[-1]["response"]
        failed = ask(conversation_id=first["conversation_id"], message="fail")
        assert failed[-1]["type"] == "error"
        assert not any(event["type"] == "result" for event in failed)
        assert "secret" not in json.dumps(failed)
        final = ask(conversation_id=first["conversation_id"], message="retry")[-1]
        assert final["type"] == "result"
        assert histories[1] == histories[2]
        assert len(histories[2]) == 1


@pytest.mark.parametrize(
    ("overrides", "status"),
    [
        ({"analysis_id": "0" * 64}, 409),
        ({"conversation_id": "missing"}, 409),
        ({"selected_gid": "999"}, 422),
        ({"date_from": "2026-02-30"}, 422),
    ],
)
def test_stream_preflight_uses_http_errors_without_starting_provider(store, overrides, status):
    async def forbidden(*args):
        pytest.fail("Invalid context reached the model")

    with TestClient(create_app(store=store, stream_runner=forbidden)) as client:
        response = client.post(
            "/api/agent/chat",
            json=body(store, **overrides),
            headers={"accept": "text/event-stream"},
        )
        assert response.status_code == status
        assert response.headers["content-type"].startswith("application/json")


def test_stream_requires_key_and_enforces_conversation_turn_limit(store, monkeypatch):
    calls = []

    async def runner(*args):
        calls.append(True)
        return await successful_runner(*args)

    with TestClient(create_app(store=store, stream_runner=runner)) as client:
        monkeypatch.delenv("OPENAI_API_KEY")
        disabled = client.post(
            "/api/agent/chat", json=body(store), headers={"accept": "text/event-stream"}
        )
        assert disabled.status_code == 503
        assert not calls
        monkeypatch.setenv("OPENAI_API_KEY", "test-not-a-real-key")
        conversation_id = None
        for _ in range(8):
            response = client.post(
                "/api/agent/chat",
                json=body(store, conversation_id=conversation_id),
                headers={"accept": "text/event-stream"},
            )
            events = [
                json.loads(line[6:])
                for line in response.text.splitlines()
                if line.startswith("data: ")
            ]
            conversation_id = events[-1]["response"]["conversation_id"]
        limited = client.post(
            "/api/agent/chat",
            json=body(store, conversation_id=conversation_id),
            headers={"accept": "text/event-stream"},
        )
        assert limited.status_code == 409
        assert len(calls) == 8


def test_stream_response_releases_gate_when_send_fails_before_generator_starts():
    async def scenario():
        gate = asyncio.Lock()
        await gate.acquire()
        started = []

        async def content():
            started.append(True)
            yield "data: {}\n\n"

        async def send(message):
            raise OSError("Disconnected")

        async def receive():
            await asyncio.sleep(30)

        response = AgentStreamResponse(content(), gate)
        await response({"type": "http"}, receive, send)
        assert not gate.locked()
        assert not started

    asyncio.run(scenario())


def test_slow_consumer_applies_backpressure_and_provider_deadline(store):
    async def scenario():
        emitted = []
        cancelled = asyncio.Event()
        body_started = asyncio.Event()
        resume = asyncio.Event()

        async def runner(request, investigation, history, model, emit):
            try:
                for index in range(1000):
                    await emit({"type": "reasoning_delta", "delta": str(index)})
                    emitted.append(index)
                return await successful_runner(request, investigation, history, model, emit)
            finally:
                cancelled.set()

        app = create_app(store=store, stream_runner=runner, timeout=0.05)
        async with app.router.lifespan_context(app):

            async def slow_send(message):
                if message["type"] == "http.response.body":
                    body_started.set()
                    await resume.wait()
                await request.send(message)

            request = StreamRequest(app, body(store), send=slow_send)
            await asyncio.wait_for(body_started.wait(), timeout=2)
            await asyncio.wait_for(cancelled.wait(), timeout=2)
            assert 0 < len(emitted) < 1000
            assert len(emitted) <= 35
            resume.set()
            await request.finish()
            assert request.event_log[-1]["type"] == "error"

    asyncio.run(scenario())


@pytest.mark.parametrize(
    "origin",
    [
        "http://localhost:5175",
        "http://127.0.0.1:5173",
        "http://[::1]:5180",
        "http://localhost",
        "http://127.0.0.1:1",
        "http://[::1]:65535",
    ],
)
@pytest.mark.parametrize("stream", [False, True])
def test_local_origins_allow_alternate_ports_for_json_and_sse_chat(store, origin, stream):
    async def runner(request, investigation, history, model):
        return await successful_runner(request, investigation, history, model, None)

    with TestClient(
        create_app(store=store, runner=runner, stream_runner=successful_runner)
    ) as client:
        response = client.post(
            "/api/agent/chat",
            json=body(store),
            headers={
                "origin": origin,
                "accept": "text/event-stream" if stream else "application/json",
            },
        )
        assert response.status_code == 200
        if stream:
            assert '"type": "result"' in response.text
        else:
            assert response.json()["analysis_id"] == store.analysis_id
        assert "access-control-allow-origin" not in response.headers


@pytest.mark.parametrize(
    "origin",
    [
        "",
        "null",
        "https://localhost:5175",
        "http://example.com:5175",
        "http://localhost.evil.example:5175",
        "http://127.0.0.1.evil.example:5175",
        "http://192.168.1.2:5175",
        "http://0.0.0.0:5175",
        "http://user@localhost:5175",
        "http://localhost:5175/",
        "http://localhost:5175/path",
        "http://localhost:5175?",
        "http://localhost:5175?query=value",
        "http://localhost:5175#",
        "http://localhost:5175#fragment",
        "http://localhost:",
        "http://localhost:0",
        "http://localhost:65536",
        "http://localhost:-1",
        "http://localhost:port",
        "http://localhost:80:90",
        "http://[::1",
        "http://[::1]evil:5175",
        "http://[::1]:0",
        "http://[2001:db8::1]:5175",
        "http://localhost:5175 http://evil.example",
        " http://localhost:5175",
    ],
)
def test_foreign_and_malformed_origins_remain_rejected(store, origin):
    with TestClient(create_app(store=store)) as client:
        response = client.get("/api/agent/status", headers={"origin": origin})
        assert response.status_code == 403


def test_ipv6_loopback_host_is_trusted_without_allowing_remote_hosts(store):
    with TestClient(create_app(store=store)) as client:
        assert client.get("/api/agent/status", headers={"host": "[::1]:8000"}).status_code == 200
        assert client.get("/api/agent/status", headers={"host": "evil.example"}).status_code == 400
        assert (
            client.get("/api/agent/status", headers={"host": "[2001:db8::1]:8000"}).status_code
            == 400
        )
