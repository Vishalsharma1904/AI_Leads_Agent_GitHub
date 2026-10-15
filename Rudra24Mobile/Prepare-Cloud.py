"""Export the existing Python backend's PostgreSQL schema without connecting to a database."""
from pathlib import Path
import importlib
import os
import sys

mobile=Path(__file__).resolve().parent
root=mobile.parent
# Import models without touching the PC's database or starting any provider work.
os.environ.update(APP_ENV='development',USE_POSTGRES_DEV='false',AUTO_CREATE_SCHEMA='false',
                  CLAVIS_AUTO_INSTALL_BROWSER='false',CLAVIS_WARM_KOKORO='false')
sys.path.insert(0,str(root/'backend'))
from sqlalchemy.dialects import postgresql
from sqlalchemy.schema import CreateTable,CreateIndex

for name in ['auth_sync','billing','candidate_jobs','credentials','connectors','developer_insights',
             'lead_jobs','limits','sarvam','toughtongue','crm','crm_automation','textbee',
             'elevenlabs','whatsapp','mobile_jobs']:
    importlib.import_module('api.'+name)
from api.auth_sync import Base
assert Base.metadata.tables, 'Backend model registry is empty; no deployment SQL was written.'

dialect=postgresql.dialect()
schema='rudra_mobile_backend'
# A fresh private schema protects the existing public schema and every client
# already using it. Stop if this schema exists instead of changing its permissions.
sql=[f'''-- Isolated backend schema; no existing public tables are altered.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = '{schema}') THEN
    RAISE EXCEPTION 'Backend schema already exists; review incremental migrations separately';
  END IF;
END $$;
CREATE SCHEMA {schema};
SET search_path TO {schema};''']
for table in Base.metadata.sorted_tables:
    sql.append(str(CreateTable(table,if_not_exists=True).compile(dialect=dialect))+';')
    for index in sorted(table.indexes,key=lambda i:i.name):
        sql.append(str(CreateIndex(index,if_not_exists=True).compile(dialect=dialect))+';')
for path in sorted((root/'backend'/'migrations').glob('*.sql')):
    if path.name=='20260930_clavis_user_data_supabase.sql':
        continue # already applied separately with ownership policies in public
    sql.append('-- '+path.name+'\n'+path.read_text(encoding='utf-8').replace('public.',schema+'.').replace("'public'",f"'{schema}'"))
# Provider credentials, jobs, ledgers and CRM are backend-only. The account
# sync table has its own auth.uid ownership policies in the existing migration.
for table in Base.metadata.sorted_tables:
    name=dialect.identifier_preparer.quote(table.name)
    sql.append(f'ALTER TABLE {schema}.{name} ENABLE ROW LEVEL SECURITY;\nREVOKE ALL ON {schema}.{name} FROM anon, authenticated;')
sql.append(f'REVOKE ALL ON ALL SEQUENCES IN SCHEMA {schema} FROM anon, authenticated;')
assert 'public.' not in '\n'.join(sql), 'Export unexpectedly changes a public table'
directory=mobile/'deployment'
directory.mkdir(exist_ok=True)
target=directory/'backend-schema.sql'
target.write_text('\n\n'.join(sql)+'\n',encoding='utf-8')
print(f'Exported {len(Base.metadata.tables)} backend model tables plus existing migrations to {target}')
