-- Whether a song was started from one of its owner's templates.
--
-- A song saved off a template records the template in `forked_from`, the
-- column a remix uses (0010), so a profile read every such song as a remix:
-- "remixed from techno starter", or a bare "remix" when the template is
-- private and the lineage lookup could not read it. A template is a starting
-- point, not someone else's song.
--
-- A computed field rather than a column, so nothing on the save path changes
-- and a database without this migration still saves: the reader asks for
-- `from_template` and falls back without it (app/profile/actions.ts).
--
-- Security definer, because the template is usually private and the profile
-- is read by someone else. It reads the song from the TABLE, never the row it
-- was handed (/rpc takes any row), only for a song the caller can read, and
-- says one thing: whether that song's source is a template of the same owner.

create or replace function public.from_template(s public.songs)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.songs me
      join public.songs src on src.id = me.forked_from
     where me.id = s.id
       and (me.is_public or me.owner_id = (select auth.uid()))
       and src.is_template
       and src.owner_id = me.owner_id
  )
$$;

revoke all on function public.from_template(public.songs) from public;
grant execute on function public.from_template(public.songs) to anon, authenticated;
