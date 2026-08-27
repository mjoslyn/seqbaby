-- Negative RLS tests: proof that another user's rows are invisible.
--
-- Run with `npm run test:rls`, which builds a throwaway Postgres, applies the
-- migrations and runs this. Do not run it by hand against anything you care
-- about -- it creates and deletes rows, and the guard below is the only thing
-- standing between it and whatever database you happen to be pointed at.
--
-- Why these exist: policies are easy to write and easy to fool yourself about,
-- because you test them as a privileged role, where RLS does not apply at all.
-- Every assertion here runs as `anon` or `authenticated`, never as the owner.
--
-- Each test is its own transaction ending in ROLLBACK, so a test that writes
-- cannot influence the next one, and SET LOCAL ROLE unwinds on its own.

\set ON_ERROR_STOP on

do $$
begin
  if coalesce(current_setting('seqbaby.test_db', true), '') <> 'yes' then
    raise exception
      'refusing to run: this script creates and deletes rows. Use scripts/test-rls.sh, which points it at a throwaway database.';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Fixture. Alice's page is public, Bob's is private. Both publish one patch,
-- so attribution can be checked for someone whose own page is hidden.
-- ---------------------------------------------------------------------------

insert into auth.users (id, email) values
  ('a11ce000-0000-4000-8000-000000000001', 'alice@example.test'),
  ('b0b00000-0000-4000-8000-000000000002', 'bob@example.test');

update public.profiles set username = 'alice', display_name = 'Alice',
       bio = 'ALICE-BIO', is_public = true
 where id = 'a11ce000-0000-4000-8000-000000000001';

update public.profiles set username = 'bob', display_name = 'Bob',
       bio = 'BOB-PRIVATE-BIO', is_public = false
 where id = 'b0b00000-0000-4000-8000-000000000002';

insert into public.songs (id, owner_id, title, data, is_public) values
  ('a0000000-0000-4000-8000-00000000000a', 'a11ce000-0000-4000-8000-000000000001', 'alice public', '{}', true),
  ('a0000000-0000-4000-8000-00000000000b', 'a11ce000-0000-4000-8000-000000000001', 'alice private', '{}', false);

insert into public.patches (id, owner_id, name, config, is_public) values
  ('c0000000-0000-4000-8000-00000000000a', 'a11ce000-0000-4000-8000-000000000001', 'alice public patch', '{}', true),
  ('c0000000-0000-4000-8000-00000000000b', 'a11ce000-0000-4000-8000-000000000001', 'alice private patch', '{}', false),
  ('c0000000-0000-4000-8000-00000000000c', 'b0b00000-0000-4000-8000-000000000002', 'bob public patch', '{}', true);

\echo ''
\echo '== songs: what Bob can see and do to Alice =='

begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"b0b00000-0000-4000-8000-000000000002","role":"authenticated"}';
do $$
declare n bigint;
begin
  select count(*) into n from public.songs
   where owner_id = 'a11ce000-0000-4000-8000-000000000001';
  if n <> 1 then
    raise exception 'FAIL  bob sees % of alice''s songs, expected exactly the 1 public one', n;
  end if;
  raise notice 'PASS  bob sees only alice''s public song';

  select count(*) into n from public.songs
   where id = 'a0000000-0000-4000-8000-00000000000b';   -- alice's private one, by id
  if n <> 0 then raise exception 'FAIL  bob read alice''s private song by id'; end if;
  raise notice 'PASS  bob cannot read alice''s private song even by id';
end $$;
rollback;

begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"b0b00000-0000-4000-8000-000000000002","role":"authenticated"}';
do $$
declare n bigint;
begin
  with u as (
    update public.songs set title = 'hijacked'
     where id = 'a0000000-0000-4000-8000-00000000000b' returning 1)
  select count(*) into n from u;
  if n <> 0 then raise exception 'FAIL  bob updated % of alice''s rows', n; end if;
  raise notice 'PASS  bob cannot update alice''s private song';

  -- The public one is readable, which is exactly why writes need their own
  -- check: visible must not imply writable.
  with u as (
    update public.songs set title = 'hijacked'
     where id = 'a0000000-0000-4000-8000-00000000000a' returning 1)
  select count(*) into n from u;
  if n <> 0 then raise exception 'FAIL  bob updated alice''s PUBLIC song -- readable is not writable'; end if;
  raise notice 'PASS  bob cannot update alice''s public song either';

  with d as (
    delete from public.songs
     where owner_id = 'a11ce000-0000-4000-8000-000000000001' returning 1)
  select count(*) into n from d;
  if n <> 0 then raise exception 'FAIL  bob deleted % of alice''s songs', n; end if;
  raise notice 'PASS  bob cannot delete alice''s songs';
end $$;
rollback;

begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"b0b00000-0000-4000-8000-000000000002","role":"authenticated"}';
do $$
begin
  begin
    insert into public.songs (owner_id, title, data)
      values ('a11ce000-0000-4000-8000-000000000001', 'forged', '{}');
    raise exception 'FAIL  bob inserted a song owned by alice';
  exception when insufficient_privilege then
    raise notice 'PASS  bob cannot insert a song owned by alice (WITH CHECK)';
  end;
end $$;
rollback;

begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"b0b00000-0000-4000-8000-000000000002","role":"authenticated"}';
do $$
declare n bigint;
begin
  insert into public.songs (owner_id, title, data)
    values ('b0b00000-0000-4000-8000-000000000002', 'bob''s own', '{}');
  select count(*) into n from public.songs
   where owner_id = 'b0b00000-0000-4000-8000-000000000002';
  if n <> 1 then raise exception 'FAIL  bob cannot see his own song (n=%)', n; end if;
  raise notice 'PASS  bob can still write and read his own songs';
end $$;
rollback;

\echo ''
\echo '== patches =='

begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"b0b00000-0000-4000-8000-000000000002","role":"authenticated"}';
do $$
declare n bigint;
begin
  select count(*) into n from public.patches
   where id = 'c0000000-0000-4000-8000-00000000000b';
  if n <> 0 then raise exception 'FAIL  bob read alice''s private patch'; end if;
  raise notice 'PASS  bob cannot read alice''s private patch';

  with d as (
    delete from public.patches
     where id = 'c0000000-0000-4000-8000-00000000000a' returning 1)
  select count(*) into n from d;
  if n <> 0 then raise exception 'FAIL  bob deleted alice''s patch'; end if;
  raise notice 'PASS  bob cannot delete alice''s public patch';
end $$;
rollback;

\echo ''
\echo '== profiles: the anon-key leak 0007 closed =='

begin;
set local role anon;
do $$
declare n bigint; leaked text;
begin
  -- This is the exact shape of GET /rest/v1/profiles?select=* with the anon key.
  select count(*) into n from public.profiles;
  if n <> 1 then raise exception 'FAIL  anon sees % profiles, expected only the public one', n; end if;
  raise notice 'PASS  anon sees only public profiles';

  select string_agg(bio, ',') into leaked from public.profiles where bio like '%PRIVATE%';
  if leaked is not null then raise exception 'FAIL  anon read a private bio: %', leaked; end if;
  raise notice 'PASS  no private bio reachable by anon';

  -- Targeted attempts, in case a filter changes what the policy allows.
  select count(*) into n from public.profiles where username = 'bob';
  if n <> 0 then raise exception 'FAIL  anon reached bob by username'; end if;
  select count(*) into n from public.profiles where is_public = false;
  if n <> 0 then raise exception 'FAIL  anon reached private profiles by filtering on is_public'; end if;
  select count(*) into n from public.profiles where id = 'b0b00000-0000-4000-8000-000000000002';
  if n <> 0 then raise exception 'FAIL  anon reached bob by id'; end if;
  raise notice 'PASS  anon cannot reach a private profile by username, id, or is_public filter';
end $$;
rollback;

begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"b0b00000-0000-4000-8000-000000000002","role":"authenticated"}';
do $$
declare n bigint; b text;
begin
  select count(*), max(bio) into n, b from public.profiles
   where id = 'b0b00000-0000-4000-8000-000000000002';
  if n <> 1 or b <> 'BOB-PRIVATE-BIO' then
    raise exception 'FAIL  bob cannot read his own private profile (n=%, bio=%)', n, b;
  end if;
  raise notice 'PASS  bob can read his own private profile';

  with u as (
    update public.profiles set bio = 'defaced'
     where id = 'a11ce000-0000-4000-8000-000000000001' returning 1)
  select count(*) into n from u;
  if n <> 0 then raise exception 'FAIL  bob updated alice''s profile'; end if;
  raise notice 'PASS  bob cannot update alice''s profile';
end $$;
rollback;

\echo ''
\echo '== profile_cards: attribution without exposure =='

begin;
set local role anon;
do $$
declare n bigint;
begin
  -- The view deliberately sees past the policy, so a private profile still has
  -- a handle to render and a byline on its public patches.
  select count(*) into n from public.profile_cards;
  if n <> 2 then raise exception 'FAIL  profile_cards shows % profiles, expected both', n; end if;
  raise notice 'PASS  anon can read cards for both profiles (attribution works)';

  select count(*) into n from public.profile_cards where username = 'bob';
  if n <> 1 then raise exception 'FAIL  bob has no card, so his public patch would say "anon"'; end if;
  raise notice 'PASS  a private-profile author still has a card';
end $$;
rollback;

-- Structural, not behavioural: the migration says "Do NOT add bio to this view".
-- This is that comment with teeth. A column added here would leak to anon
-- without any policy appearing to change.
do $$
declare cols text;
begin
  select string_agg(column_name, ', ' order by column_name) into cols
    from information_schema.columns
   where table_schema = 'public' and table_name = 'profile_cards';
  if cols is distinct from 'avatar_url, display_name, id, username, username_lower' then
    raise exception 'FAIL  profile_cards columns changed: %  (adding one exposes it to anon)', cols;
  end if;
  raise notice 'PASS  profile_cards exposes only display fields, no bio';
end $$;

\echo ''
\echo '== migration properties that are easy to revert by accident =='

-- Guards the 0008 rewrite. A bare auth.uid() is correct but is re-evaluated for
-- every row scanned; the subselect form lets the planner hoist it into an
-- InitPlan. Easy to undo by accident when editing a policy.
-- USING and WITH CHECK are examined separately on purpose. Concatenating them
-- and looking for one hoisted call lets a hoisted USING vouch for a bare
-- WITH CHECK, which is the exact mistake that made an earlier version of this
-- test pass while a policy was half-reverted. The hoisted form renders as
-- "( SELECT auth.uid() AS uid)", so strip those and see what auth.uid() is left.
do $$
declare bad text;
begin
  with stripped as (
    select policyname, tablename,
           regexp_replace(coalesce(qual, ''),       '\( SELECT auth\.uid\(\)[^)]*\)', '', 'g') as q,
           regexp_replace(coalesce(with_check, ''), '\( SELECT auth\.uid\(\)[^)]*\)', '', 'g') as w
      from pg_policies
     where schemaname = 'public')
  select string_agg(format('%s on %s (%s)', policyname, tablename,
           case when q like '%auth.uid()%' and w like '%auth.uid()%' then 'USING and WITH CHECK'
                when q like '%auth.uid()%' then 'USING'
                else 'WITH CHECK' end), ', ')
    into bad
    from stripped
   where q like '%auth.uid()%' or w like '%auth.uid()%';
  if bad is not null then
    raise exception 'FAIL  these policies call auth.uid() per row: %', bad;
  end if;
  raise notice 'PASS  every policy referencing auth.uid() uses the hoisted form';
end $$;

-- 0008 rebuilt patches_owner_idx on the column the queries actually order by.
-- The property that matters is "no Sort node in the plan for listMyPatches",
-- measured once at 50k rows; asserting the plan here would mean seeding enough
-- rows for the planner to prefer the index, so this checks the index definition
-- instead. It catches the revert, which is the realistic failure.
do $$
declare d text;
begin
  select indexdef into d from pg_indexes
   where schemaname = 'public' and indexname = 'patches_owner_idx';
  if d is null then
    raise exception 'FAIL  patches_owner_idx is missing';
  end if;
  if d not like '%created_at%' then
    raise exception 'FAIL  patches_owner_idx does not sort by created_at, so listMyPatches sorts by hand: %', d;
  end if;
  raise notice 'PASS  patches_owner_idx sorts by the column the queries order by';
end $$;

-- ---------------------------------------------------------------------------
-- Teardown. Cascades to profiles, songs and patches.
-- ---------------------------------------------------------------------------
delete from auth.users
 where id in ('a11ce000-0000-4000-8000-000000000001',
              'b0b00000-0000-4000-8000-000000000002');

\echo ''
\echo 'all RLS tests passed'
