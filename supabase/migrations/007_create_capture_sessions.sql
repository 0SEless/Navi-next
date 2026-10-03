-- NAVI Capture Phase 3: isolated offline-first Capture session sync.
-- This table stores one complete CaptureSession JSON payload per session.
-- It is intentionally isolated from the existing application data model.

create table if not exists public.capture_sessions (
  session_id text primary key,
  owner_id uuid not null default auth.uid()
    references auth.users(id) on delete cascade,
  campus_id text,
  title text not null check (char_length(title) between 1 and 200),
  status text not null check (status in ('recording', 'paused', 'finished')),
  schema_version integer not null check (schema_version > 0),
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  content_hash text not null,
  client_updated_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists capture_sessions_owner_updated_idx
  on public.capture_sessions (owner_id, updated_at desc);

create index if not exists capture_sessions_owner_campus_updated_idx
  on public.capture_sessions (owner_id, campus_id, updated_at desc);

alter table public.capture_sessions enable row level security;

revoke all on public.capture_sessions from anon;
revoke all on public.capture_sessions from public;
revoke all on public.capture_sessions from authenticated;
grant select, insert, update on public.capture_sessions to authenticated;

create policy capture_sessions_select_owner
  on public.capture_sessions for select to authenticated
  using ((select auth.uid()) = owner_id);

create policy capture_sessions_insert_owner
  on public.capture_sessions for insert to authenticated
  with check ((select auth.uid()) = owner_id);

create policy capture_sessions_update_owner
  on public.capture_sessions for update to authenticated
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);
