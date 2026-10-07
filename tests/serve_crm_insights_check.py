"""Loopback-only UI fixture: temporary SQLite, synthetic clients, no live credentials.
Run with backend/.venv312/Scripts/python.exe tests/serve_crm_insights_check.py.
Production authentication and databases are never replaced by this fixture.
"""
import os
import sys
import re
import tempfile
import time
from pathlib import Path
from datetime import datetime, timedelta, timezone

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
os.environ.setdefault("CREDENTIAL_MASTER_KEY", "a" * 64)
from fastapi import FastAPI, Depends, Header, HTTPException
from fastapi.responses import HTMLResponse, FileResponse, Response
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from api.auth_sync import Base, UserAccount, get_db, get_current_user
from api.crm import router, upsert_lead, CRMDeal, CRMActivity
from api.lead_jobs import LeadRecord
from api.developer_insights import ProductSession
from api import crm_automation, crm
crm._supabase_snapshot = lambda *args, **kwargs: {}
import uvicorn

temporary = tempfile.TemporaryDirectory(prefix="rudra-crm-ui-")
engine = create_engine("sqlite:///" + str(Path(temporary.name) / "fixture.sqlite"), connect_args={"check_same_thread": False})
Base.metadata.create_all(engine)
Session = sessionmaker(bind=engine)
today = datetime.now(timezone(timedelta(hours=5, minutes=30))).date()
with Session() as db:
    db.add(UserAccount(id="fixture-owner", email="demo@example.test", name="Design review")); db.commit()
    for i, name in enumerate(["Aranya Hospitality", "Lotus Care Hospital", "Meridian Business Park", "Nila Retail", "Urban Works"]):
        now = time.time() - i * 3 * 86400
        record = upsert_lead(db, "fixture-owner", "sample-" + str(i), {"company": name, "email": "hello@example.test", "contactPerson": "Demo contact", "city": "New Delhi"})
        record.created_at = now; record.stage = "client"
        end = today + timedelta(days=[14, 30, -5, 90, 0][i])
        db.add(CRMDeal(id="contract-" + str(i), owner_user_id="fixture-owner", record_id=record.id, name=["Security services", "Facility staffing", "Housekeeping", "Security services", "Facility support"][i], service_type="Staffing", monthly_amount=[180000, 240000, None, 90000, 120000][i], stage="won", created_at=now, updated_at=now, won_at=now, contract_start_date=datetime.combine(today-timedelta(days=180),datetime.min.time(),timezone.utc).timestamp(), contract_end_date=None if i==4 else datetime.combine(end,datetime.min.time(),timezone.utc).timestamp()))
        db.add(CRMActivity(id="outreach-" + str(i), owner_user_id="fixture-owner", record_id=record.id, kind="outreach", channel="email" if i%2 else "whatsapp", outcome="sent" if i%2 else "unknown", evidence="provider" if i%2 else "pending", occurred_at=now, created_at=now, note="Synthetic review event"))
    db.commit()

app = FastAPI()
app.include_router(router)
def fixture_db():
    with Session() as db: yield db
def fixture_user(authorization: str = Header(""), db=Depends(fixture_db)):
    if authorization != "Bearer fixture-owner": raise HTTPException(401, "Fixture sign-in required")
    return db.get(UserAccount, "fixture-owner")
app.dependency_overrides[get_db] = fixture_db
app.dependency_overrides[get_current_user] = fixture_user

STUB = """window.SKYLARK_CONFIG={BACKEND_URL:location.origin,APIFY_API_KEYS:[],GROQ_API_KEYS:[]};
localStorage.setItem('jarvis_speech_enabled','false');
const fixtureUser={id:'fixture-owner',email:'demo@example.test',user_metadata:{name:'Design review'}};
window.SupabaseAuth={init:async()=>{window.AntigravityAuth?.handleSupabaseSession({user:fixtureUser,access_token:'fixture-owner'});return {success:true}},getUser:()=>fixtureUser,getSession:()=>({user:fixtureUser}),getAccessToken:()=> 'fixture-owner',isRecoveryMode:()=>false,isInitialized:()=>true,getClient:()=>({auth:{getUser:async()=>({data:{user:fixtureUser}})}})};
const originalFetch=window.fetch;window.fetch=(url,options)=>{const u=new URL(typeof url==='string'?url:url.url,location.href);return u.origin===location.origin?originalFetch(url,options):Promise.resolve(new Response(JSON.stringify({detail:'External calls disabled in UI fixture'}),{status:503,headers:{'Content-Type':'application/json'}}));};
"""
@app.get("/index.html")
@app.get("/")
def page():
    html = (ROOT / "index.html").read_text(encoding="utf-8")
    html = re.sub(r'<script[^>]+src="(?:desktop-config|config|supabase-auth|cloud-sync)\.js[^>]*></script>', '', html)
    html = html.replace('<head>', '<head><script>' + STUB + '</script>', 1)
    return HTMLResponse(html)
@app.post("/api/crm/bootstrap")
def unused_bootstrap(): return {"complete": True}
@app.get("/api/public-config")
def public_config(): return {}
@app.get("/{path:path}")
def asset(path: str):
    target = (ROOT / path).resolve()
    if ROOT not in target.parents or not target.is_file() or target.suffix.lower() not in (".js", ".css", ".svg", ".png", ".woff2", ".jpg", ".webp", ".mp3") or any(part.startswith('.') or part in ('backend','tests','electron','node_modules','logs','_rebrand_backup','_claude_tmp') for part in Path(path).parts) or 'secrets' in target.name or 'credentials' in target.name:
        raise HTTPException(404)
    return FileResponse(target)

if __name__ == "__main__":
    try: uvicorn.run(app, host="127.0.0.1", port=3007, log_level="warning")
    finally: engine.dispose(); temporary.cleanup()
