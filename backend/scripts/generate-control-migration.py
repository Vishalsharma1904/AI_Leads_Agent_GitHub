"""Generate additive PostgreSQL DDL from the new control models, without touching DB."""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from api.control import Base
from sqlalchemy.schema import CreateTable, CreateIndex
from sqlalchemy.dialects import postgresql
from sqlalchemy import DefaultClause, text
names = {'account_controls','managed_sessions','provider_assignments','control_audit','control_usage','provider_budgets','control_releases'}
lines = ['-- Apply after backup using the backend database search_path. No user credentials/client grants.', 'BEGIN;']
for name in sorted(names):
    table = Base.metadata.tables[name]
    for column in table.columns:
        if column.default is not None and column.default.is_scalar:
            value = column.default.arg
            column.server_default = DefaultClause(value if isinstance(value,str) else text(str(value)))
    lines.append(str(CreateTable(table, if_not_exists=True).compile(dialect=postgresql.dialect())).strip() + ';')
    for index in table.indexes:
        lines.append(str(CreateIndex(index, if_not_exists=True).compile(dialect=postgresql.dialect())) + ';')
    lines.append('ALTER TABLE '+name+' ENABLE ROW LEVEL SECURITY;')
    lines.append('REVOKE ALL ON '+name+' FROM anon, authenticated;')
lines.extend(['COMMIT;', '-- Backend SQL role must own these tables or have explicit service-only grants.'])
Path(__file__).resolve().parents[1].joinpath('migrations/20261013_developer_control.sql').write_text('\n\n'.join(lines)+'\n', encoding='utf-8')
