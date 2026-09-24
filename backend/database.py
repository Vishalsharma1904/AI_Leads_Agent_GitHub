import os
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.ext.declarative import declarative_base

APP_ENV = os.getenv("APP_ENV", "development").strip().lower()
configured_database_url = os.getenv("DATABASE_URL", "").strip()
if APP_ENV == "production":
    SQLALCHEMY_DATABASE_URL = configured_database_url
    if not SQLALCHEMY_DATABASE_URL or SQLALCHEMY_DATABASE_URL.startswith("sqlite"):
        raise RuntimeError("DATABASE_URL must be a PostgreSQL URL in production")
elif os.getenv("USE_POSTGRES_DEV", "false").strip().lower() == "true" and configured_database_url:
    SQLALCHEMY_DATABASE_URL = configured_database_url
else:
    SQLALCHEMY_DATABASE_URL = "sqlite:///./skylark_cloud.db"

engine_options = {"pool_pre_ping": True}
if SQLALCHEMY_DATABASE_URL.startswith("sqlite"):
    engine_options["connect_args"] = {"check_same_thread": False}
engine = create_engine(SQLALCHEMY_DATABASE_URL, **engine_options)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
