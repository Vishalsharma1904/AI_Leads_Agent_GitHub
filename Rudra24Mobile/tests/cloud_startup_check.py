"""Production host/auth smoke check of the actual isolated deployment source; no lifespan or provider work."""
import os
import sys
from pathlib import Path

root = Path(__file__).resolve().parents[2]
deployment = root / 'work/mobile-cloud-deployment/backend'
os.environ.update(
    APP_ENV='production', AUTO_CREATE_SCHEMA='false',
    DATABASE_URL='postgresql://unused:unused@127.0.0.1/unused?connect_timeout=1',
    SUPABASE_URL='https://lyqnxutvfoytbtnthcrw.supabase.co',
    SUPABASE_PUBLISHABLE_KEY='sb_publishable_m5n1NZ2E6eikmgjWZ2eSAw_8c-_n2A8',
    CORS_ORIGINS='https://rudra24-ai.vercel.app',
    ALLOWED_HOSTS='localhost,127.0.0.1',
    RENDER_EXTERNAL_HOSTNAME='unit-rudra-api.onrender.com',
    RENDER_EXTERNAL_URL='https://unit-rudra-api.onrender.com',
    CLAVIS_AUTO_INSTALL_BROWSER='false', CLAVIS_WARM_KOKORO='false',
)
os.environ.pop('CONNECTOR_PUBLIC_BASE_URL', None)
sys.path.insert(0, str(deployment))
from fastapi.testclient import TestClient
from main import app
from api.connectors import _redirect_uri

client = TestClient(app, base_url=os.environ['RENDER_EXTERNAL_URL'])
assert client.get('/').status_code == 200
config = client.get('/api/public-config')
assert config.status_code == 200
assert config.json()['supabase_url'] == os.environ['SUPABASE_URL']
assert client.get('/', headers={'Host': 'untrusted.example'}).status_code == 400
assert client.get('/api/crm/records', headers={'Authorization': 'Bearer invalid'}).status_code == 401
assert _redirect_uri('google_workspace') == 'https://unit-rudra-api.onrender.com/api/v1/connectors/oauth/google_workspace/callback'
os.environ['CONNECTOR_PUBLIC_BASE_URL'] = 'https://explicit.example'
assert _redirect_uri('google_workspace').startswith('https://explicit.example/')
client.close()
print('Cloud source passed: trusted host, public auth configuration, invalid-token rejection, connector origin fallback.')
