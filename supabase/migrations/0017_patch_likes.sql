-- Likes on patches: the heart the song cards got in 0016, on the patch
-- gallery, and the homepage's patches ranked by them and by freshness.
--
-- The same shape as song_likes and for the same reasons: a row per (patch,
-- person) rather than a counter, because a counter is a race, and because
-- patches_touch_updated_at would read a like as the patch being edited.

create table if not exists public.patch_likes (
  patch_id   uuid not null references public.patches (id) on delete cascade,
  user_id    uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (patch_id, user_id)
);

create index if not exists patch_likes_user_idx on public.patch_likes (user_id, patch_id);

alter table public.patch_likes enable row level security;

-- Who liked a patch is theirs to see and nobody else's; the count is likes().
drop policy if exists "patch_likes_read_own" on public.patch_likes;
create policy "patch_likes_read_own"
  on public.patch_likes for select
  using ((select auth.uid()) = user_id);

-- Only a public patch can be liked, named outright for song_likes' reason: an
-- owner can read their own private patches.
drop policy if exists "patch_likes_insert_own" on public.patch_likes;
create policy "patch_likes_insert_own"
  on public.patch_likes for insert
  with check (
    (select auth.uid()) = user_id
    and exists (select 1 from public.patches p where p.id = patch_id and p.is_public)
  );

drop policy if exists "patch_likes_delete_own" on public.patch_likes;
create policy "patch_likes_delete_own"
  on public.patch_likes for delete
  using ((select auth.uid()) = user_id);

-- The computed field: `.select("id,likes")` on patches. An overload of 0016's
-- likes(songs) -- PostgREST picks a computed field by the row type it takes.
-- SECURITY DEFINER and checked against the table, not the row it was handed,
-- exactly as that one is.
create or replace function public.likes(p public.patches)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::int
    from public.patch_likes l
   where l.patch_id = p.id
     and exists (
       select 1 from public.patches x
        where x.id = p.id
          and (x.is_public or x.owner_id = (select auth.uid()))
     )
$$;

revoke all on function public.likes(public.patches) from public;
grant execute on function public.likes(public.patches) to anon, authenticated;

grant select, insert, delete on public.patch_likes to authenticated;
