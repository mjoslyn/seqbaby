-- A song's uploaded samples, stored once per song.
--
-- A session carries each uploaded sample as base64 on its track, and a save
-- writes the whole session to songs.data AND to a new song_versions row -- so
-- a song with a 3MB sample saved thirty times was 90MB of one sample. The
-- save actions now lift each payload out into this table, keyed by its
-- sha-256, and leave "@sample:<hash>" where it was; the load paths put it
-- back (app/songs/sampleStore.js, app/songs/sampleDb.ts). The engine and the
-- session format know nothing about it.
--
-- Keyed by SONG rather than by owner so that a song's samples go when it does
-- (the cascade) and are readable exactly when it is. A remix gets copies.
--
-- Rows written before this keep their inline payloads and load as they did.
create table if not exists public.song_samples (
  song_id    uuid not null references public.songs (id) on delete cascade,
  hash       text not null check (hash ~ '^[0-9a-f]{64}$'),
  payload    text not null,
  created_at timestamptz not null default now(),
  primary key (song_id, hash)
);

alter table public.song_samples enable row level security;

-- Readable by whoever can read the song. The subquery runs under songs' own
-- policies, so this is "the owner, or anyone once it is public" without
-- saying either twice.
drop policy if exists "song_samples_read" on public.song_samples;
create policy "song_samples_read"
  on public.song_samples for select
  using (exists (select 1 from public.songs s where s.id = song_id));

-- Written only into a song of your own. No update or delete policy: a payload
-- is its hash, and rows leave with their song.
drop policy if exists "song_samples_insert_own" on public.song_samples;
create policy "song_samples_insert_own"
  on public.song_samples for insert
  with check (
    exists (
      select 1 from public.songs s
       where s.id = song_id and s.owner_id = (select auth.uid())
    )
  );

grant select on public.song_samples to anon, authenticated;
grant insert on public.song_samples to authenticated;
