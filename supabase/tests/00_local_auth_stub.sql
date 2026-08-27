-- LOCAL TEST SCAFFOLDING -- never applied to a real database.
--
-- Lives in supabase/tests/ rather than supabase/migrations/ precisely so the
-- Supabase CLI will not pick it up. On the hosted platform every object below
-- already exists and is managed by Supabase; this is the minimum needed to make
-- the migrations runnable against a bare Postgres, so the policies can be tested
-- without a project.
--
-- The one piece that has to be faithful is auth.uid(). Supabase defines it as
-- the `sub` claim of the request JWT, read from a per-transaction setting that
-- PostgREST populates. The tests set that setting directly, which is what lets
-- them impersonate a user without signing anything.

create schema if not exists auth;

create table if not exists auth.users (
  id                  uuid primary key default gen_random_uuid(),
  email               text,
  raw_user_meta_data  jsonb
);

-- Note the nullif BEFORE the cast. With no JWT at all -- which is exactly the
-- anon case the tests care about -- current_setting returns NULL or an empty
-- string, and ''::json raises rather than yielding NULL. Supabase's own
-- definition guards this the same way; casting first makes every anonymous
-- request an error instead of a NULL uid, which would make the anon tests fail
-- for a reason that has nothing to do with the policies.
create or replace function auth.uid() returns uuid
  language sql stable
as $$
  select nullif(
           nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub',
           ''
         )::uuid
$$;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
end $$;

grant usage on schema public, auth to anon, authenticated;
