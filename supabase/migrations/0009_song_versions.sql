-- Phase 3: a song is a TREE of versions, not a single blob.
--
-- Saving an existing song used to overwrite `songs.data` in place, so the
-- previous state of the song was gone. Every save now also appends a row here,
-- pointing at the version it was saved from, which makes the history a tree
-- rather than a list: load an older version, save, and the new version hangs off
-- THAT one instead of the tip. Two children of one parent are two branches.
--
-- `songs.data` is deliberately left alone as the song's current state. Share
-- links, the public profile and loadSong() all read it and none of them care
-- about history, so nothing downstream had to learn about versions. It always
-- mirrors the version named by `songs.current_version_id`.

create table if not exists public.song_versions (
  id         uuid primary key default gen_random_uuid(),
  song_id    uuid not null references public.songs (id) on delete cascade,
  -- Denormalized from songs.owner_id so the policy below is a column compare
  -- rather than a join on every row scanned.
  owner_id   uuid not null references auth.users (id) on delete cascade,
  -- The version this one was saved from. Null for a root (the first save of a
  -- song, or the copy a fork starts from). Cascading is the coherent choice for
  -- a tree: a version whose parent is gone has no history to sit in.
  parent_id  uuid references public.song_versions (id) on delete cascade,
  data       jsonb not null,
  -- sha256 of the serialized blob, as the writer's JSON.stringify sees it. Lets
  -- a save that changed nothing be recognized as a no-op instead of growing the
  -- tree by a duplicate. Backfilled rows below keep the empty default: Postgres
  -- renders jsonb its own way, so a hash computed here would not match one
  -- computed there, and a hash that matches nothing merely costs one extra
  -- version on a song's first save after this migration.
  data_hash  text not null default '',
  -- Per-song counter, so a version has a stable human name ("v4") that does not
  -- move when a sibling branch is added. Unique per song; the writer retries on
  -- collision the same way publishSong retries a slug.
  seq        integer not null,
  label      text,
  created_at timestamptz not null default now(),
  unique (song_id, seq)
);

create index if not exists song_versions_song_idx
  on public.song_versions (song_id, created_at);
create index if not exists song_versions_parent_idx
  on public.song_versions (parent_id);

-- The tip the song's `data` currently mirrors, and the default parent of the
-- next save. Set null rather than cascade: losing the pointer must not lose the
-- song.
alter table public.songs
  add column if not exists current_version_id uuid
    references public.song_versions (id) on delete set null;

alter table public.song_versions enable row level security;

-- Owner-only, both ways. Deliberately NO public-read policy to match
-- songs_public_read: publishing a song publishes the state you chose to
-- publish, not every draft that led to it. A public song's history stays the
-- owner's.
--
-- The WITH CHECK also verifies the song itself is the writer's. Without it the
-- owner_id check alone would let anyone hang their own rows off someone else's
-- song -- invisible to that owner, but still rows on their tree.
drop policy if exists "song_versions_owner_all" on public.song_versions;
create policy "song_versions_owner_all"
  on public.song_versions for all
  using ((select auth.uid()) = owner_id)
  with check (
    (select auth.uid()) = owner_id
    and exists (
      select 1 from public.songs s
       where s.id = song_id and s.owner_id = (select auth.uid())
    )
  );

-- Backfill: every existing song becomes a one-version tree whose root is its
-- current state, so the first save after this migration branches off something
-- rather than starting a second root.
insert into public.song_versions (song_id, owner_id, parent_id, data, seq, label, created_at)
select s.id, s.owner_id, null, s.data, 1, 'first save', s.created_at
  from public.songs s
 where not exists (select 1 from public.song_versions v where v.song_id = s.id);

update public.songs s
   set current_version_id = v.id
  from public.song_versions v
 where v.song_id = s.id and s.current_version_id is null;
