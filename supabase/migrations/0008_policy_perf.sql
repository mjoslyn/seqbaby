-- Two performance corrections. Neither changes who can see or do what.
--
-- 1. Bare `auth.uid()` in a policy is evaluated once per row scanned. Wrapped in
--    a subselect it has no dependency on the row, so the planner hoists it into
--    an InitPlan and evaluates it once per query. The function is not free --
--    Supabase's reads current_setting('request.jwt.claims'), parses it as JSON,
--    extracts `sub` and casts to uuid -- so on a table scan that is real work
--    repeated for nothing. 0005 and 0007 already do this; the four policies
--    below predate the habit.
--
--    profiles_update_own has a USING clause and no WITH CHECK, which is not an
--    oversight: Postgres reuses the USING expression as the check when none is
--    given. Kept exactly as it was so this migration stays a pure rewrite.

drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own"
  on public.profiles for insert
  with check ((select auth.uid()) = id);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own"
  on public.profiles for update
  using ((select auth.uid()) = id);

drop policy if exists "songs_owner_all" on public.songs;
create policy "songs_owner_all"
  on public.songs for all
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);

drop policy if exists "patches_owner_all" on public.patches;
create policy "patches_owner_all"
  on public.patches for all
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);

-- 2. patches_owner_idx sorted by a column nothing orders by. It was copied from
--    songs_owner_idx, where updated_at genuinely is the sort column, but both
--    queries that filter patches on owner_id -- listMyPatches and the patches
--    half of getPublicProfile -- order by created_at desc. The equality half of
--    the index was being used and the sort half was dead, so Postgres sorted
--    anyway.

drop index if exists public.patches_owner_idx;
create index if not exists patches_owner_idx
  on public.patches (owner_id, created_at desc);
