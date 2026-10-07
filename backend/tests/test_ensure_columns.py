"""A column added to a model after its table exists must not 500 the app.

This is the bug that read as "Rudra24 AI backend is unavailable": tenant_limits
was created before the `ai` meter existed, create_all() does not touch existing
tables, and every query on it died with "no such column: tenant_limits.ai_per_day".
"""
import os
import sqlite3
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def test_missing_column_is_added_and_rerun_is_a_no_op():
    tmp = tempfile.mkdtemp()
    db = os.path.join(tmp, "t.db")

    # A table as it was BEFORE the column was added to the model, with a row in it.
    con = sqlite3.connect(db)
    con.execute("CREATE TABLE tenant_limits (owner_user_id TEXT PRIMARY KEY, leads_per_day INTEGER)")
    con.execute("INSERT INTO tenant_limits VALUES ('u1', 50)")
    con.commit()
    con.close()

    os.environ["DATABASE_URL"] = f"sqlite:///{db}"
    os.environ["APP_ENV"] = "development"
    for mod in [m for m in list(sys.modules) if m.startswith("api.")]:
        del sys.modules[mod]

    from api import limits  # noqa: F401  - registers TenantLimits on Base
    from api.auth_sync import ensure_columns

    added = ensure_columns()
    assert "tenant_limits.ai_per_day" in added, added

    con = sqlite3.connect(db)
    cols = {r[1] for r in con.execute("PRAGMA table_info(tenant_limits)")}
    assert {"ai_per_day", "ai_used", "ai_total"} <= cols, cols

    # The existing row survives and picks up the declared default.
    row = con.execute("SELECT leads_per_day, ai_per_day, ai_used FROM tenant_limits").fetchone()
    assert row == (50, 300, 0), row
    con.close()

    assert ensure_columns() == [], "second run must add nothing"


if __name__ == "__main__":
    test_missing_column_is_added_and_rerun_is_a_no_op()
    print("PASS")
