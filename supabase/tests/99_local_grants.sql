-- LOCAL TEST SCAFFOLDING -- see 00_local_auth_stub.sql.
--
-- Runs after the migrations, because it grants on tables they create. Supabase
-- issues equivalent grants to anon and authenticated by default; without them a
-- bare Postgres would refuse every request before RLS ever got a say, and the
-- tests would pass for the wrong reason.
--
-- Table privileges are not row security. These are deliberately generous so
-- that what the tests actually measure is the POLICIES.

grant select, insert, update, delete
  on public.profiles, public.songs, public.patches
  to authenticated;

grant select on public.profiles, public.songs, public.patches to anon;

-- 0007 grants profile_cards itself; repeated here so the file is self-contained
-- if the view is ever recreated by hand.
grant select on public.profile_cards to anon, authenticated;
