-- `is_public` was enforced in TypeScript, not in the database. The policy from
-- 0001 was `using (true)`, and getPublicProfile selected the whole row -- bio
-- included -- then decided in app code whether to show it. That server action is
-- honest, but it was never the only way in: PostgREST is exposed and the anon
-- key ships to the browser, so GET /rest/v1/profiles?select=* returned every
-- private profile's bio without going near application code.
--
-- The reason it ended up this way was legitimate: public songs and patches need
-- author attribution from anonymous sessions, and a readable profiles table
-- solved that. So this splits the two jobs apart.

-- 1. The table itself becomes private-by-default. `(select auth.uid())` rather
--    than a bare call so the planner hoists it into an InitPlan and evaluates it
--    once per query instead of once per row scanned.
drop policy if exists "profiles_select_all" on public.profiles;

create policy "profiles_select_visible"
  on public.profiles for select
  using (is_public or (select auth.uid()) = id);

-- 2. Attribution gets its own surface, carrying display fields and never bio.
--
--    This view deliberately runs with the definer's rights (security_invoker
--    off, which is the default -- stated here because the whole design depends
--    on it), so it sees past the policy above. That is the point: a private
--    profile page still needs a handle to render, and a public patch by someone
--    whose page is private should still be attributed to them.
--
--    Supabase's linter flags definer views in exposed schemas. This one is
--    intentional and carries no field that is not already on screen wherever it
--    is used. Do NOT add bio, email, or created_at to it.
create or replace view public.profile_cards as
  select id, username, username_lower, display_name, avatar_url
    from public.profiles;

alter view public.profile_cards set (security_invoker = false);

grant select on public.profile_cards to anon, authenticated;

-- Note there is no is_public column here on purpose. getPublicProfile tells a
-- private profile from a missing one by whether the card exists at all when the
-- table read came back empty, so publishing the flag in bulk buys nothing.
