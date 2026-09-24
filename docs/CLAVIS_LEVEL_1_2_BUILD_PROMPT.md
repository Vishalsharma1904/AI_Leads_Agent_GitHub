# Clavis AI — Level 1–2 Build Contract

Use this document as the implementation contract for Claude, ChatGPT, or another coding agent. The goal is a real, testable browser voice assistant foundation, not a demo or simulated transcript.

## Role

You are a senior speech-interface and production JavaScript engineer. Implement only Level 1 and Level 2 in the existing Clavis app. Preserve the existing visual design and existing authenticated backend boundaries. Do not add heavy UI dependencies.

## Level 1: hearing, wake-up, and voice output

Implement a small explicit state machine:

`disabled → sleeping → waking → listening → processing → speaking → sleeping`

- The assistant must listen for configurable wake phrases, defaulting to `Clavis`, `Hey Clavis`, `Hey buddy`, and `Hi pal`.
- Store wake phrases as a bounded list of 1–8 normalized phrases in the existing settings store. Never execute arbitrary spoken text while sleeping.
- On wake detection, provide an immediate visual state change and a short, optional two-tone chime. Respect mute and reduced-motion preferences.
- If the wake phrase and command occur in the same recognition result, preserve the command text after the wake phrase.
- Continue capturing until a natural pause of about 1.5–2 seconds, or an explicit commit phrase such as `go for it`, `that's it`, `done`, or `over`.
- Remove only the commit phrase before sending. Never truncate the command at the first partial/interim result.
- Handle interim and final SpeechRecognition results without duplicating text.
- Restart recognition after browser `onend` only when the user has enabled hands-free mode and the session was not manually stopped.
- Handle permission denial, unsupported browsers, network errors, duplicate starts, tab visibility changes, and microphone stop/restart safely.
- Never claim Siri-level always-on behavior in a browser. Show a truthful status when the browser, OS, or tab cannot keep the microphone alive.
- Use browser SpeechSynthesis for V1 replies. Cancel speech on barge-in or explicit stop.

## Level 2: natural-language understanding

- Send the complete finalized transcript to the existing authenticated Clavis backend AI endpoint.
- Never send provider API keys from the browser and never call Groq, OpenRouter, Apify, or Gemini directly from frontend code.
- Preserve Hinglish, Hindi, and English naturally. Do not translate unless asked.
- Return a typed intent envelope:

```json
{
  "intent": "chat|generate_leads|filter_leads|sync_sheets|remember|unknown",
  "command": "original finalized user text",
  "entities": {},
  "confidence": 0.0,
  "requires_confirmation": false
}
```

- Never invent missing entities, permissions, job results, or provider success.
- Safe read-only actions may proceed when confidence is high. Destructive, external-send, or account-changing actions require explicit confirmation.
- If confidence is low, ask one concise clarification question; do not silently guess.
- Keep spoken replies short and use the UI transcript for detail.
- Maintain cancellation: a new command or stop action must abort the active request and prevent stale responses from being rendered.

## Hardening requirements

- All UI states must be mutually exclusive and reflected in `aria-live` status text.
- Microphone buttons need a minimum 44px touch target, visible keyboard focus, and an accessible label.
- Modals must use `hidden`, `inert`, and correct `aria-hidden`; focus must return to the opener after close.
- Respect `prefers-reduced-motion: reduce`.
- Do not create polling loops without cleanup. Clear timers and abort controllers on stop, navigation, and unload.
- Cap transcript length and reject empty or excessively long input.
- Escape user transcript before inserting it into HTML.
- Do not log microphone audio, access tokens, refresh tokens, or provider secrets.
- Use feature flags for experimental wake phrases and demo mode. Demo mode must be disabled in production.

## Required tests

Write tests before implementation for:

1. Wake phrase matching, case/spacing normalization, aliases, and false positives.
2. Wake phrase plus same-result command preservation.
3. Interim/final result de-duplication.
4. Natural pause and explicit commit phrase finalization.
5. Stop, cancel, permission denied, unsupported browser, and recognition restart.
6. Complete transcript delivery to the authenticated backend.
7. Intent parsing in English, Hindi, and Hinglish.
8. Low-confidence clarification and confirmation for risky actions.
9. Stale response suppression after cancellation.
10. Keyboard, reduced-motion, and mobile UI behavior.

## Definition of done

Do not claim completion until syntax checks, unit tests, API tests, and desktop/mobile browser smoke tests pass. Report every unavailable external prerequisite separately, including microphone permission, Google OAuth configuration, provider credentials, and backend availability.
