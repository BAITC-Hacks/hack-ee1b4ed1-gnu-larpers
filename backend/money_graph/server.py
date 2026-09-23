import argparse
import asyncio
import json
import os
import time
from contextlib import asynccontextmanager, suppress
from dataclasses import dataclass, field
from datetime import date
from pathlib import Path
from urllib.parse import urlsplit
from uuid import uuid4

import anyio
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from starlette.middleware.trustedhost import TrustedHostMiddleware

from money_graph.agent import (
    ChatRequest,
    checked_answer,
    run_investigation,
    stream_investigation,
)
from money_graph.analysis import Config, analyze
from money_graph.dataset import load_dataset
from money_graph.export import write_outputs
from money_graph.investigation import Investigation, InvestigationStore


@dataclass
class Conversation:
    history: list = field(default_factory=list)
    evidence: dict = field(default_factory=dict)
    turns: int = 0
    updated: float = field(default_factory=time.monotonic)


async def until_disconnected(request: Request):
    while True:
        message = await request.receive()
        if message["type"] == "http.disconnect":
            return


class AgentStreamResponse(StreamingResponse):
    def __init__(self, content, gate):
        super().__init__(
            content,
            media_type="text/event-stream",
            headers={"Cache-Control": "no-store", "X-Accel-Buffering": "no"},
        )
        self.gate = gate

    async def __call__(self, scope, receive, send):
        stream = asyncio.create_task(self.stream_response(send))
        disconnected = asyncio.create_task(self.listen_for_disconnect(receive))
        try:
            completed, _ = await asyncio.wait(
                {stream, disconnected}, return_when=asyncio.FIRST_COMPLETED
            )
            if stream in completed:
                with suppress(OSError):
                    stream.result()
        finally:
            with anyio.CancelScope(shield=True):
                for task in (stream, disconnected):
                    task.cancel()
                    with suppress(asyncio.CancelledError, Exception):
                        await task
                try:
                    await self.body_iterator.aclose()
                finally:
                    self.gate.release()


def stream_event(event: dict) -> str:
    return f"data: {json.dumps(event, ensure_ascii=False)}\n\n"


def is_local_origin(origin: str) -> bool:
    if not origin or any(ord(character) <= 32 or ord(character) == 127 for character in origin):
        return False
    try:
        parsed = urlsplit(origin)
        if (
            parsed.scheme != "http"
            or parsed.hostname not in {"localhost", "127.0.0.1", "::1"}
            or parsed.username is not None
            or parsed.password is not None
            or parsed.path
            or "?" in origin
            or "#" in origin
        ):
            return False
        host = "[::1]" if parsed.hostname == "::1" else parsed.hostname
        authority = parsed.netloc.lower()
        if authority == host:
            return True
        prefix = f"{host}:"
        if not authority.startswith(prefix):
            return False
        port = authority[len(prefix) :]
        return bool(port and port.isascii() and port.isdecimal() and 1 <= parsed.port <= 65535)
    except ValueError:
        return False


def create_app(
    data: Path = Path("data"),
    output: Path = Path("out/agent"),
    store: InvestigationStore | None = None,
    runner=run_investigation,
    model: str | None = None,
    timeout: float = 60,
    stream_runner=stream_investigation,
) -> FastAPI:
    sessions: dict[str, Conversation] = {}
    gate = asyncio.Lock()
    model = model or os.getenv("OPENAI_MODEL", "gpt-6-luna")

    @asynccontextmanager
    async def lifespan(app):
        if store is None:
            analysis = await asyncio.to_thread(analyze, load_dataset(data), Config())
            app.state.store = InvestigationStore(analysis)
            await asyncio.to_thread(write_outputs, analysis, output)
        else:
            app.state.store = store
        yield
        sessions.clear()

    app = FastAPI(title="TRACE Investigation API", lifespan=lifespan)
    app.add_middleware(
        TrustedHostMiddleware, allowed_hosts=["127.0.0.1", "localhost", "[::1]", "testserver"]
    )

    @app.middleware("http")
    async def local_requests(request: Request, call_next):
        origin = request.headers.get("origin")
        if origin is not None and not is_local_origin(origin):
            return JSONResponse({"detail": "Источник запроса не разрешён."}, status_code=403)
        length = request.headers.get("content-length", "0")
        if not length.isdecimal() or int(length) > 24_000:
            return JSONResponse({"detail": "Слишком большой запрос."}, status_code=413)
        response = await call_next(request)
        response.headers["Cache-Control"] = "no-store"
        return response

    @app.get("/api/agent/status")
    async def status():
        available = bool(os.getenv("OPENAI_API_KEY", "").strip())
        return {
            "available": available,
            "reason": None if available else "Добавьте OPENAI_API_KEY в окружение сервера.",
            "analysis_id": app.state.store.analysis_id,
            "model": model if available else None,
        }

    @app.get("/generated/graph.json")
    async def graph():
        return app.state.store.payload

    @app.get("/generated/{filename}")
    async def artifact(filename: str):
        if (
            filename
            not in {"nodes_roles.csv", "clusters.csv", "top_nodes.csv", "summary.json", "report.md"}
            or not (output / filename).is_file()
        ):
            raise HTTPException(404, "Файл не найден.")
        return FileResponse(output / filename, filename=filename)

    def save_answer(body, active, conversation, investigation, answer, history):
        answer, evidence = checked_answer(answer, investigation)
        if len(str(history)) > 180_000:
            raise HTTPException(409, "Диалог слишком большой. Начните новый диалог.")
        conversation_id = body.conversation_id or str(uuid4())
        if len(sessions) >= 32 and conversation_id not in sessions:
            oldest = min(sessions, key=lambda key: sessions[key].updated)
            del sessions[oldest]
        sessions[conversation_id] = Conversation(
            history,
            investigation.evidence,
            conversation.turns + 1,
            time.monotonic(),
        )
        return {
            "analysis_id": active.analysis_id,
            "conversation_id": conversation_id,
            "answer": answer,
            "evidence": evidence,
        }

    async def stream_chat(body, active, conversation):
        investigation = Investigation(active)
        investigation.evidence.update(conversation.evidence)
        queue = asyncio.Queue(maxsize=32)
        task = None
        next_event = None
        try:
            yield stream_event({"type": "status", "phase": "thinking"})
            task = asyncio.create_task(
                asyncio.wait_for(
                    stream_runner(body, investigation, conversation.history, model, queue.put),
                    timeout=timeout,
                )
            )
            deadline = time.monotonic() + timeout
            while True:
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    raise HTTPException(
                        504, "Агент не успел ответить. Уточните вопрос и повторите."
                    )
                if not queue.empty():
                    yield stream_event(queue.get_nowait())
                    continue
                if task.done():
                    answer, history = task.result()
                    result = save_answer(body, active, conversation, investigation, answer, history)
                    yield stream_event({"type": "result", "response": result})
                    return
                next_event = asyncio.create_task(queue.get())
                completed, _ = await asyncio.wait(
                    {task, next_event},
                    timeout=min(remaining, 10),
                    return_when=asyncio.FIRST_COMPLETED,
                )
                if next_event in completed:
                    yield stream_event(next_event.result())
                else:
                    next_event.cancel()
                    with suppress(asyncio.CancelledError):
                        await next_event
                    if not completed:
                        yield ": keepalive\n\n"
                next_event = None
        except TimeoutError:
            yield stream_event(
                {
                    "type": "error",
                    "detail": "Агент не успел ответить. Уточните вопрос и повторите.",
                }
            )
        except HTTPException as exc:
            yield stream_event({"type": "error", "detail": exc.detail})
        except Exception:
            yield stream_event(
                {
                    "type": "error",
                    "detail": (
                        "Не удалось получить проверяемый ответ. "
                        "Проверьте доступ к модели и повторите."
                    ),
                }
            )
        finally:
            for pending in (task, next_event):
                if pending is not None:
                    pending.cancel()
                    with suppress(asyncio.CancelledError, Exception):
                        await pending

    @app.post("/api/agent/chat")
    async def chat(body: ChatRequest, request: Request):
        active = app.state.store
        if body.analysis_id != active.analysis_id:
            raise HTTPException(409, "Расчёт изменился. Обновите страницу и начните новый диалог.")
        if not os.getenv("OPENAI_API_KEY", "").strip():
            raise HTTPException(503, "Агент недоступен: OPENAI_API_KEY не задан на сервере.")
        try:
            if body.selected_gid is not None:
                active.node(body.selected_gid)
            if body.cluster_id is not None and body.cluster_id not in active.clusters:
                raise ValueError("Выбранная группа отсутствует в выгрузке.")
            for value in (body.date_from, body.date_to):
                if value is not None and date.fromisoformat(value).isoformat() != value:
                    raise ValueError("Нужна дата YYYY-MM-DD.")
            if body.date_from and body.date_to and body.date_from > body.date_to:
                raise ValueError("Начало периода позже конца.")
        except ValueError as exc:
            raise HTTPException(422, str(exc)) from exc
        now = time.monotonic()
        for key in list(sessions):
            if now - sessions[key].updated > 1800:
                del sessions[key]
        if body.conversation_id is not None and body.conversation_id not in sessions:
            raise HTTPException(409, "Диалог истёк. Начните новый диалог.")
        if gate.locked():
            raise HTTPException(429, "Агент занят. Дождитесь завершения текущего запроса.")
        conversation = sessions.get(body.conversation_id, Conversation())
        if conversation.turns >= 8:
            raise HTTPException(409, "Достигнут лимит 8 вопросов. Начните новый диалог.")
        accepts_stream = any(
            value.split(";", 1)[0].strip().lower() == "text/event-stream"
            for value in request.headers.get("accept", "").split(",")
        )
        if accepts_stream:
            await gate.acquire()
            return AgentStreamResponse(stream_chat(body, active, conversation), gate)
        async with gate:
            investigation = Investigation(active)
            investigation.evidence.update(conversation.evidence)
            task = asyncio.create_task(runner(body, investigation, conversation.history, model))
            disconnected = asyncio.create_task(until_disconnected(request))
            try:
                completed, _ = await asyncio.wait(
                    {task, disconnected},
                    timeout=timeout,
                    return_when=asyncio.FIRST_COMPLETED,
                )
                if disconnected in completed:
                    raise HTTPException(499, "Запрос отменён.")
                if task not in completed:
                    raise HTTPException(
                        504, "Агент не успел ответить. Уточните вопрос и повторите."
                    )
                answer, history = task.result()
                return save_answer(body, active, conversation, investigation, answer, history)
            except HTTPException:
                raise
            except Exception as exc:
                raise HTTPException(
                    502,
                    "Не удалось получить проверяемый ответ. Проверьте доступ к модели и повторите.",
                ) from exc
            finally:
                for pending in (task, disconnected):
                    pending.cancel()
                    with suppress(asyncio.CancelledError, Exception):
                        await pending

    return app


def main():
    import uvicorn

    parser = argparse.ArgumentParser(description="Local TRACE investigation server")
    parser.add_argument("--data", type=Path, default=Path("data"))
    parser.add_argument("--out", type=Path, default=Path("out/agent"))
    args = parser.parse_args()
    uvicorn.run(create_app(args.data, args.out), host="127.0.0.1", port=8000)


if __name__ == "__main__":
    main()
