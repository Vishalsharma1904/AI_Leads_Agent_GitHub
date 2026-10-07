# Business outcomes and mobile reminders

Open **CRM → Pipeline → Business outcomes**. The latest recorded outcome puts each lead in Not answered, Not interested, Interested, Hot leads, Meetings, Connected or Needs review. Sending email/WhatsApp/SMS alone never infers interest or conversion. A Won deal remains the source of confirmed clients.

Open a lead's **Activity → Log a business outcome**. Record the real result, or paste only the client's reply and press **Suggest outcome from reply**. Review the suggestion, select the correct channel and save. Unclear appointments stay in Needs review. Confirmed meetings require an exact date, time and timezone. Default: Asia/Kolkata, 30-minute appointment.

Expand **Business automation & Google connection** and connect the intended Google account. You can choose a separate notification account without replacing the outreach sender. Google must grant Calendar events, Gmail send and Gmail read permission. The backend's existing GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET and registered connector redirect URL are required; provider credentials stay encrypted on the server. Preferences can pause automation, Calendar sync, meeting emails or the digest separately.

Confirmed meetings create an owner-only Calendar event with company/contact information and a conversation preview, plus popup reminders **30 minutes before and at start**. No client attendees or invitations are sent. Task reschedules update the same event; archiving cancels it. Completion preserves Calendar history. CRM shows queued/succeeded/failed/unknown delivery; an email timeout is not automatically retried because the provider might already have accepted it.

The daily digest is queued at **19:00 India time** (next worker pass) and goes only to the connected Google account. It includes unique leads by their latest outcome recorded that day, distinct Won clients, and up to 15 open meetings with previews. It is a point-in-time digest; later outcomes appear on the next digest. Meeting confirmation emails include the exact appointment and a short factual conversation preview.

Gmail imports new inbox replies after Google read consent, checks exact CRM sender ownership and removes quoted email text. First activation covers the preceding 24 hours; older mail is not silently imported. Polling uses bounded 20-message pages, about five minutes per account for small teams. Clear reply outcomes are automatic; ambiguous replies go to review. Sarvam/Tough Tongue calls launched after this update are watched when their returned call identifier maps to exactly one lead. Finished provider transcripts need typed client speech; missing/unknown transcripts or status require review. Real provider formats/credentials must be verified on the deployed account before relying on automatic classification. Current WhatsApp Web and TextBee outbound integrations do not supply verified inbound replies: record/paste those client responses manually.

The notification inbox persists server-side. In-app reminders resume after reconnect, including overdue tasks. Important toasts expand on click/keyboard activation and collapse with Escape. Switching accounts clears visible toasts and pending UI state. The inbox retains reminders independently of toast timeouts.

Phone delivery requires the same Google account in Google Calendar, with Calendar sync and notifications enabled. Calendar's already-synced reminders can notify when this app is closed. New reply processing, Calendar changes and digest emails require an **always-on backend**; a domain alone or a powered-off laptop cannot run them.

## Deployment and rollback

Local development with AUTO_CREATE_SCHEMA=true creates additive tables at backend startup. Production: apply `backend/migrations/20261005_crm_business_automation.sql` using the backend database owner, then deploy/restart the backend and refresh the app. The SQL preserves existing CRM data, enables RLS and revokes direct browser access to these backend-owned tables. API ownership remains verified server-side.

Pause automation in preferences to stop new processing. Remove the Business outcomes UI if rolling back; retain the additive tables and history. Previously created Google events remain in Calendar unless explicitly archived while sync is enabled.

Checks: `backend/.venv312/Scripts/python.exe -m unittest backend.tests.test_crm_automation.BusinessTest backend.tests.test_crm backend.tests.test_crm_workflow backend.tests.test_connectors -q` with PYTHONPATH=backend and AUTO_CREATE_SCHEMA=false. Tests mock Google/calling providers; they never send live mail or Calendar invitations.

References: [Google Calendar events](https://developers.google.com/workspace/calendar/api/v3/reference/events/insert), [Google reminders](https://developers.google.com/workspace/calendar/api/concepts/reminders), [Sarvam attempt analytics](https://agent-docs.azurewebsites.net/api-reference/analytics/get-attempts).
