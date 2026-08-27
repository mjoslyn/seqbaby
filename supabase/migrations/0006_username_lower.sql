-- Usernames are case-insensitive handles, and the URL handle is looked up by
-- exact match on the folded value. Two things were wrong before this migration:
--
--   1. 0004 tried to add the case-insensitive unique index under the name
--      `profiles_username_key` -- which is what Postgres had already named the
--      index backing `username text unique` in 0001. `if not exists` matched the
--      existing relation, emitted a NOTICE, and did nothing. So the constraint in
--      force was still the case-*sensitive* one: `Mike` and `mike` could both
--      register, and the profile page then broke for both (see 2).
--
--   2. `getPublicProfile` resolved handles with ILIKE. A btree on lower(username)
--      cannot answer ILIKE, so every profile page scanned the table -- and worse,
--      `_` and `%` are ILIKE wildcards while `_` is a legal username character.
--      With `a_c` and `abc` both registered, /u/a_c matched two rows and 404'd
--      permanently, and /u/a%25 matched every handle starting with "a".
--
-- A stored generated column fixes both: it is a plain column, so the lookup is a
-- literal equality with no pattern semantics, and a unique index on it is the
-- case-insensitive constraint 0004 meant to create.

-- Fail loudly and legibly if the data can't satisfy the constraint yet, rather
-- than with "could not create unique index ... key is duplicated".
do $$
declare dupes text;
begin
  select string_agg(distinct lower(username), ', ')
    into dupes
    from public.profiles
   where username is not null
     and lower(username) in (
       select lower(username) from public.profiles
        where username is not null
        group by lower(username) having count(*) > 1
     );
  if dupes is not null then
    raise exception
      'case-insensitive duplicate usernames must be resolved first: %', dupes;
  end if;
end $$;

alter table public.profiles
  add column if not exists username_lower text
  generated always as (lower(username)) stored;

-- Drop the case-sensitive rule from 0001. It is a constraint, so `drop index`
-- would refuse it; the bare `drop index` after covers the other world, where
-- 0001's constraint was named something else and 0004's index really was created.
alter table public.profiles drop constraint if exists profiles_username_key;
drop index if exists public.profiles_username_key;

create unique index if not exists profiles_username_lower_key
  on public.profiles (username_lower)
  where username_lower is not null;
