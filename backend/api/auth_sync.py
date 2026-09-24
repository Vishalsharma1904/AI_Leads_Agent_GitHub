import hashlib
import json
import os
import re
import secrets
import time
from typing import Any, Dict, Optional

import jwt
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from dotenv import load_dotenv
from pydantic import BaseModel, Field, validator
from jwt import PyJWKClient
from sqlalchemy import Column, Integer, String, Text, Float, create_engine
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker, Session

load_dotenv()

DB_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "skylark_cloud.db")
APP_ENV = os.getenv("APP_ENV", "development").strip().lower()
configured_database_url = os.getenv("DATABASE_URL", "").strip()
# Development should work out of the box even when the optional local
# PostgreSQL service is not installed. Production remains PostgreSQL-only;
# developers can opt into Postgres locally with USE_POSTGRES_DEV=true.
if APP_ENV == "production":
    DATABASE_URL = configured_database_url
    if not DATABASE_URL or DATABASE_URL.startswith("sqlite"):
        raise RuntimeError("DATABASE_URL must be a PostgreSQL URL in production")
elif os.getenv("USE_POSTGRES_DEV", "false").strip().lower() == "true" and configured_database_url:
    DATABASE_URL = configured_database_url
else:
    DATABASE_URL = f"sqlite:///{DB_PATH}"
engine_options = {"pool_pre_ping": True}
if DATABASE_URL.startswith("sqlite"):
    engine_options["connect_args"] = {"check_same_thread": False}
engine = create_engine(DATABASE_URL, **engine_options)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


class UserAccount(Base):
    __tablename__ = "user_accounts"

    id = Column(String(64), primary_key=True, index=True)
    email = Column(String(255), unique=True, index=True, nullable=False)
    password_hash = Column(String(255), nullable=True)
    salt = Column(String(64), nullable=True)
    name = Column(String(255), nullable=False)
    company = Column(String(255), nullable=True)
    phone = Column(String(64), nullable=True)
    role = Column(String(64), default="Owner")
    avatar = Column(String(255), nullable=True)
    created_at = Column(Float, default=time.time)
    last_login = Column(Float, default=time.time)


class UserCloudData(Base):
    __tablename__ = "user_cloud_data"

    id = Column(Integer, primary_key=True, autoincrement=True)
    email = Column(String(255), index=True, nullable=False)
    data_type = Column(String(64), index=True, nullable=False)
    payload = Column(Text, nullable=False)
    updated_at = Column(Float, default=time.time)


AUTO_CREATE_SCHEMA = os.getenv("AUTO_CREATE_SCHEMA", "true" if APP_ENV != "production" else "false").lower() == "true"
if AUTO_CREATE_SCHEMA:
    Base.metadata.create_all(bind=engine)
SUPABASE_URL = os.getenv("SUPABASE_URL", "").strip().rstrip("/")
SUPABASE_JWT_SECRET = os.getenv("SUPABASE_JWT_SECRET", "").strip()
SUPABASE_ISSUER = f"{SUPABASE_URL}/auth/v1" if SUPABASE_URL else ""
SUPABASE_JWKS_URL = os.getenv("SUPABASE_JWKS_URL", "").strip() or (f"{SUPABASE_ISSUER}/.well-known/jwks.json" if SUPABASE_ISSUER else "")
_supabase_jwks = PyJWKClient(SUPABASE_JWKS_URL) if SUPABASE_JWKS_URL else None
bearer_scheme = HTTPBearer(auto_error=False)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def user_payload(user: UserAccount) -> Dict[str, Any]:
    return {"id": user.id, "email": user.email, "name": user.name,
            "company": user.company, "phone": user.phone, "role": user.role,
            "avatar": user.avatar}


def _verify_supabase_token(token: str) -> Dict[str, Any]:
    if not SUPABASE_URL or (not SUPABASE_JWT_SECRET and not _supabase_jwks):
        raise HTTPException(status_code=503, detail="Supabase authentication is not configured")
    try:
        header = jwt.get_unverified_header(token)
        algorithm = str(header.get("alg", ""))
        if algorithm == "HS256":
            if not SUPABASE_JWT_SECRET:
                raise jwt.InvalidTokenError("symmetric verification is not configured")
            key = SUPABASE_JWT_SECRET
            algorithms = ["HS256"]
        else:
            if not _supabase_jwks:
                raise jwt.InvalidTokenError("jwks verification is not configured")
            key = _supabase_jwks.get_signing_key_from_jwt(token).key
            algorithms = ["RS256", "ES256"]
        claims = jwt.decode(token, key, algorithms=algorithms, audience="authenticated",
                            issuer=SUPABASE_ISSUER, options={"require": ["sub", "exp", "iat"]})
        if not str(claims.get("sub", "")).strip():
            raise jwt.InvalidTokenError("missing subject")
        return claims
    except (jwt.PyJWTError, Exception) as exc:
        if isinstance(exc, HTTPException):
            raise
        raise HTTPException(status_code=401, detail="Invalid or expired Supabase session") from None


def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme),
                     db: Session = Depends(get_db)) -> UserAccount:
    if not credentials or credentials.scheme.lower() != "bearer":
        raise HTTPException(status_code=401, detail="Authentication required")
    claims = _verify_supabase_token(credentials.credentials)
    subject = str(claims["sub"]).strip()
    email = str(claims.get("email", "")).strip().lower()
    if not email or "@" not in email:
        raise HTTPException(status_code=401, detail="Supabase session has no verified email")
    metadata = claims.get("user_metadata") or {}
    name = str(metadata.get("full_name") or metadata.get("name") or email.split("@")[0]).strip()[:255]
    avatar = str(metadata.get("avatar_url") or metadata.get("picture") or "").strip()[:255]
    user = db.query(UserAccount).filter(UserAccount.id == subject).first()
    if not user:
        user = db.query(UserAccount).filter(UserAccount.email == email).first()
    if not user:
        user = UserAccount(id=subject, email=email, name=name or "User", company="Workspace",
                           phone="", role="Owner", avatar=avatar, created_at=time.time(), last_login=time.time())
        db.add(user)
    else:
        user.id = subject
        user.email = email
        user.name = name or user.name or "User"
        user.avatar = avatar or user.avatar
        user.last_login = time.time()
    db.commit()
    db.refresh(user)
    return user


def require_account(current_user: UserAccount, requested_email: str) -> str:
    clean_email = requested_email.strip().lower()
    if clean_email != current_user.email:
        raise HTTPException(status_code=403, detail="Requested account does not match the authenticated user")
    return clean_email


def get_all_user_data(email: str, db: Session) -> Dict[str, Any]:
    records = db.query(UserCloudData).filter(UserCloudData.email == email.lower()).all()
    result = {}
    for record in records:
        try:
            result[record.data_type] = json.loads(record.payload)
        except Exception:
            result[record.data_type] = record.payload
    return result


class PushDataRequest(BaseModel):
    email: str = Field(min_length=5, max_length=320)
    data_type: str = Field(min_length=1, max_length=64, pattern=r"^[a-zA-Z0-9_.-]+$")
    payload: Any

    @validator("payload")
    def bounded_payload(cls, value):
        if len(json.dumps(value, ensure_ascii=False, default=str)) > 2_000_000:
            raise ValueError("Sync payload is too large")
        return value


router = APIRouter(prefix="/api", tags=["auth_and_sync"])


@router.get("/sync/pull")
def pull_sync_data(email: str, db: Session = Depends(get_db), current_user: UserAccount = Depends(get_current_user)):
    clean_email = require_account(current_user, email)
    return {"success": True, "email": clean_email, "user": user_payload(current_user),
            "data": get_all_user_data(clean_email, db), "synced_at": time.time()}


@router.post("/sync/push")
def push_sync_data(req: PushDataRequest, db: Session = Depends(get_db), current_user: UserAccount = Depends(get_current_user)):
    clean_email = require_account(current_user, req.email)
    if not req.data_type or len(req.data_type) > 64:
        raise HTTPException(status_code=400, detail="Invalid data type")
    payload_str = json.dumps(req.payload) if not isinstance(req.payload, str) else req.payload
    existing = db.query(UserCloudData).filter(UserCloudData.email == clean_email,
                                               UserCloudData.data_type == req.data_type).first()
    if existing:
        existing.payload = payload_str
        existing.updated_at = time.time()
    else:
        db.add(UserCloudData(email=clean_email, data_type=req.data_type,
                             payload=payload_str, updated_at=time.time()))
    db.commit()
    return {"success": True, "message": f"Successfully synced {req.data_type}", "updated_at": time.time()}
