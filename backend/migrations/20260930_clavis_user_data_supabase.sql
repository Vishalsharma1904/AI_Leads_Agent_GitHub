-- Run once in the SQL editor of the Supabase project configured in backend/.env.
-- Browser clients use only the publishable key. The row owner is the verified
-- Supabase Auth user ID, never an email or a client supplied profile field.
create table if not exists public.clavis_user_data (
  user_id uuid primary key references auth.users(id) on delete cascade,
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  constraint clavis_user_data_payload_limit check (octet_length(payload::text) <= 8000000)
);

alter table public.clavis_user_data enable row level security;
revoke all on public.clavis_user_data from anon, authenticated;
grant select, insert, update, delete on public.clavis_user_data to authenticated;

drop policy if exists "clavis_select_own_data" on public.clavis_user_data;
create policy "clavis_select_own_data" on public.clavis_user_data
  for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "clavis_insert_own_data" on public.clavis_user_data;
create policy "clavis_insert_own_data" on public.clavis_user_data
  for insert to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "clavis_update_own_data" on public.clavis_user_data;
create policy "clavis_update_own_data" on public.clavis_user_data
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "clavis_delete_own_data" on public.clavis_user_data;
create policy "clavis_delete_own_data" on public.clavis_user_data
  for delete to authenticated
  using ((select auth.uid()) = user_id);
