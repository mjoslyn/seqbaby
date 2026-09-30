-- profile_cards stops being a SECURITY DEFINER view.
--
-- 0007 made it one on purpose: attribution has to see past the profiles
-- policy, so a private profile still has a handle and a public patch by its
-- owner still has a byline. Supabase's linter flags every definer view in an
-- exposed schema regardless (security_definer_view), and a lint that is always
-- red is one nobody reads.
--
-- The rights move, they do not go away: the view is an invoker view now, over a
-- definer FUNCTION in `private`, a schema PostgREST does not expose, so it is
-- not callable over /rpc and not in the linter's scope either. The function
-- returns exactly the view's columns and nothing else, which is what keeps the
-- 0007 rule ("Do NOT add bio, email, or created_at") in one place: the column
-- list below. The RLS test's column check still holds the view to it.
--
-- Cost: a definer function is never inlined, so a filter on the view
-- (`.eq("id")`, `.in("id")`) reads every card and filters after. Six short
-- columns per profile; fine at this size, and the place to look if it is not.

create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to anon, authenticated;

create or replace function private.profile_cards()
returns table (
  id             uuid,
  username       text,
  username_lower text,
  display_name   text,
  avatar_url     text,
  avatar_grid    text
)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.username, p.username_lower, p.display_name, p.avatar_url, p.avatar_grid
    from public.profiles p
$$;

revoke all on function private.profile_cards() from public;
grant execute on function private.profile_cards() to anon, authenticated;

create or replace view public.profile_cards
  with (security_invoker = true) as
  select id, username, username_lower, display_name, avatar_url, avatar_grid
    from private.profile_cards();

grant select on public.profile_cards to anon, authenticated;
