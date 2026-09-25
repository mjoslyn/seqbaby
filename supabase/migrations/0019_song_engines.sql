-- Which engines a song is made of: what the songs explorer (/songs) filters
-- on when someone asks for "everything with a silverbox in it".
--
-- Computed in the database on read, for 0012's reason: `data` is the whole
-- session, base64 samples included, and the explorer needs a handful of
-- engine keys out of each of a few hundred songs. Nothing on the write path
-- has to learn about it, and every song saved before this has its list the
-- moment the migration is applied.
--
-- The raw keys, not instrument names: `dm:808-kick` and `dm:808-snare` are
-- both "808" to a person, and a song saved before the emulator rename still
-- says `dm:303`. Folding those is the client's (app/songs/explore.js), where a
-- test can pin it against the engine's own rename table. Buses are left out:
-- an fx bus plays nothing, so it is not an instrument anybody is looking for.

create or replace function public.song_engines(d jsonb)
returns text[]
language sql
immutable
parallel safe
set search_path = ''
as $$
  select coalesce(array_agg(distinct k order by k), '{}'::text[])
    from (
      select t ->> 'engineKey' as k
        from jsonb_array_elements(
               case when jsonb_typeof(d -> 'tracks') = 'array' then d -> 'tracks' else '[]'::jsonb end
             ) as t
       where jsonb_typeof(t) = 'object'
         and jsonb_typeof(t -> 'engineKey') = 'string'
    ) keys
   where k <> '' and k <> 'bus'
$$;

-- The computed field: `.select("id,engines")` on songs. Runs as the caller,
-- under the songs policies, exactly as preview(songs) does.
create or replace function public.engines(s public.songs)
returns text[]
language sql
stable
set search_path = ''
as $$
  select public.song_engines(s.data)
$$;

grant execute on function public.song_engines(jsonb) to anon, authenticated;
grant execute on function public.engines(public.songs) to anon, authenticated;
