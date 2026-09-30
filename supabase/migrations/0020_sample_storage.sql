-- Uploaded samples as files, and anonymous shares as rows.
--
-- A sample a person uploads used to ride inside the song as base64: in
-- songs.data, again in every song_versions row, again in a remix, again in a
-- share. Now a save uploads it once to the `samples` bucket, keyed by the
-- SHA-256 of its bytes, and the song carries `uploadRef: {hash, mime}`. The
-- same file saved from ten versions, three remixes and a share is one object.
--
-- Every write goes through the server (app/api/sample/route.ts) with the
-- secret key, which is why nothing below grants a client anything: the server
-- computes the hash itself, so no client can put other bytes under a hash
-- somebody else's song already names.

-- ---- what is stored ------------------------------------------------------

create table if not exists public.samples (
  hash        text primary key check (hash ~ '^[0-9a-f]{64}$'),
  mime        text not null,
  bytes       integer not null check (bytes > 0),
  created_at  timestamptz not null default now()
);
alter table public.samples enable row level security;
-- No policies: clients never read this table (the objects are public by URL)
-- and never write it.

-- ---- the daily upload quota ------------------------------------------------
--
-- One row per upload that was let through, counted over a rolling 24 hours:
-- per IP for a signed-out visitor, per account for a signed-in one (so a
-- school or an office sharing an address does not lock accounts out), and
-- across everyone as a circuit breaker. `ip_hash` is a salted hash; a raw
-- address is never stored. Rows older than two days are deleted by the
-- cleanup job (netlify/functions/sample-gc.mjs).

create table if not exists public.sample_uploads (
  id          bigint generated always as identity primary key,
  ip_hash     text,
  user_id     uuid,
  bytes       integer not null check (bytes > 0),
  created_at  timestamptz not null default now()
);
create index if not exists sample_uploads_ip_idx on public.sample_uploads (ip_hash, created_at);
create index if not exists sample_uploads_user_idx on public.sample_uploads (user_id, created_at);
create index if not exists sample_uploads_created_idx on public.sample_uploads (created_at);
alter table public.sample_uploads enable row level security;

-- Check and reserve in one step. The advisory lock serializes reservations,
-- so two uploads racing each other cannot both fit under a limit that only
-- has room for one; uploads are rare enough that one lock for all of them
-- costs nothing. The limits are arguments, not constants, so they live in the
-- server's env with the rest of its configuration.
--
-- `retry_after` is the seconds until the oldest row in the window that said
-- no leaves it: when at least some room opens again.
create or replace function public.reserve_sample_bytes(
  p_ip_hash      text,
  p_user_id      uuid,
  p_bytes        integer,
  p_ip_limit     bigint,
  p_user_limit   bigint,
  p_global_limit bigint
)
returns table (granted boolean, reservation_id bigint, retry_after integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  since  timestamptz := now() - interval '24 hours';
  used   bigint;
  oldest timestamptz;
  new_id bigint;
begin
  perform pg_advisory_xact_lock(hashtext('seqbaby.sample_uploads'));

  select coalesce(sum(u.bytes), 0), min(u.created_at) into used, oldest
    from public.sample_uploads u where u.created_at > since;
  if used + p_bytes > p_global_limit then
    return query select false, null::bigint,
      greatest(60, ceil(extract(epoch from (oldest + interval '24 hours' - now())))::integer);
    return;
  end if;

  if p_user_id is not null then
    select coalesce(sum(u.bytes), 0), min(u.created_at) into used, oldest
      from public.sample_uploads u where u.user_id = p_user_id and u.created_at > since;
    if used + p_bytes > p_user_limit then
      return query select false, null::bigint,
        greatest(60, ceil(extract(epoch from (oldest + interval '24 hours' - now())))::integer);
      return;
    end if;
  else
    select coalesce(sum(u.bytes), 0), min(u.created_at) into used, oldest
      from public.sample_uploads u where u.ip_hash = p_ip_hash and u.user_id is null and u.created_at > since;
    if used + p_bytes > p_ip_limit then
      return query select false, null::bigint,
        greatest(60, ceil(extract(epoch from (oldest + interval '24 hours' - now())))::integer);
      return;
    end if;
  end if;

  insert into public.sample_uploads (ip_hash, user_id, bytes)
    values (p_ip_hash, p_user_id, p_bytes)
    returning id into new_id;
  return query select true, new_id, 0;
end;
$$;

-- ---- anonymous shares -------------------------------------------------------
--
-- The studio's quick `share` button, moved off Netlify Blobs. Anyone may
-- create one (through /api/share, which writes with the secret key), anyone
-- with the id may read it (through the same route), and no client touches the
-- table directly. `title` and `owner_id` are the link preview's
-- (lib/api.js getShareMeta), read without pulling the session.

create table if not exists public.shares (
  id          text primary key check (id ~ '^[a-zA-Z0-9]{4,32}$'),
  session     jsonb not null,
  title       text,
  owner_id    uuid,
  created_at  timestamptz not null default now()
);
alter table public.shares enable row level security;

-- ---- the backfill ------------------------------------------------------------
--
-- scripts/migrate-samples.mjs rewrites every stored inline sample as a
-- reference. That must not look like an edit: songs.updated_at is what the
-- homepage ranks freshness by, and a trigger stamps it on every update. The
-- trigger now stands aside when the writer says so, which only this function
-- does (a transaction-local setting, so nothing else can leave it on).

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  if coalesce(current_setting('seqbaby.keep_updated_at', true), '') = 'on' then
    return new;
  end if;
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.sample_backfill_write(p_kind text, p_id text, p_data jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform set_config('seqbaby.keep_updated_at', 'on', true);
  if p_kind = 'song' then
    update public.songs set data = p_data where id = p_id::uuid;
  elsif p_kind = 'version' then
    update public.song_versions set data = p_data where id = p_id::uuid;
  elsif p_kind = 'patch' then
    update public.patches set config = p_data where id = p_id::uuid;
  elsif p_kind = 'share' then
    update public.shares set session = p_data where id = p_id;
  else
    raise exception 'unknown kind %', p_kind;
  end if;
  -- Off again straight away: transaction-local would still leave it on for
  -- anything else the same transaction went on to update.
  perform set_config('seqbaby.keep_updated_at', '', true);
end;
$$;

-- Server only. Functions are executable by PUBLIC by default, and a SECURITY
-- DEFINER one bypasses every policy above, so both are taken away from the
-- client roles and handed to the secret key's.
revoke all on function public.reserve_sample_bytes(text, uuid, integer, bigint, bigint, bigint) from public;
revoke all on function public.sample_backfill_write(text, text, jsonb) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.reserve_sample_bytes(text, uuid, integer, bigint, bigint, bigint) from anon, authenticated';
    execute 'revoke all on function public.sample_backfill_write(text, text, jsonb) from anon, authenticated';
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function public.reserve_sample_bytes(text, uuid, integer, bigint, bigint, bigint) to service_role';
    execute 'grant execute on function public.sample_backfill_write(text, text, jsonb) to service_role';
  end if;
end $$;

-- ---- which stored samples nothing names ---------------------------------------
--
-- For the cleanup job. A sample is referenced by a track's `uploadRef.hash`
-- in a song, a version, a patch or a share; anything older than the grace
-- period that none of them names is unreferenced. Read-only: the job decides
-- whether to delete.

create or replace function public.unreferenced_samples(p_older_than interval)
returns table (hash text)
language sql
stable
security definer
set search_path = public
as $$
  with refs as (
    select jsonb_path_query(s.data, '$.tracks[*].uploadRef.hash') #>> '{}' as h from public.songs s
    union
    select jsonb_path_query(v.data, '$.tracks[*].uploadRef.hash') #>> '{}' from public.song_versions v
    union
    select p.config -> 'uploadRef' ->> 'hash' from public.patches p
    union
    select jsonb_path_query(sh.session, '$.tracks[*].uploadRef.hash') #>> '{}' from public.shares sh
  )
  select x.hash from public.samples x
   where x.created_at < now() - p_older_than
     and not exists (select 1 from refs where refs.h = x.hash)
$$;
revoke all on function public.unreferenced_samples(interval) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.unreferenced_samples(interval) from anon, authenticated';
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function public.unreferenced_samples(interval) to service_role';
  end if;
end $$;

-- ---- the bucket ------------------------------------------------------------------
--
-- Public read, so a song plays from a plain URL with no token and the CDN can
-- cache it; the name is the content hash, so it cannot be guessed and never
-- changes. The size and type limits repeat the upload route's, so a write that
-- somehow skipped the route is still held to them.
--
-- Guarded: the RLS tests build the migrations on a bare Postgres with no
-- storage schema (scripts/test-rls.sh).
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'storage')
     and exists (select 1 from pg_tables where schemaname = 'storage' and tablename = 'buckets') then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('samples', 'samples', true, 5242880, array[
      'audio/wav', 'audio/mpeg', 'audio/ogg', 'audio/flac', 'audio/webm',
      'audio/mp4', 'audio/aac', 'audio/aiff'
    ])
    on conflict (id) do update
      set public = excluded.public,
          file_size_limit = excluded.file_size_limit,
          allowed_mime_types = excluded.allowed_mime_types;
  end if;
end $$;
