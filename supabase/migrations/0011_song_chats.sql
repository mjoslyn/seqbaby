-- Phase 5: the compose conversation belongs to the song.
--
-- The chat panel writes songs by calling the song-editing tools, so the
-- transcript is the record of how a song came to sound the way it does --
-- "make the bass dirtier", "no, less". Kept only in the browser it died with
-- the tab, and coming back to a song a week later meant re-explaining it to an
-- assistant that had never seen it. Now it is attached to the song and comes
-- back when the song is opened.
--
-- One row per SONG, not per version: the conversation is about the song, and a
-- branch in the version tree is still the same conversation. That is also why
-- it is a table of its own rather than a column on `songs` -- `songs` is read
-- by the share route, the public profile and every anonymous `?s=` visit, and
-- a column there would ride along with all of them.

create table if not exists public.song_chats (
  -- One chat per song, so the song's id IS the key: saving a turn is an upsert
  -- rather than a read-modify-insert that two tabs could race.
  song_id    uuid primary key references public.songs (id) on delete cascade,
  -- Denormalized from songs.owner_id so the policy below is a column compare
  -- rather than a join on every row scanned -- same reasoning as
  -- song_versions.owner_id.
  owner_id   uuid not null references auth.users (id) on delete cascade,
  -- The transcript as the panel holds it: [{ role, text, activity?, warnings? }].
  -- Deliberately the READABLE turns only, not the tool-call bookkeeping -- that
  -- is scratch work for one turn, it is large, and nothing replays it.
  messages   jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.song_chats enable row level security;

-- Owner-only, both ways, and deliberately NO public-read policy -- the same
-- stance song_versions takes, for a stronger reason. Publishing a song
-- publishes the song; what you said to get there is not part of it, and a
-- conversation is the one thing here likely to contain something its author
-- would not choose to publish.
--
-- The WITH CHECK also verifies the song is the writer's: the owner_id check
-- alone would let anyone hang a chat off someone else's song.
drop policy if exists "song_chats_owner_all" on public.song_chats;
create policy "song_chats_owner_all"
  on public.song_chats for all
  using ((select auth.uid()) = owner_id)
  with check (
    (select auth.uid()) = owner_id
    and exists (
      select 1 from public.songs s
       where s.id = song_id and s.owner_id = (select auth.uid())
    )
  );
