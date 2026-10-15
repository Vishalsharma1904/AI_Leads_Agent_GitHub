# ElevenLabs calling and Rudra voice

The user's authorized outcome is ElevenLabs first for calling, STT and TTS, Groq for the LLM, and Cartesia/Groq Whisper as speech fallbacks. Preserve the existing Vanilla JS application, routes, tenant authentication, encrypted credential vault, orb and spacious minimal UI. Retire Gemini/Fish from the active Rudra speech path without deleting unrelated historical code.

## Speech

Use a single persistent ElevenLabs Scribe v2 realtime WebSocket with a server-issued single-use token, PCM microphone capture, partial captions and committed turns. Keep microphone ownership stable between turns. Cancel stale generations and playback on interruption; distinguish silence from provider failure. Use ElevenLabs Flash v2.5 streamed PCM TTS, retaining the existing player and sentence streaming contract. Explicit provider selection must be respected. Fallback may occur before speech starts, never replay a partly spoken answer. Expose voice, model, speed, stability, similarity and style through compact native controls; group deeper settings under Advanced.

## Calling

An authenticated ElevenLabs studio in the existing calling surface supports credentials, account allowance, voice selection, agent create/update, instructions/first message/languages/LLM/conversation settings, knowledge and supported tools, secure browser conversation preview, phone numbers, outbound calls and conversation details. Phone calls require an actually provisioned compatible number (SIP, Twilio or Exotel as officially supported), with provider-confirmed outcomes. Do not fabricate delivery or silently place test calls. Keep secrets server-side and tenant-scope all resources and requests. Provider errors are actionable and redact credentials.

Groq custom LLM for ElevenAgents uses the documented OpenAI-compatible configuration and protected workspace secret, or an explicit existing external configuration when a provider feature is unavailable. Verify supported schema against current official documentation. Do not claim a phone network or free trial can work merely from adding an API key.

## Intelligence and evidence

Trace and fix repeated replies, duplicated speech and competing mic lifecycle controllers. Prefer a fast supported Groq reasoning model with bounded prompts/history and preserve app tool execution. Maintain streamed sentence output without speaking hidden reasoning. Regression coverage includes tenant isolation, payloads, errors, stale messages, cancellation, fallback and repeated start/stop. Browser verification covers real existing surfaces, mobile width, keyboard/Escape and reduced motion. Actual microphone quality, latency and real PSTN delivery remain unverified until tested with the user's key and provisioned number.
