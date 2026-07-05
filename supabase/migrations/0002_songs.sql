-- Phase 2: cloud songs. A song's `data` is the exact serializeSet() JSON blob
-- the engine produces (bpm, scale, 32 patterns, tracks, fx, morphagene, ...).

create table if not exists public.songs (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references auth.users (id) on delete cascade,
  title       text not null default 'untitled',
  data        jsonb not null,
  is_public   boolean not null default false,
  share_slug  text unique,
  forked_from uuid references public.songs (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists songs_owner_idx on public.songs (owner_id, updated_at desc);
create index if not exists songs_slug_idx on public.songs (share_slug) where share_slug is not null;

alter table public.songs enable row level security;

-- Owners have full control of their songs.
drop policy if exists "songs_owner_all" on public.songs;
create policy "songs_owner_all"
  on public.songs for all
  using (auth.uid() = owner_id)
  with check (auth.uid() = owner_id);

-- Anyone (including anon) can read songs that are published.
drop policy if exists "songs_public_read" on public.songs;
create policy "songs_public_read"
  on public.songs for select
  using (is_public = true);

drop trigger if exists songs_touch_updated_at on public.songs;
create trigger songs_touch_updated_at
  before update on public.songs
  for each row execute function public.touch_updated_at();
