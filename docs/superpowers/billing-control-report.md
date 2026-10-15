# Billing control verification — 2026-10-13

Changed only `backend/api/billing.py`, `backend/tests/test_billing_control.py`, `backend/migrations/20261013_payment_receipts.sql`, and this report. No commits, deployments, external payments, or unrelated edits.

Both checkout callbacks and `payment.captured`/`order.paid` webhooks now fetch the authoritative Razorpay payment and order. Access requires the order's buyer and plan notes, exact Starter 49900/Growth 149900 paise amount, INR on both entities, matching identifiers, captured payment, zero refunded amount, and paid order. Payment entity notes never choose the buyer. HMAC checks remain unchanged.

Subscription extension and durable receipt insertion commit together. Payment primary key and unique order prevent duplicate grants and reattribution; PostgreSQL transaction advisory locks cover buyer/payment/order identities even before rows exist. SQLite uses `BEGIN IMMEDIATE`. Duplicate events preserve the existing end date and calls used. Pending checkout order creation no longer overwrites the last paid order.

Actual refunded or failed matching receipts revoke their remaining grant once, preserve independently paid periods, and prevent delayed capture from reactivating a refund. A processed partial refund conservatively cancels that purchase's remaining grant. Failed attempts for another payment do not revoke paid access. Refunds not yet reflected in Razorpay's fetched payment return 503 for webhook retry. Blocking provider requests and database work run in the webhook thread pool.

Owner-granted active/trial access is exposed separately as `access_source: owner`, with its expiry and configured calls quota. It does not create a paid subscription or payment receipt. Expired/blocked owner controls expose zero call allowance. Existing `calls_used` follows the subscription counter; developer control's monthly usage ledger remains the authoritative calendar-month meter.

Executed successfully:

- `backend/.venv312/Scripts/python.exe backend/tests/test_billing_control.py`: isolated temporary file SQLite; real endpoint signatures, foreign buyer, amount/currency/order/status rejection on both routes, sequential and 16 concurrent callback/webhook replays, concurrent separate renewals, receipts, actual/partial/early refunds, unrelated and matching failures, legacy latest-payment import, manual access expiry/block, and PostgreSQL lock statement/key checks.
- Existing `backend/tests/test_billing_signatures.py` with `AUTO_CREATE_SCHEMA=false`: passed.
- Python compilation of billing and its new test; `git diff --check`: passed.

The sandbox blocks the installed `orjson` DLL. Runtime tests therefore used the exact approved test commands outside the sandbox; no dependency installation was needed. The test client reports an existing httpx deprecation warning.

Production prerequisites and limits:

- Apply the receipt migration before API rollout using the trusted backend database role. The ledger has RLS enabled and no client-write policy.
- Migration backfills the latest payment retained by each historical subscription. Earlier payment IDs were overwritten by the old schema and cannot be recovered locally; reconcile prior renewals from Razorpay before production to fully close historical replay coverage. Latest legacy callback replay is covered without extension.
- Razorpay calls are mocked in these tests. No live checkout/refund/webhook was sent. PostgreSQL SQL/lock behavior is inspected but not exercised against a live PostgreSQL instance; run concurrent integration checks there before production.
- Existing production security prerequisites from AGENTS.md still apply, including secret rotation and authoritative authentication. This change performs no deployment.

Provider semantics checked against [Razorpay's payment webhook documentation](https://github.com/razorpay/markdown-docs/blob/master/webhooks/payments.md), [refund webhook documentation](https://github.com/razorpay/markdown-docs/blob/master/webhooks/refunds.md), and [order fetch documentation](https://razorpay.com/docs/api/orders/fetch-with-id/). Razorpay orders can remain paid after refund, so fetched payment refund state is also required.
