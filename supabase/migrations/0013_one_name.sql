-- One name per person: the username. It was two fields -- a display name
-- (set at signup from the email) and a username (the /u/<handle> URL, set
-- only if the person went to settings and chose one) -- and most accounts
-- never did the second. Everything public is addressed by the handle, so an
-- account without one had no page and no place in the homepage's list of
-- people: it was invisible, which is the bug this fixes.
--
-- Now the username is the name. Every profile gets one (backfilled here from
-- the display name or the email, and made at signup the same way), and
-- `display_name` is kept equal to it, so anything that still reads that
-- column shows the same thing. The column itself stays -- dropping it would
-- break every reader deployed before this -- but nothing writes it on its own.

-- A handle from anything: lowercased, common accents folded, runs of anything
-- outside [a-z0-9_-] turned into one dash, trimmed, cut to leave room for a
-- `-NN` suffix, and at least two characters (USERNAME_RE in
-- app/profile/actions.ts).
create or replace function public.name_base(src text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  s text := translate(lower(coalesce(src, '')),
    'áàâäãåāçćčéèêëēęíìîïīłñńóòôöõøōśšúùûüūýÿžźż',
    'aaaaaaaccceeeeeeiiiiilnnooooooossuuuuuyyzzz');
begin
  s := regexp_replace(s, '[^a-z0-9_-]+', '-', 'g');
  s := left(regexp_replace(s, '^[-_]+|[-_]+$', '', 'g'), 24);
  s := regexp_replace(s, '[-_]+$', '', 'g');
  if length(s) < 2 then
    s := 'user' || s;
  end if;
  return s;
end;
$$;

-- Backfill, oldest first so the earliest account keeps the bare name.
do $$
declare
  r record;
  base text;
  cand text;
  n int;
begin
  for r in
    select p.id, coalesce(nullif(trim(p.display_name), ''), split_part(u.email, '@', 1)) as src
      from public.profiles p
      left join auth.users u on u.id = p.id
     where p.username is null
     order by p.created_at, p.id
  loop
    base := public.name_base(r.src);
    cand := base;
    n := 1;
    while exists (select 1 from public.profiles where username_lower = lower(cand)) loop
      n := n + 1;
      cand := base || '-' || n;
    end loop;
    update public.profiles set username = cand where id = r.id;
  end loop;
end $$;

update public.profiles
   set display_name = username
 where username is not null
   and display_name is distinct from username;

-- Signup makes the username too. A clash is a unique violation on
-- profiles_username_lower_key, caught and retried with the next suffix -- a
-- lookup-then-insert would race two signups for the same name, and a trigger
-- that throws fails the signup itself.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  base text := public.name_base(
    coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1)));
  cand text := base;
  n int := 1;
begin
  loop
    begin
      insert into public.profiles (id, username, display_name)
      values (new.id, cand, cand)
      on conflict (id) do nothing;
      return new;
    exception when unique_violation then
      n := n + 1;
      cand := case
        when n <= 50 then base || '-' || n
        else left(base, 21) || '-' || substr(md5(new.id::text || n::text), 1, 8)
      end;
    end;
  end loop;
end;
$$;
