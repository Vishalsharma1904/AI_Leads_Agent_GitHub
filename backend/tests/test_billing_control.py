"""Run: backend/.venv312/Scripts/python.exe backend/tests/test_billing_control.py.

Real file-backed SQLite, isolated auth module, mocked Razorpay REST only.
"""
import copy
import hashlib
import hmac
import json
import os
import sys
import tempfile
import types
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ["RAZORPAY_KEY_ID"] = "billing-test-key"
os.environ["RAZORPAY_KEY_SECRET"] = "billing-test-secret"
os.environ["RAZORPAY_WEBHOOK_SECRET"] = "billing-test-webhook"

from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from sqlalchemy import Column, Float, String, Text, create_engine
from sqlalchemy.orm import declarative_base, sessionmaker

temporary = tempfile.TemporaryDirectory(prefix="billing-control-")
engine = create_engine("sqlite:///" + str(Path(temporary.name) / "billing.db"),
                       connect_args={"check_same_thread": False, "timeout": 30})
Base = declarative_base()


class UserAccount(Base):
    __tablename__ = "billing_test_users"
    id = Column(String(64), primary_key=True)


Session = sessionmaker(bind=engine, expire_on_commit=False)
CURRENT = {"id": "buyer"}


def get_db():
    with Session() as db:
        yield db


auth = types.ModuleType("api.auth_sync")
for key, value in {"AUTO_CREATE_SCHEMA": True, "Base": Base, "UserAccount": UserAccount,
                   "engine": engine, "get_db": get_db,
                   "get_current_user": lambda: UserAccount(id=CURRENT["id"])}.items():
    setattr(auth, key, value)
sys.modules["api.auth_sync"] = auth


class AccountControl(Base):
    __tablename__ = "account_controls"
    user_id = Column(String(64), primary_key=True)
    status = Column(String(16), default="pending")
    expires_at = Column(Float, default=0)
    features = Column(Text, default="{}")
    monthly_limits = Column(Text, default="{}")


control = types.ModuleType("services.developer_control")
control.AccountControl = AccountControl
class UsageEvent(Base):
    __tablename__ = 'control_usage'
    id = Column(String(36), primary_key=True)
    user_id = Column(String(64))
    meter = Column(String(32))
    amount = Column(Float, default=0)
    state = Column(String(24), default='succeeded')
    created_at = Column(Float, default=0)
control.UsageEvent = UsageEvent
limits_module = types.ModuleType('api.limits')
from datetime import timedelta, timezone
limits_module.IST = timezone(timedelta(hours=5, minutes=30))
sys.modules['api.limits'] = limits_module
sys.modules["services.developer_control"] = control
from api import billing

NOW = 1_800_000_000.0
billing.time = types.SimpleNamespace(time=lambda: NOW)
app = FastAPI()
app.include_router(billing.router)
client = TestClient(app)
ORDERS, PAYMENTS, FETCHES = {}, {}, []


def purchase(suffix, buyer="buyer", plan="starter"):
    amount = billing.PLANS[plan]["amount_paise"]
    order = {"id": "order_" + suffix, "amount": amount, "currency": "INR", "status": "paid",
             "notes": {"owner_user_id": buyer, "plan": plan}}
    payment = {"id": "pay_" + suffix, "order_id": order["id"], "amount": amount,
               "currency": "INR", "status": "captured", "captured": True, "amount_refunded": 0}
    ORDERS[order["id"]], PAYMENTS[payment["id"]] = order, payment
    return order, payment


def fake_fetch(kind, identifier):
    FETCHES.append((kind, identifier))
    entity = (ORDERS if kind == "orders" else PAYMENTS).get(identifier)
    if entity is None:
        raise HTTPException(502, "Missing provider entity")
    return copy.deepcopy(entity)


def verify(order, payment, signature=None):
    signature = signature or hmac.new(b"billing-test-secret",
        f'{order["id"]}|{payment["id"]}'.encode(), hashlib.sha256).hexdigest()
    return client.post("/api/v1/billing/verify", json={"razorpay_order_id": order["id"],
        "razorpay_payment_id": payment["id"], "razorpay_signature": signature})


def event(name, order, payment, **extra):
    payload = {"payment": {"entity": copy.deepcopy(payment)}}
    if name == "order.paid":
        payload["order"] = {"entity": copy.deepcopy(order)}
    payload.update(extra)
    raw = json.dumps({"event": name, "payload": payload}).encode()
    signature = hmac.new(b"billing-test-webhook", raw, hashlib.sha256).hexdigest()
    return client.post("/api/v1/billing/webhook", content=raw,
                       headers={"X-Razorpay-Signature": signature})


def snapshot(owner="buyer"):
    with Session() as db:
        row = db.query(billing.Subscription).filter_by(owner_user_id=owner).one()
        return row.status, row.period_end, row.calls_used, row.plan


def checks():
    assert billing.PLANS["starter"]["amount_paise"] == 49900
    assert billing.PLANS["growth"]["amount_paise"] == 149900
    order, payment = purchase("first")
    assert verify(order, payment, "a" * 64).status_code == 400
    assert not FETCHES, "bad signature reached provider"
    CURRENT["id"] = "other"
    assert verify(order, payment).status_code == 403
    with Session() as db:
        assert db.query(billing.Subscription).count() == 0
    CURRENT["id"] = "buyer"

    for kind, key, wrong in [
        ("payment", "amount", 1), ("order", "amount", 149900),
        ("payment", "currency", "USD"), ("order", "currency", "USD"),
        ("payment", "order_id", "order_foreign"), ("payment", "status", "authorized"),
        ("payment", "captured", False), ("payment", "amount_refunded", 1),
        ("order", "status", "attempted"), ("order", "notes", {}),
    ]:
        target = payment if kind == "payment" else order
        previous = copy.deepcopy(target[key])
        target[key] = wrong
        assert verify(order, payment).status_code == 400, (kind, key)
        if key != "amount_refunded":
            expected_status = 502 if key == "order_id" else 400
            assert event("order.paid", order, payment).status_code == expected_status, (kind, key)
        target[key] = previous

    assert verify(order, payment).json()["active"] is True
    first_end = snapshot()[1]
    with Session() as db:
        row = db.query(billing.Subscription).one()
        row.calls_used = 9
        db.commit()
    assert verify(order, payment).status_code == 200
    # Payment entity notes are optional and cannot reattribute the order buyer.
    payment["notes"] = {"owner_user_id": "other", "plan": "growth"}
    assert event("payment.captured", order, payment).status_code == 200
    assert event("order.paid", order, payment).status_code == 200
    assert snapshot() == ("active", first_end, 9, "starter")
    with Session() as db:
        assert db.query(billing.PaymentReceipt).count() == 1
        assert db.query(billing.Subscription).filter_by(owner_user_id="other").count() == 0

    # A checkout from another tab cannot overwrite a receipt's buyer/plan.
    changed_order = copy.deepcopy(order)
    changed_order["notes"]["owner_user_id"] = "other"
    with Session() as db:
        try:
            billing.apply_verified_payment(db, "other", changed_order, payment)
            raise AssertionError("reattribution accepted")
        except HTTPException as exc:
            assert exc.status_code == 409

    def concurrent(item):
        channel, purchase_pair = item
        this_order, this_payment = purchase_pair
        if channel == "callback":
            response = verify(this_order, this_payment)
        else:
            response = event(channel, this_order, this_payment)
        assert response.status_code == 200, response.text

    second = purchase("second", plan="growth")
    with ThreadPoolExecutor(max_workers=8) as pool:
        list(pool.map(concurrent, [(channel, second) for channel in
                 ["callback", "payment.captured", "order.paid", "callback"] * 4]))
    assert snapshot()[1] == first_end + billing.MONTH_SECONDS
    with Session() as db:
        assert db.query(billing.PaymentReceipt).count() == 2
    # Two independent orders for the same buyer cannot lose an extension.
    third, fourth = purchase("third"), purchase("fourth")
    with ThreadPoolExecutor(max_workers=2) as pool:
        list(pool.map(concurrent, [("callback", third), ("order.paid", fourth)]))
    assert snapshot()[1] == first_end + 3 * billing.MONTH_SECONDS

    # An unrelated failed attempt never revokes a successful purchase.
    failed_order, failed_payment = purchase("failed")
    failed_payment.update(status="failed", captured=False)
    assert event("payment.failed", failed_order, failed_payment).json()["reversed"] is False
    assert snapshot()[0] == "active"
    earlier_attempt = copy.deepcopy(payment)
    earlier_attempt.update(id='pay_earlier_failed', status='failed', captured=False)
    PAYMENTS[earlier_attempt['id']] = earlier_attempt
    assert event('payment.failed', order, earlier_attempt).status_code == 200
    assert snapshot()[0] == 'active'
    # A misleading failure notification is ignored when fetched payment is captured.
    assert event("payment.failed", order, payment).json()["reversed"] is False
    assert event("refund.processed", order, payment).status_code == 503

    order2, payment2 = second
    payment2.update(status="refunded", amount_refunded=payment2["amount"], captured=False)
    assert event("refund.processed", order2, payment2,
                 refund={"entity": {"payment_id": payment2["id"]}}).json()["reversed"] is True
    assert snapshot()[1] == first_end + 2 * billing.MONTH_SECONDS
    assert event("payment.refunded", order2, payment2).status_code == 200
    assert event("payment.captured", order2, payment2).status_code == 200
    assert snapshot()[1] == first_end + 2 * billing.MONTH_SECONDS
    assert verify(order2, payment2).status_code == 400

    # Refund arrives before a callback whose provider snapshot was captured.
    reversed_order, reversed_payment = purchase("early", buyer="refundbuyer")
    stale = copy.deepcopy(reversed_payment)
    reversed_payment.update(status="refunded", amount_refunded=reversed_payment["amount"])
    assert event("payment.refunded", reversed_order, reversed_payment).status_code == 200
    with Session() as db:
        try:
            billing.apply_verified_payment(db, "refundbuyer", reversed_order, stale)
            raise AssertionError("refunded payment reactivated")
        except HTTPException as exc:
            assert exc.status_code == 409

    lone_order, lone_payment = purchase("lone", buyer="lonebuyer")
    assert event("order.paid", lone_order, lone_payment).status_code == 200
    lone_payment.update(amount_refunded=1)  # conservatively cancel a partially refunded grant
    assert event("refund.processed", lone_order, lone_payment).status_code == 200
    assert snapshot("lonebuyer")[0] == "refunded"

    # Import last legacy receipt without granting an extra month.
    legacy_order, legacy_payment = purchase("legacy", buyer="legacybuyer")
    with Session() as db:
        db.add(billing.Subscription(owner_user_id="legacybuyer", plan="starter", status="active",
             period_start=NOW, period_end=NOW + billing.MONTH_SECONDS, calls_used=4,
             order_id=legacy_order["id"], payment_id=legacy_payment["id"]))
        db.commit()
    CURRENT["id"] = "legacybuyer"
    assert verify(legacy_order, legacy_payment).status_code == 200
    assert snapshot("legacybuyer")[1:3] == (NOW + billing.MONTH_SECONDS, 4)

    # Refunded legacy purchase is revoked even before its first receipt import.
    old_order, old_payment = purchase("oldrefund", buyer="oldbuyer")
    with Session() as db:
        db.add(billing.Subscription(owner_user_id="oldbuyer", plan="starter", status="active",
             period_start=NOW, period_end=NOW + billing.MONTH_SECONDS, calls_used=0,
             order_id=old_order["id"], payment_id=old_payment["id"]))
        db.commit()
    old_payment.update(status="refunded", amount_refunded=old_payment["amount"])
    assert event("payment.refunded", old_order, old_payment).status_code == 200
    assert snapshot("oldbuyer")[0] == "refunded"

    failure_order, failure_payment = purchase("matchedfailure", buyer="failedbuyer")
    assert event("order.paid", failure_order, failure_payment).status_code == 200
    failure_payment.update(status="failed", captured=False)
    assert event("payment.failed", failure_order, failure_payment).json()["reversed"] is True
    assert snapshot("failedbuyer")[0] == "failed"

    # Owner grants are separate from paid receipts and expire/disable correctly.
    with Session() as db:
        db.add(AccountControl(user_id="manualbuyer", status="trial", expires_at=NOW + 600,
                              monthly_limits='{"calls": 37}'))
        db.commit()
        old = billing._row(db, 'manualbuyer')
        old.calls_used = 999
        db.commit()
        ent = billing.entitlement(UserAccount(id="manualbuyer"), db)
        assert ent["active"] and ent["access_source"] == "owner" and ent["plan"] == ""
        assert ent["call_quota"] == 37
        assert billing.require_calling(UserAccount(id="manualbuyer"), db).status == "none"
        assert db.query(billing.PaymentReceipt).filter_by(owner_user_id="manualbuyer").count() == 0
        policy = db.query(AccountControl).filter_by(user_id="manualbuyer").one()
        policy.expires_at = NOW - 1
        db.commit()
        assert not billing.entitlement(UserAccount(id="manualbuyer"), db)["active"]
        try:
            billing.require_calling(UserAccount(id="manualbuyer"), db)
            raise AssertionError("expired owner access allowed")
        except HTTPException as exc:
            assert exc.status_code == 402
        policy.expires_at, policy.status = NOW + 600, "blocked"
        db.commit()
        assert billing.entitlement(UserAccount(id="manualbuyer"), db)["calls_left"] == 0

    # Order id remains unique even if a new payment id is presented.
    alternate = copy.deepcopy(payment)
    alternate["id"] = "pay_alternate"
    with Session() as db:
        try:
            billing.apply_verified_payment(db, "buyer", order, alternate)
            raise AssertionError("order paid twice")
        except HTTPException as exc:
            assert exc.status_code == 409

    # PostgreSQL locks include missing rows and acquire shared identities in order.
    statements = []
    fake_db = types.SimpleNamespace(rollback=lambda: None,
        get_bind=lambda: types.SimpleNamespace(dialect=types.SimpleNamespace(name="postgresql")),
        execute=lambda statement, params: statements.append((str(statement), params["key"])))
    billing._lock_purchase(fake_db, "buyer", "order_first", "pay_first")
    assert len(statements) == 3
    assert all(sql == "SELECT pg_advisory_xact_lock(:key)" and -(2**63) <= key < 2**63 for sql, key in statements)


if __name__ == "__main__":
    try:
        # Real fetch helper rejects path injection and swapped provider entities.
        for kind, identifier in [("orders", "order_bad/path"), ("payments", "order_wrong")]:
            try:
                billing._fetch_entity(kind, identifier)
                raise AssertionError("unsafe provider id")
            except HTTPException as exc:
                assert exc.status_code == 400
        response = types.SimpleNamespace(status_code=200, json=lambda: {"id": "pay_wrong"})
        with patch.object(billing.httpx, "get", return_value=response):
            try:
                billing._fetch_entity("payments", "pay_expected")
                raise AssertionError("wrong provider payment accepted")
            except HTTPException as exc:
                assert exc.status_code == 502
        with patch.object(billing, "_fetch_entity", side_effect=fake_fetch):
            checks()
        print("billing control checks passed (binding, replay, concurrency, refunds, legacy receipts)")
    finally:
        client.close()
        engine.dispose()
        temporary.cleanup()
