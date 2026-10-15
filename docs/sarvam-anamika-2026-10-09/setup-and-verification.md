# Sarvam Anamika setup — 9 October 2026

These files are prepared replacement content, not proof of an applied or tested Sarvam configuration.

1. Open the exact agent used for the test. In Instructions, replace Greeting with `greeting-hindi.txt` for the intended Hindi/Hinglish opening. Remove its lead-name variable chip entirely; a fixed greeting avoids empty-name synthesis.
2. Open Greeting's Translations. Regenerate stale translations, then inspect and manually correct the Hindi and English text using the two greeting files. Do not let translation convert the brand's Twenty Four into a local number or omit Secure Services. Greeting is played directly; the LLM Instructions do not rewrite it.
3. Replace the complete old Instructions body with `instructions.txt`. Do not append it below contradictory old identity, booking, vendor or sales rules. Preserve only deliberately configured real tool mentions; new text cannot create tools.
4. Settings → Speaking → pronunciation dictionary (Advanced): upload `pronunciations.json`, using Sarvam's downloadable sample if the UI requires you to reconcile an existing dictionary. Inspect each language's entry. This is a proposed alias configuration; listen to a voice test to verify the result.
5. Settings → Language personalisation: Hindi starting language, Hindi and English allowed, language switching enabled if wanted. Start with Output numbers in Indic off during the brand-pronunciation check. Settings → Listening: Let callers interrupt on; Eagerness to respond Patient if the agent cuts off unfinished phrases; Sound sensitivity Medium as an initial trial, adjusted for the actual audio. Keep Model temperature at the documented default 0.3 initially. These are starting choices, not validated optimal settings.
6. Settings → Speaking: preview voices with the actual Hinglish greeting. If the current account exposes Bulbul V4, compare its female conversational/Hinglish voices. Begin with default pace/pitch and change only after listening. A prompt does not guarantee audio expressiveness or overlapping backchannels.
7. Variables → Input: inspect supplied names and test overrides. Remove misleading defaults such as Ji/Sir from contact-name fields. Keep real fields if required downstream. Use @ in the editor to insert Sarvam current_date/start_datetime when date grounding is needed; a typed label alone is not a variable chip. Ensure local date/time handling is configured for the recipient.
8. Variables → Output: edit each extraction prompt separately using `output-variable-prompts.txt`. Check Enum options and preserve downstream compatibility before changing names/values. These outputs are extracted after the call; changing conversational instructions alone may not repair extraction rules.
9. Open the version dropdown beside the agent name. Commit agent to save the edited configuration. Note its version number. End any old test session. Start a fresh test from this version; Test agent → Setup should use Hindi and the intended speaker, with stale overrides cleared.
10. Confirm the fresh test's opening contains Anamika, marketing team, free audit and the complete correct brand. If the old opening remains, check exact agent ID, selected version, Hindi translation and whether the transcript is from the fresh test rather than history.
11. After the committed version passes, update the intended inbound deployment/outbound campaign/API app_version reference to that tested version. Draft edits do not establish which version is serving live calls. Verify deployment/version details in the relevant channel before a new authorised phone test.

## Rehearsal checks

- Empty contact name: no empty identity question; introduce Anamika and the offer.
- Caller says “हम…” and pauses: wait rather than immediately repeat discovery.
- Caller says guards sleep: calmly acknowledge the reported night-duty concern; no vendor insults, fear pitch or unsupported monitoring guarantee.
- Caller accepts audit: ask their name if unknown, then collect only useful missing details.
- Caller agrees to “meeting or site visit”: clarify the action; do not infer a site visit.
- Caller says “parson, twelve”: confirm explicit date based on the actual call date and clarify noon/midnight; no stale output date.
- No booking tool: call outcome is requested/pending confirmation, not booked.
- Caller says no or do-not-call: no additional pitch and no follow-up scheduled.

## Expected interpretation of the supplied failing transcript

- Current vendor: caller identifies Swift Company, subject to original audio clarity.
- Concerns: guards sleep during night duty; supervisory response is inadequate.
- Next step: the caller agreed to a meeting-or-visit proposal, without independently distinguishing the two. Record a next-step request pending clarification, not a confirmed visit.
- Timing: future “parson” and noon were discussed. Resolve the day from the actual call's local date, not from when this transcript is reviewed. If the call was on 9 October 2026, future parson is 11 October 2026; if not, calculate from the real call date.
- Missing: caller name, verified decision-making authority, site details and actual booking confirmation.
- No explicit commitment to replace the vendor. Under the proposed rubric, warm rather than automatically hot.

## Official references

- [Greeting, translations, commits and testing](https://docs.sarvam.ai/conversations/build/navigating-workspace)
- [Draft, committed and deployed versions](https://docs.sarvam.ai/conversations/build/agent/versioning)
- [Settings and turn-taking](https://docs.sarvam.ai/conversations/build/conversation-settings)
- [Pronunciation dictionary format and voices](https://docs.sarvam.ai/conversations/build/voice-language)
- [System variables and extraction prompts](https://docs.sarvam.ai/conversations/build/variables-personalization)
