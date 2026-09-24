-- Likes: a heart on a published song, and the homepage ranked by them.
--
-- One row per (song, person). A table of its own rather than a counter column
-- on `songs`, for two reasons. A counter is a read-modify-write that two
-- people liking at once can race; a row is an insert that cannot. And every
-- write to `songs` fires songs_touch_updated_at, so a like would bump the
-- song's updated_at -- which the homepage reads as how FRESH it is. A liked
-- song would look newly made.

create table if not exists public.song_likes (
  song_id    uuid not null references public.songs (id) on delete cascade,
  user_id    uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (song_id, user_id)
);

-- The primary key serves the count (song_id first). This one serves "which of
-- these songs have I liked", the question every card asks on load.
create index if not exists song_likes_user_idx on public.song_likes (user_id, song_id);

alter table public.song_likes enable row level security;

-- WHO liked a song is not published, only how many did: a like is yours to
-- see and nobody else's. The counts come from like_count() below.
drop policy if exists "song_likes_read_own" on public.song_likes;
create policy "song_likes_read_own"
  on public.song_likes for select
  using ((select auth.uid()) = user_id);

-- Only a song you can hear publicly can be liked. The subquery runs under the
-- songs policies, and it names is_public outright rather than leaning on them:
-- an owner can read their own private songs, and a like hanging off a private
-- one would count the moment it was published.
drop policy if exists "song_likes_insert_own" on public.song_likes;
create policy "song_likes_insert_own"
  on public.song_likes for insert
  with check (
    (select auth.uid()) = user_id
    and exists (select 1 from public.songs s where s.id = song_id and s.is_public)
  );

drop policy if exists "song_likes_delete_own" on public.song_likes;
create policy "song_likes_delete_own"
  on public.song_likes for delete
  using ((select auth.uid()) = user_id);

-- A computed field, like `preview` (0012): `.select("id,likes")` on songs.
-- SECURITY DEFINER because the read policy above hides everyone else's rows,
-- and a count run as the caller would only ever count their own like.
--
-- It counts only for a song the caller could read anyway -- checked against
-- the table, not the row it was handed, since PostgREST will call a function
-- taking a row type over /rpc with whatever row the caller writes, is_public
-- included.
create or replace function public.likes(s public.songs)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::int
    from public.song_likes l
   where l.song_id = s.id
     and exists (
       select 1 from public.songs x
        where x.id = s.id
          and (x.is_public or x.owner_id = (select auth.uid()))
     )
$$;

revoke all on function public.likes(public.songs) from public;
grant execute on function public.likes(public.songs) to anon, authenticated;

grant select, insert, delete on public.song_likes to authenticated;
