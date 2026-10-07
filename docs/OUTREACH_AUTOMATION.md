# Email and WhatsApp outreach

## Email Auto

Email Auto now sends through the Google account that the signed-in user authorizes. Entering an address is an account selection hint; it cannot grant permission to send from an arbitrary mailbox. The address entered on the page must match the Google OAuth account shown as connected. The backend reads that identity from the encrypted, tenant-scoped Google connection and calls Gmail `users/me/messages/send`.

1. The **app owner** configures one Google Cloud OAuth web client. Enable Gmail API; add `https://www.googleapis.com/auth/gmail.send` and `https://www.googleapis.com/auth/gmail.readonly` to the consent screen; register `{CONNECTOR_PUBLIC_BASE_URL}/api/v1/connectors/oauth/google_workspace/callback` as an authorized redirect URI. Set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `CREDENTIAL_MASTER_KEY`, and `CONNECTOR_PUBLIC_BASE_URL` in the backend environment. Keep values out of frontend files. An external public app may need Google verification and, for the restricted Gmail read scope, a security assessment.
2. Each **email account owner** signs into the app, opens **Email Auto**, clicks **Sign in with Google**, chooses their Gmail account, and approves send/read permission in the Google tab. No per-user Google Cloud credentials or app passwords are needed. The app checks the connection when they return and fills the verified sender address.
3. Open the **Inbox** tab to search and read messages. Messages are fetched on demand through the authenticated backend and rendered as plain text. The app does not store mail bodies in its database. **Summarize with AI** sends only the selected message text to the configured AI provider when clicked.
4. Choose **Leads not emailed yet** or **All leads with email**, set the batch size and delay, and review the recipient list. Subject and body support `{Company}`, `{City}`, `{JobTitle}`, `{Name}`, and the other tokens shown in the editor. Send a test to the connected account first.
5. Click **Send this batch**. The app sends one message per lead and marks a lead emailed only after Gmail returns a message ID. Cancel stops after the in-flight request. Failed entries can be retried deliberately. If the network result is unknown, the batch stops; check Gmail Sent before retrying to avoid duplicates.

The on-page guide reflects actual backend connection state and can speak its current step on request. It opens Google's own sign-in tab. Browser isolation prevents this web app from inspecting Google sign-in screens; the user completes Google's login and consent there. The guide detects the resulting connection status when the user returns.

Gmail accepting a message does not guarantee final inbox delivery. Bounce, spam, unsubscribe, and daily provider limits remain the sender account's responsibility. Public Google OAuth use may require Google verification. The legacy `/api/email/send` route now uses the same tenant-scoped Google connection; process-wide SMTP credentials cannot send for arbitrary signed-in users.

Microsoft Outlook has a separate optional workflow under **Use a Microsoft Outlook account instead**. It has its own connection and campaign controls.

## WhatsApp Auto

The WhatsApp page is a review queue for leads with valid phone numbers. It personalizes the message and opens one WhatsApp Web chat at a time. Before opening each chat, the operator confirms that the recipient opted in to WhatsApp messaging. The operator sends in WhatsApp, returns to the app, and clicks **I sent it**. Only that confirmation records `whatsappSent` and updates the lead. **Skip** leaves the lead eligible for later. A public HTTPS brochure link can be included with `{Brochure}`; a browser object URL or local file is not shareable with recipients.

Opening a WhatsApp Web tab does not send a message or prove delivery. Fully unattended business messaging needs a connected WhatsApp Business Cloud API account, an approved business number and templates, and webhook status handling. The current Connectors page lists that provider as setup guidance only.
