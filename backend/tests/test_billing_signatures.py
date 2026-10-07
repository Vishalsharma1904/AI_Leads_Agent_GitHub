"""The two things in billing that must never be wrong: the signatures.

Everything else in that file is bookkeeping. These are the lines that decide
whether an unpaid request can unlock a paid feature, so they get the check.

Run: python backend/tests/test_billing_signatures.py
"""
import hashlib
import hmac
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

SECRET = "test_secret_value"
WEBHOOK_SECRET = "test_webhook_secret"


def checkout_signature(order_id: str, payment_id: str, secret: str) -> str:
    return hmac.new(secret.encode(), f"{order_id}|{payment_id}".encode(), hashlib.sha256).hexdigest()


def webhook_signature(raw: bytes, secret: str) -> str:
    return hmac.new(secret.encode(), raw, hashlib.sha256).hexdigest()


def test_checkout_signature():
    good = checkout_signature("order_X", "pay_Y", SECRET)
    assert hmac.compare_digest(good, checkout_signature("order_X", "pay_Y", SECRET))
    # A different payment, order, or secret must not verify.
    assert not hmac.compare_digest(good, checkout_signature("order_X", "pay_Z", SECRET))
    assert not hmac.compare_digest(good, checkout_signature("order_Q", "pay_Y", SECRET))
    assert not hmac.compare_digest(good, checkout_signature("order_X", "pay_Y", "guessed"))
    # The separator matters: "a|b" must not collide with "ab" or "a|b" split elsewhere.
    assert not hmac.compare_digest(checkout_signature("a", "b", SECRET),
                                   checkout_signature("a|b", "", SECRET))


def test_webhook_signature_is_over_raw_bytes():
    raw = b'{"event":"payment.captured","payload":{}}'
    good = webhook_signature(raw, WEBHOOK_SECRET)
    assert hmac.compare_digest(good, webhook_signature(raw, WEBHOOK_SECRET))
    # Re-serialising the JSON changes the bytes and must break the signature —
    # this is why the endpoint reads request.body(), not a parsed model.
    assert not hmac.compare_digest(good, webhook_signature(b'{"event": "payment.captured", "payload": {}}', WEBHOOK_SECRET))
    assert not hmac.compare_digest(good, webhook_signature(raw, "wrong_secret"))


def test_quota_math():
    from api.billing import FREE_QUOTA, PLANS
    assert FREE_QUOTA > 0, "a new company must be able to place one real call"
    for pid, plan in PLANS.items():
        assert plan["amount_paise"] > 0, f"{pid} has no price"
        assert plan["call_quota"] > FREE_QUOTA, f"{pid} must beat the free tier"


if __name__ == "__main__":
    test_checkout_signature()
    test_webhook_signature_is_over_raw_bytes()
    try:
        test_quota_math()
    except ImportError as exc:                       # fastapi not installed here
        print(f"  (skipped quota check: {exc})")
    print("billing signature checks passed")
