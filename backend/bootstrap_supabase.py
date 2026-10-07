"""Ek baar chalaiye: Supabase par saari tables + RLS bana deta hai.

KYUN YE FILE HAI
----------------
Is repo me do adhoore migration raaste hain:
  - migrations/versions/0001_enterprise_schema.py  -> 5 tables
  - backend/migrations/*.sql                       -> 7 tables
Dono milakar bhi candidate_jobs aur candidate_records nahi bante; wo sirf
SQLAlchemy ke create_all se aate hain. Isliye sahi tarika hai:
  1) create_all  -> models me declare saari 14 tables
  2) *.sql       -> wo cheezein jo create_all nahi karta: ALTER, index, RLS

Dono idempotent hain (CREATE/ADD ... IF NOT EXISTS), isliye dobara chalana
safe hai.

    cd backend
    python bootstrap_supabase.py

ponytail: ye ek-baar ka bootstrap hai, migration tool nahi. Jab schema
badalna rozmarra ka kaam ban jaye, alembic ko poora kijiye aur ise hata dijiye.
"""
from __future__ import annotations

import os
import pathlib
import sys

# create_all tabhi chalta hai jab ye flag on ho — import se PEHLE set karna hai,
# kyunki api/* modules import hote hi apni tables banate hain.
os.environ["AUTO_CREATE_SCHEMA"] = "true"

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from sqlalchemy import text                                    # noqa: E402
from database import engine                                    # noqa: E402
from api.auth_sync import Base                                 # noqa: E402

# Har model file import karni padti hai, warna uski table Base par register
# nahi hoti aur create_all use chhod deta hai.
import api.billing, api.candidate_jobs, api.credentials, api.connectors  # noqa: E402,F401
import api.developer_insights, api.lead_jobs, api.limits  # noqa: E402,F401
import api.sarvam, api.toughtongue                        # noqa: E402,F401

MIGRATIONS = pathlib.Path(__file__).parent / "migrations"


def main() -> int:
    url = str(engine.url)
    if url.startswith("sqlite"):
        print("DATABASE_URL abhi SQLite par hai — backend/.env me Supabase ka\n"
              "connection string daaliye, phir ye script dobara chalaiye.")
        return 1
    print(f"Database: {engine.url.host or '?'}/{engine.url.database or '?'}")

    before = set(_tables())
    Base.metadata.create_all(bind=engine)
    after = set(_tables())
    print(f"  tables: {len(after)} total, {len(after - before)} nayi")

    for path in sorted(MIGRATIONS.glob("*.sql")):
        sql = path.read_text(encoding="utf-8").strip()
        if not sql:
            continue
        try:
            with engine.begin() as conn:
                conn.execute(text(sql))
            print(f"  ok   {path.name}")
        except Exception as exc:                      # noqa: BLE001
            # Ek file ka fail hona baaki ko rokna nahi chahiye — usually ye
            # "pehle se laga hua hai" hota hai. Par chup-chaap nahi.
            print(f"  SKIP {path.name}: {str(exc).splitlines()[0][:120]}")

    print("\nHo gaya. Ab backend/.env me AUTO_CREATE_SCHEMA=false kar dijiye.")
    return 0


def _tables() -> list[str]:
    from sqlalchemy import inspect
    try:
        return inspect(engine).get_table_names()
    except Exception:                                 # noqa: BLE001
        return []


if __name__ == "__main__":
    raise SystemExit(main())
