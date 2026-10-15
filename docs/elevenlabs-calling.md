# ElevenLabs calling in Rudra

Connect ElevenLabs in **Voice Calling AI**, and Groq in **Rudra AI → Setup**. Create an agent, choose an account voice, save, then use **Talk to agent** for the browser test. The browser receives a single-use signed conversation URL. Both provider keys stay in the encrypted tenant vault; the Groq key is also stored as a protected ElevenLabs workspace secret for the provider's custom LLM connection.

**Calling Agent** opens the same studio. Sending leads preloads a selectable contact list and business context. It never dials automatically. Select an existing Exotel, Twilio or SIP number, verify the destination, and use **Place call**. The number must actually be provisioned with its phone provider. An accepted request is separate from an answered call; conversation history shows the provider's status, transcript and available analysis/recording. Inbound calls are opt-in; SIP inbound routing requires the provider's public source IP/CIDR allowlist.

The app exposes agent instructions, first message, language/Hinglish, voice model/speed/stability/similarity, Groq model/thinking effort/creativity/reply limits, response timing, silence/max duration, interruptions, keywords, knowledge text/URL, tools, call-goal evaluation, recording and retention. Built-in end-call and language tools run in phone or browser conversations. The app navigation client tool runs in the browser preview; read-only HTTPS webhook tools run with the provider. Complex webhook schemas, authenticated external tools, MCP, transfer rules, branching workflows and specialised provider features remain editable in ElevenLabs. Unsupported plan features produce provider errors; they are not presented as available just from saving a key.

Each ElevenLabs account may connect to one Rudra tenant, and each agent, phone, conversation, document and tool is locally bound to its owner. Development `AUTO_CREATE_SCHEMA=true` creates the resource table. Production with schema auto-creation disabled must apply `backend/migrations/20261007_elevenlabs_resources.sql` before serving these routes. Restart the backend after registering the router.

Free/paid allowance is read from the connected account. The app does not hardcode a price, guaranteed minute allowance or free PSTN availability. Account key, microphone latency, audio quality, carrier routing and real phone delivery require a user-initiated live test.

Verified API references (7 October 2026):

- [ElevenLabs OpenAPI](https://api.elevenlabs.io/openapi.json), including current field names and supported enum values.
- [Custom LLM](https://elevenlabs.io/docs/eleven-agents/customization/llm/custom-llm), OpenAI-compatible Groq endpoint and protected secret authentication.
- [Create agent](https://elevenlabs.io/docs/api-reference/agents/create), [workspace secrets](https://elevenlabs.io/docs/api-reference/workspace/secrets/create), [WebSocket protocol](https://elevenlabs.io/docs/eleven-agents/api-reference/eleven-agents/websocket).
- [Phone number import](https://elevenlabs.io/docs/api-reference/phone-numbers/create), [SIP calling](https://elevenlabs.io/docs/api-reference/sip-trunk/outbound-call), [Twilio calling](https://elevenlabs.io/docs/api-reference/twilio/outbound-call), [Exotel calling](https://elevenlabs.io/docs/api-reference/exotel/outbound-call).
- [Groq reasoning parameters](https://console.groq.com/docs/reasoning). GPT OSS uses bounded low-effort reasoning by default; reasoning is excluded from spoken output.

Offline checks: run `node tests/elevenlabs_studio_lifecycle_test.js`, and from `backend/` run `.venv312/Scripts/python.exe -m unittest discover -s tests -p test_elevenlabs_calling.py -q`. `tests/artifacts/elevenlabs-studio-fixture.html` loads real studio assets with fake provider/microphone/call responses for keyboard, routing and visual inspection.
