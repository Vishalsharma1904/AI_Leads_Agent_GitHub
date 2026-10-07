# Rudra24 AI account setup on Supabase Free

Rudra24 AI uses Supabase Auth for email/password and Google sign-in. Its browser SDK
remembers and refreshes a valid session, so the login screen returns only after
sign-out, session expiry/revocation, or a failed auth-service check. Account data
is stored in `public.clavis_user_data` under the authenticated user's UUID.

## Finish the Supabase project setup

1. In the [Supabase dashboard](https://supabase.com/dashboard/projects), resume
   the project in `backend/.env` if it is paused. If the project no longer
   exists, create a Free project and replace only the `SUPABASE_URL` and
   `SUPABASE_PUBLISHABLE_KEY` values in the gitignored `backend/.env`. Never put
   a secret or service-role key in frontend code.
2. In **Authentication → URL Configuration**, set the site URL and allow
   `http://localhost:3000/` as a redirect URL. Add the actual deployed origin
   before publishing. In **Authentication → Providers**, enable Email and, if
   desired, Google. Google also needs its provider credentials configured in
   the Supabase dashboard.
3. Run [20260930_clavis_user_data_supabase.sql](../backend/migrations/20260930_clavis_user_data_supabase.sql)
   once in that project's SQL Editor. It creates the snapshot table and
   per-user row-level policies. Do not enable public/anonymous access.
4. Restart the Rudra24 AI backend and frontend. Open `http://localhost:3000/`.
   Sign up, verify email if required, then sign in. Reload to check session
   persistence; sign out to check that the login screen returns.
5. In a second browser profile, sign in with the same account and verify that
   leads and Rudra24 AI memory appear. Sign in with a different account and verify
   that its records are separate. The sync badge must say **Cloud Synced** only
   after the database confirms a write; **Offline Vault** means the data is
   still on this device.

Supabase's default email sender is intended for testing and has restrictive
recipient and rate limits. For sign-ups and password resets for arbitrary
users, configure a separate SMTP sender in Supabase Auth. A free sender can
work at small volume, but its limits and domain-verification requirements
must be checked before public launch. Google sign-in does not depend on those
password-email messages.

The current sync format is one account snapshot with an 8 MB row limit. It
covers leads, candidates, profile, safe preferences, chats, facts, scripts,
custom skills and task runs. Provider credentials are deliberately excluded.
Multiple devices editing the same snapshot at the same time can still conflict;
this needs per-record sync before claiming production-grade collaboration.
