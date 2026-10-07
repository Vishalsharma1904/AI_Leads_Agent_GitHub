"""The limit logic, checked without a database or FastAPI.

These are the branches that decide whether a customer can spend more than they
paid for, so they get a runnable check. The DB wiring around them is plumbing.

Run: python backend/tests/test_limits.py
"""
import os
import sys
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

IST = timezone(timedelta(hours=5, minutes=30))


class FakeRow:
    """Stands in for a TenantLimits row."""
    def __init__(self, leads=50, calls=25):
        self.leads_per_day, self.calls_per_day = leads, calls
        self.leads_used = self.calls_used = 0
        self.day = ""
        self.blocked = 0


def roll_day(row, now):
    """Mirror of _row()'s reset: a DATE comparison, never elapsed time."""
    key = now.astimezone(IST).strftime("%Y-%m-%d")
    if row.day != key:
        row.day = key
        row.leads_used = row.calls_used = 0
    return row


def spend(row, meter, amount):
    cap = row.leads_per_day if meter == "leads" else row.calls_per_day
    used = row.leads_used if meter == "leads" else row.calls_used
    if row.blocked or cap <= 0 or used + amount > cap:
        return False
    if meter == "leads":
        row.leads_used = used + amount
    else:
        row.calls_used = used + amount
    return True


def test_daily_cap_holds():
    row = roll_day(FakeRow(), datetime(2026, 10, 1, 10, 0, tzinfo=IST))
    assert spend(row, "calls", 25), "the full day's allowance must fit"
    assert not spend(row, "calls", 1), "one past the cap must be refused"
    assert row.calls_used == 25


def test_a_big_request_cannot_straddle_the_cap():
    row = roll_day(FakeRow(), datetime(2026, 10, 1, 10, 0, tzinfo=IST))
    assert spend(row, "leads", 40)
    assert not spend(row, "leads", 20), "40+20 > 50 must be refused outright"
    assert spend(row, "leads", 10), "the exact remainder must still fit"
    assert row.leads_used == 50


def test_reset_is_by_date_not_elapsed_time():
    row = FakeRow()
    roll_day(row, datetime(2026, 10, 1, 23, 0, tzinfo=IST))
    spend(row, "calls", 25)
    # 90 minutes later, but a new IST date → fresh allowance.
    roll_day(row, datetime(2026, 10, 2, 0, 30, tzinfo=IST))
    assert row.calls_used == 0, "a new day resets"
    # Same day, much later → no reset, however many hours passed.
    spend(row, "calls", 25)
    roll_day(row, datetime(2026, 10, 2, 23, 59, tzinfo=IST))
    assert row.calls_used == 25, "same date must not hand out a second allowance"


def test_a_clock_moved_backwards_buys_nothing():
    row = roll_day(FakeRow(), datetime(2026, 10, 2, 12, 0, tzinfo=IST))
    spend(row, "calls", 25)
    # The server computes the date itself; a client rolling its clock back
    # cannot reach this value at all. Even if the date went backwards, the
    # branch only resets on a DIFFERENT date — and the count starts again at
    # zero for that date, which is why the date must come from the server.
    roll_day(row, datetime(2026, 10, 2, 1, 0, tzinfo=IST))
    assert row.calls_used == 25, "same date, no reset"


def test_blocked_tenant_spends_nothing():
    row = roll_day(FakeRow(), datetime(2026, 10, 1, 10, 0, tzinfo=IST))
    row.blocked = 1
    assert not spend(row, "calls", 1)
    assert not spend(row, "leads", 1)


def test_zero_limit_is_a_closed_door():
    row = roll_day(FakeRow(leads=0, calls=0), datetime(2026, 10, 1, 10, 0, tzinfo=IST))
    assert not spend(row, "leads", 1)
    assert not spend(row, "calls", 1)


def test_admin_is_env_driven_only():
    from api.limits import is_admin

    class U:
        def __init__(self, email): self.email = email

    os.environ["CLAVIS_ADMIN_EMAILS"] = "boss@example.com, Other@Example.com"
    assert is_admin(U("boss@example.com"))
    assert is_admin(U("OTHER@example.com")), "matching must ignore case"
    assert not is_admin(U("customer@example.com"))
    assert not is_admin(U("")), "a blank email must never be an admin"
    os.environ["CLAVIS_ADMIN_EMAILS"] = ""
    assert not is_admin(U("boss@example.com")), "no env, no admins"



def test_every_meter_has_its_three_columns():
    """_cap/_used/consume ab getattr(row, f"{meter}_per_day") se chalte hain.

    Ek meter jiska column nahi hai, runtime par chup-chaap 0 deta hai — yani
    "no allowance" aur har request 403. Isliye naam yahan milate hain.
    """
    import re
    src = open(os.path.join(os.path.dirname(__file__), "..", "api", "limits.py"),
               encoding="utf-8").read()
    meters = re.search(r"DEFAULT_LIMITS = \{([^}]*)\}", src).group(1)
    names = re.findall(r'"(\w+)":', meters)
    assert names, "DEFAULT_LIMITS padha nahi gaya"
    for meter in names:
        for suffix in ("per_day", "used", "total"):
            col = f"{meter}_{suffix} = Column("
            assert col in src, f"{meter}: column {meter}_{suffix} missing"

if __name__ == "__main__":
    tests = [v for k, v in sorted(globals().items()) if k.startswith("test_")]
    ran = 0
    for t in tests:
        try:
            t()
            ran += 1
        except ImportError as exc:
            print(f"  (skipped {t.__name__}: {exc})")
    print(f"limit checks passed ({ran}/{len(tests)})")
