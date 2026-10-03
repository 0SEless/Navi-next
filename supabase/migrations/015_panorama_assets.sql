-- NAVI 360 Panorama Ingestion: R2 object registry (asset metadata tracking).
--
-- Additive only — no existing table, column, or policy is modified.
-- One row per panorama image received through the ingestion API:
--   status 'signed'   = presigned PUT issued, upload not yet confirmed
--   status 'uploaded' = HeadObject-verified (existence, size, content type)
-- Only rows with status 'uploaded' are resolvable to presigned GET URLs.
--
-- The R2 object key is the primary key, so re-ingesting the same panorama
-- upserts its own row and can never collide with another object.
--
-- Access model: server-side only. Reads and writes go through the existing
-- service-role path (which bypasses RLS, per migration 003), so no
-- client-facing policies are granted — anon and authenticated get nothing.

create table if not exists public.panorama_assets (
  key text primary key
    check (key ~ '^panoramas/[a-z0-9][a-z0-9_-]{0,63}/[a-z0-9][a-z0-9_-]{0,63}\.(jpg|png|webp)$'),
  campus_id text not null
    check (campus_id ~ '^[a-z0-9][a-z0-9_-]{0,63}$'),
  panorama_id text not null
    check (panorama_id ~ '^[a-z0-9][a-z0-9_-]{0,63}$'),
  content_type text not null
    check (content_type in ('image/jpeg', 'image/png', 'image/webp')),
  byte_size bigint not null check (byte_size > 0),
  status text not null default 'signed'
    check (status in ('signed', 'uploaded')),
  uploaded_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Lookup path for "list/verify a campus's panoramas".
create index if not exists panorama_assets_campus_idx
  on public.panorama_assets (campus_id);

-- Server-side only: no client-facing access at all.
alter table public.panorama_assets enable row level security;

revoke all on public.panorama_assets from anon;
revoke all on public.panorama_assets from public;
revoke all on public.panorama_assets from authenticated;
