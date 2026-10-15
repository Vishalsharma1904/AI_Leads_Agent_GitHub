"""Voice turns must recover across models without losing execution payloads."""
import unittest
import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import httpx
from fastapi.responses import StreamingResponse
from api import ai_chat
from api import auth_sync, billing
from sqlalchemy import create_engine
from sqlalchemy.orm import Session


class VoiceChatRecoveryTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.engine = create_engine('sqlite:///:memory:')
        auth_sync.Base.metadata.create_all(self.engine)
        self.db = Session(self.engine)
        self.addCleanup(self.engine.dispose)
        self.addCleanup(self.db.close)
        for change in [patch.object(ai_chat, 'get_provider_secret', return_value='owned'),
                       patch.object(ai_chat, 'SessionLocal', side_effect=lambda: Session(self.engine))]:
            change.start(); self.addCleanup(change.stop)

    def streamed_client(self, frames):
        class Body(httpx.AsyncByteStream):
            async def __aiter__(self):
                for frame in frames:
                    yield frame.encode()
        client = AsyncMock()
        client.build_request = lambda *args, **kwargs: httpx.Request("POST", "https://provider.test/chat")
        client.send.return_value = httpx.Response(200, stream=Body(), headers={"content-type": "text/event-stream"})
        return client

    async def test_empty_200_stream_fails_over_before_reply_headers(self):
        client = self.streamed_client(['data: {"choices":[{"delta":{"role":"assistant"}}]}\n\n', 'data: [DONE]\n\n'])
        with patch.object(ai_chat.httpx, "AsyncClient", return_value=client):
            with self.assertRaises(ai_chat._TryNext) as error:
                await ai_chat.run_provider(ai_chat.ChatRequest(model="groq/test", stream=True, messages=[{"role":"user","content":"hello"}]), "groq", "test", "owned")
        self.assertEqual(error.exception.error.detail["code"], "AI_EMPTY_RESPONSE")
        client.aclose.assert_awaited_once()

    async def test_empty_stream_uses_next_groq_model_in_same_reserved_turn(self):
        primary = self.streamed_client(['data: {"choices":[{"delta":{}}]}\n\n', 'data: [DONE]\n\n'])
        backup = self.streamed_client(['data: {"choices":[{"delta":{"content":"Recovered answer"}}]}\n\n', 'data: [DONE]\n\n'])
        with patch.object(ai_chat.httpx, "AsyncClient", side_effect=[primary, backup]), \
             patch.object(ai_chat, "get_provider_secret", side_effect=lambda name, *_: "owned" if name == "groq" else None), \
             patch.object(ai_chat, "consume", return_value={"day":"2026-10-10"}) as consume, patch.object(ai_chat, "refund") as refund:
            reply = await ai_chat.chat(ai_chat.ChatRequest(model="groq/openai/gpt-oss-20b", stream=True, messages=[{"role":"user","content":"hello"}]), self.db, SimpleNamespace(id="owner"))
            events = [event async for event in reply.body_iterator]
        self.assertIn('Recovered answer', events[0]); self.assertEqual(events[-1], 'data: [DONE]\n\n')
        consume.assert_called_once(); refund.assert_not_called()
        primary.aclose.assert_awaited_once(); backup.aclose.assert_awaited_once()

    async def test_all_empty_candidates_refund_one_reservation(self):
        clients = [self.streamed_client(['data: [DONE]\n\n']) for _ in range(2)]
        with patch.object(ai_chat.httpx, "AsyncClient", side_effect=clients), \
             patch.object(ai_chat, "get_provider_secret", side_effect=lambda name, *_: "owned" if name == "groq" else None), \
             patch.object(ai_chat, "consume", return_value={"day":"2026-10-10"}) as consume, patch.object(ai_chat, "refund") as refund:
            with self.assertRaises(ai_chat.HTTPException) as error:
                await ai_chat.chat(ai_chat.ChatRequest(model="groq/openai/gpt-oss-20b", stream=True, messages=[{"role":"user","content":"hello"}]), self.db, SimpleNamespace(id="owner"))
        self.assertEqual(error.exception.detail["code"], "AI_EMPTY_RESPONSE")
        consume.assert_called_once(); refund.assert_called_once()
        for client in clients: client.aclose.assert_awaited_once()

    async def test_valid_fragmented_tool_only_stream_keeps_execution(self):
        client = self.streamed_client(['data: {"choices":[{"delta":{"content":" ","tool_calls":[{"index":0,"id":"call1","function":{"name":"get_lead_stats","arguments":"{"}}]}}]}\n\n',
                                      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"}"}}]}}]}\n\n', 'data: [DONE]\n\n'])
        with patch.object(ai_chat.httpx, "AsyncClient", return_value=client):
            reply = await ai_chat.run_provider(ai_chat.ChatRequest(model="groq/test", stream=True, messages=[{"role":"user","content":"count leads"}]), "groq", "test", "owned")
            events = [event async for event in reply.body_iterator]
        self.assertIn('get_lead_stats', events[0]); self.assertIn('tool_calls', events[1]); self.assertEqual(events[-1], 'data: [DONE]\n\n')

    async def test_stream_error_frame_is_not_swallowed_as_empty_success(self):
        client = self.streamed_client(['data: {"error":{"code":429,"message":"private-secret and rate limit"}}\n\n'])
        with patch.object(ai_chat.httpx, "AsyncClient", return_value=client):
            with self.assertRaises(ai_chat._TryNext) as error:
                await ai_chat.run_provider(ai_chat.ChatRequest(model="groq/test", stream=True, messages=[{"role":"user","content":"hello"}]), "groq", "test", "owned")
        self.assertEqual(error.exception.error.detail["code"], "AI_RATE_LIMITED")
        self.assertNotIn("private-secret", str(error.exception.error.detail))

    async def test_json_answer_when_provider_ignores_stream_is_preserved(self):
        client = AsyncMock()
        client.build_request = lambda *args, **kwargs: httpx.Request("POST", "https://provider.test/chat")
        client.send.return_value = httpx.Response(200, json={"choices":[{"message":{"content":"Hello from JSON"}}]})
        with patch.object(ai_chat.httpx, "AsyncClient", return_value=client):
            result = await ai_chat.run_provider(ai_chat.ChatRequest(model="groq/test", stream=True, messages=[{"role":"user","content":"hello"}]), "groq", "test", "owned")
        self.assertIsInstance(result, dict)
        self.assertEqual(result["choices"][0]["message"]["content"], "Hello from JSON")

    async def test_partial_stream_failure_never_switches_to_second_answer(self):
        client = self.streamed_client(['data: {"choices":[{"delta":{"content":"Partial answer"}}]}\n\n',
                                       'data: {"error":{"code":429,"message":"rate limited"}}\n\n'])
        with patch.object(ai_chat.httpx, "AsyncClient", return_value=client):
            reply = await ai_chat.run_provider(ai_chat.ChatRequest(model="groq/test", stream=True, messages=[{"role":"user","content":"hello"}]), "groq", "test", "owned")
            events = [event async for event in reply.body_iterator]
        self.assertIn('Partial answer', events[0])
        self.assertIn('AI_RATE_LIMITED', events[1])
        client.send.assert_awaited_once()

    async def test_malformed_json_message_is_not_converted_to_fake_text(self):
        client = AsyncMock(); client.__aenter__.return_value = client
        client.post.return_value = httpx.Response(200, json={"choices":[{"message":{"content":{"reasoning":"not an answer"}}}]})
        with patch.object(ai_chat.httpx, "AsyncClient", return_value=client):
            with self.assertRaises(ai_chat._TryNext):
                await ai_chat.run_provider(ai_chat.ChatRequest(model="groq/test", messages=[{"role":"user","content":"hello"}]), "groq", "test", "owned")

    async def test_cancelled_header_wait_closes_provider_client(self):
        entered = asyncio.Event()
        async def pending(*args, **kwargs):
            entered.set()
            await asyncio.Event().wait()
        client = AsyncMock(); client.build_request = lambda *args, **kwargs: httpx.Request("POST", "https://provider.test/chat")
        client.send.side_effect = pending
        with patch.object(ai_chat.httpx, "AsyncClient", return_value=client):
            task = asyncio.create_task(ai_chat.run_provider(ai_chat.ChatRequest(model="groq/test", stream=True, messages=[{"role":"user","content":"hello"}]), "groq", "test", "owned"))
            await entered.wait(); task.cancel()
            with self.assertRaises(asyncio.CancelledError): await task
        client.aclose.assert_awaited_once()

    def test_second_groq_model_is_not_deduplicated_as_same_provider(self):
        with patch.object(ai_chat, "get_provider_secret", side_effect=lambda name, *_: "owned" if name == "groq" else None):
            candidates = ai_chat.build_candidates("groq", "openai/gpt-oss-20b", SimpleNamespace(id="owner"), None)
        self.assertEqual([(p, m) for p, m, _ in candidates], [
            ("groq", "openai/gpt-oss-20b"), ("groq", "openai/gpt-oss-120b")])

    async def test_limited_primary_uses_backup_in_same_turn_and_one_reservation(self):
        req = ai_chat.ChatRequest(model="groq/openai/gpt-oss-20b", messages=[{"role": "user", "content": "Hello"}])
        reply = {"choices": [{"message": {"content": "Hello"}}]}
        with patch.object(ai_chat, "get_provider_secret", side_effect=lambda name, *_: "owned" if name == "groq" else None), \
             patch.object(ai_chat, "consume", return_value={"day": "2026-10-10"}) as consume, \
             patch.object(ai_chat, "refund") as refund, \
             patch.object(ai_chat, "run_provider", new_callable=AsyncMock,
                          side_effect=[ai_chat._TryNext(ai_chat.upstream_error("groq", 429)), reply]) as run:
            result = await ai_chat.chat(req, self.db, SimpleNamespace(id="owner"))
        self.assertEqual(result, reply)
        self.assertEqual(run.await_count, 2)
        consume.assert_called_once()
        refund.assert_not_called()

    async def test_nonstream_tool_call_is_a_usable_execution_reply(self):
        call = {"id": "call1", "type": "function", "function": {"name": "get_lead_stats", "arguments": "{}"}}
        data = {"choices": [{"message": {"content": None, "tool_calls": [call]}}]}
        client = AsyncMock()
        client.__aenter__.return_value = client
        client.post.return_value = httpx.Response(200, json=data)
        with patch.object(ai_chat.httpx, "AsyncClient", return_value=client):
            result = await ai_chat.run_provider(ai_chat.ChatRequest(model="groq/test", messages=[{"role": "user", "content": "count leads"}]), "groq", "test", "owned")
        self.assertEqual(result["choices"][0]["message"]["tool_calls"], [call])

    def test_provider_retry_after_is_safe_and_preserved(self):
        error = ai_chat.upstream_error("groq", 429, "tokens per minute (TPM)", retry_after="12.5")
        self.assertEqual(error.detail["retry_after_seconds"], 12.5)
        self.assertNotIn("retry_after_seconds", ai_chat.upstream_error("groq", 429, retry_after="invalid").detail)

    def test_browser_search_uses_current_groq_parameters_and_keeps_evidence(self):
        req = ai_chat.ChatRequest(model="groq/openai/gpt-oss-20b", max_tokens=2000,
                                  messages=[{"role":"user", "content":"Weather today?"}],
                                  tools=[{"type":"browser_search"}], tool_choice="required")
        _, _, _, body = ai_chat.build_upstream("groq", "openai/gpt-oss-20b", "owned", req)
        self.assertEqual(body["max_completion_tokens"], 1200)
        self.assertNotIn("max_tokens", body)
        self.assertEqual(body["tools"], [{"type":"browser_search"}])
        self.assertEqual(body["tool_choice"], "required")
        self.assertEqual(body["reasoning_effort"], "low")
        self.assertFalse(body["include_reasoning"])
        message = {"content":"Delhi is 28°C. 〖1†L1-L2〗", "executed_tools":[{"type":"browser_search", "browser_results":[{"url":"https://weather.test", "title":"Weather", "date":"2026-10-11"}]}],
                   "annotations":[{"type":"function_citation", "function_citation":{"tool_call_id":"search-1", "start_index":0, "end_index":12}}]}
        normalized = ai_chat.normalize_completion("groq", {"model":"openai/gpt-oss-20b", "choices":[{"message":message}]})
        self.assertEqual(normalized["choices"][0]["message"], message)
        self.assertEqual(normalized["model"], "openai/gpt-oss-20b")

    async def test_browser_search_only_rotates_compatible_models_in_one_reserved_turn(self):
        req = ai_chat.ChatRequest(model="groq/openai/gpt-oss-20b", messages=[{"role":"user", "content":"Weather today?"}],
                                  tools=[{"type":"browser_search"}], tool_choice="required")
        reply = {"choices":[{"message":{"content":"Verified current answer"}}]}
        with patch.object(ai_chat, "get_provider_secret", return_value="owned"), \
             patch.object(ai_chat, "consume", return_value={"day":"2026-10-11"}) as consume, \
             patch.object(ai_chat, "refund") as refund, \
             patch.object(ai_chat, "run_provider", new_callable=AsyncMock,
                          side_effect=[ai_chat._TryNext(ai_chat.upstream_error("groq", 429)), reply]) as run:
            result = await ai_chat.chat(req, self.db, SimpleNamespace(id="owner"))
        self.assertEqual(result, reply)
        self.assertEqual([(call.args[1], call.args[2]) for call in run.await_args_list], [
            ("groq", "openai/gpt-oss-20b"), ("groq", "openai/gpt-oss-120b")])
        consume.assert_called_once(); refund.assert_not_called()

    async def test_browser_search_timeout_cancels_work_and_refunds(self):
        req = ai_chat.ChatRequest(model="groq/openai/gpt-oss-20b", messages=[{"role":"user", "content":"Weather today?"}],
                                  tools=[{"type":"browser_search"}], tool_choice="required")
        cancelled = False
        async def slow_provider(*args):
            nonlocal cancelled
            try:
                await asyncio.Event().wait()
            finally:
                cancelled = True
        actual_wait_for = asyncio.wait_for
        timeouts = []
        async def shortened_wait(coro, timeout):
            timeouts.append(timeout)
            return await actual_wait_for(coro, timeout=0.01)
        with patch.object(ai_chat, "get_provider_secret", return_value="owned"), \
             patch.object(ai_chat, "consume", return_value={"day":"2026-10-11"}), \
             patch.object(ai_chat, "refund") as refund, \
             patch.object(ai_chat, "run_provider", side_effect=slow_provider), \
             patch.object(ai_chat.asyncio, "wait_for", side_effect=shortened_wait):
            with self.assertRaises(ai_chat.HTTPException) as error:
                await ai_chat.chat(req, self.db, SimpleNamespace(id="owner"))
        self.assertTrue(cancelled, "deadline cancels the running provider, not just the caller's wait")
        self.assertEqual(error.exception.detail["code"], "AI_TIMEOUT")
        self.assertTrue(0 < timeouts[0] <= 5)
        self.assertEqual(len(timeouts), 1, "a timeout cannot launch another unbounded search")
        refund.assert_called_once()

    async def test_incompatible_search_is_rejected_before_spending(self):
        for model, stream in [("openrouter/test", False), ("groq/llama-3.3-70b-versatile", False), ("groq/openai/gpt-oss-20b", True)]:
            with self.subTest(model=model, stream=stream), patch.object(ai_chat, "consume") as consume:
                with self.assertRaises(ai_chat.HTTPException) as error:
                    await ai_chat.chat(ai_chat.ChatRequest(model=model, stream=stream, messages=[{"role":"user", "content":"Latest news?"}],
                                       tools=[{"type":"browser_search"}], tool_choice="required"), self.db, SimpleNamespace(id="owner"))
                self.assertEqual(error.exception.status_code, 422)
                consume.assert_not_called()


if __name__ == "__main__":
    unittest.main()
