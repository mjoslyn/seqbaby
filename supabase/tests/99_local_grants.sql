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
  on public.profiles, public.songs, public.patches, public.song_versions
  to authenticated;

-- song_versions is granted to anon on purpose, even though no policy lets anon
-- read a row: a missing grant would make the "anon cannot see history" tests
-- pass without the policy doing any of the work.
grant select on public.profiles, public.songs, public.patches, public.song_versions
  to anon;

-- 0007 grants profile_cards itself; repeated here so the file is self-contained
-- if the view is ever recreated by hand.
grant select on public.profile_cards to anon, authenticated;
