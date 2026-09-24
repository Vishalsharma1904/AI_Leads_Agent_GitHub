# Clavis Voice + Brain

## Recommended setup for the submission demo

1. In **System Settings → AI Models**, connect the xAI key (`xai-...`) for the Grok brain.
2. In **System Settings → Voice AI**, leave the voice model on **Auto: Grok Neural if key · Browser fallback**.
3. In the voice panel, choose **Rex · deep · executive** and **Hindi / Hinglish** for speech input.
4. If you also want recorded Whisper transcription, add a Groq key (`gsk_...`). The app uses `whisper-large-v3-turbo` with Hindi/English language hints and temperature `0`.

## What changed

- `clavis-emotional-engine.js` infers user affect and language mode, selects speech prosody, adds expressive pauses/tags, and stores a small local anti-repeat memory.
- `jarvis.js` injects live emotion + `DO_NOT_REUSE_OPENERS` context, varies temperature by turn, and performs one bounded rewrite when the model repeats a recent opener.
- `jarvis_ui.js` uses xAI Neural TTS first when an xAI key is present, awaits cloud audio before falling back, and supports barge-in for hands-free mode.
- `clavis-proactive.js` shares the same anti-repeat memory so proactive nudges do not keep saying the same generic line.
- `backend/api/tts.py` remains the no-key Piper route when the Piper binary and local voice model are installed. Otherwise the browser fallback ranks masculine voices and applies sentence-level pauses/pitch/rate changes.

## Key and privacy reality

High-quality hosted speech requires a provider key. A fully keyless build can still speak using browser voices, or Piper after a one-time local binary/model installation; it will not have the same neural expressiveness as hosted TTS. An xAI key and a Groq key are separate products, so the xAI key alone cannot call Groq Whisper.

Clavis uses an original executive voice profile. It should not clone the Iron Man actor or reproduce copyrighted movie dialogue.

## Verification

```powershell
npm test
```

The voice regression suite is `scripts/verify-clavis-voice.js`. The browser QA target is `http://localhost:3000/#jarvis`.

## Official references

- [xAI Voice API](https://docs.x.ai/developers/rest-api-reference/inference/voice)
- [xAI speech-to-speech prompting guide](https://docs.x.ai/developers/model-capabilities/audio/speech-to-speech/prompting-guide)
- [Groq speech-to-text](https://console.groq.com/docs/speech-to-text)
