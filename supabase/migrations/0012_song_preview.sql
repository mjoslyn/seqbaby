-- A song's step preview: the picture on its card in the homepage feed, on a
-- profile page and in the songs menu.
--
-- Computed in the database, from the saved session, rather than in the
-- browser or the server component, because `data` is the whole session --
-- base64 sample payloads included -- and a card needs a few hundred bytes out
-- of it. Reading 24 songs' data to draw 24 thumbnails would move megabytes to
-- throw nearly all of it away. Here only the preview leaves the database.
--
-- Computed on READ rather than stored in a column: nothing on the write path
-- has to learn about it, every song saved before this migration has one the
-- moment it is applied, and it can never disagree with the song.
--
-- The shape, kept small because it rides on every card:
--
--   { "p": 3,                         the pattern shown (see below)
--     "t": [                          one entry per track, buses left out, at most 8
--       { "s": "9..5-..3..." },       written steps: 1-9 a hit at that velocity,
--                                     "-" held by the hit before it, "." a rest
--       { "n": 16, "g": {...} },      a live euclid ring: its settings, which the
--                                     client expands (app/songs/songPreview.js)
--       { "n": 16, "c": {...} } ] }   a live chance generator: its window only
--
-- WHICH pattern: the one the song was saved on (`activePattern`), unless that
-- one is empty, in which case the first pattern with anything in it -- a song
-- saved while looking at an empty slot should still have a face.

create or replace function public.song_preview(d jsonb)
returns jsonb
language plpgsql
immutable
parallel safe
set search_path = ''
as $$
declare
  tracks jsonb := d -> 'tracks';
  ap int := 0;
  cand int;
  t jsonb;
  pat jsonb;
  steps jsonb;
  vels jsonb;
  lens jsonb;
  el jsonb;
  len int;
  i int;
  hold int;
  span int;
  v numeric;
  line text;
  rows jsonb;
  any_hit boolean;
  n_tracks int;
begin
  if jsonb_typeof(tracks) is distinct from 'array' then
    return null;
  end if;
  if jsonb_typeof(d -> 'activePattern') = 'number' then
    ap := greatest(0, least(31, (d ->> 'activePattern')::numeric::int));
  end if;

  foreach cand in array (array[ap] || array(select generate_series(0, 31))) loop
    rows := '[]'::jsonb;
    any_hit := false;
    n_tracks := 0;

    for t in select value from jsonb_array_elements(tracks) loop
      exit when n_tracks >= 8;
      continue when jsonb_typeof(t) is distinct from 'object'
        or t ->> 'engineKey' = 'bus';
      n_tracks := n_tracks + 1;

      len := 16;
      if jsonb_typeof(t -> 'length') = 'number' then
        len := greatest(1, least(64, (t ->> 'length')::numeric::int));
      end if;

      -- A live generator decides the rhythm, and the written steps under it
      -- are whatever was there before it was switched on (stepSource.js).
      if jsonb_typeof(t -> 'euclid') = 'object' and t -> 'euclid' -> 'on' = 'true'::jsonb then
        rows := rows || jsonb_build_array(jsonb_build_object(
          'n', len,
          'g', jsonb_build_object(
            'p', t -> 'euclid' -> 'pulses',
            'n', t -> 'euclid' -> 'steps',
            'r', t -> 'euclid' -> 'rotate',
            'l', t -> 'euclid' -> 'gate' = '"legato"'::jsonb,
            'a', coalesce(t -> 'euclid' -> 'accent', 'true'::jsonb) <> 'false'::jsonb)));
        any_hit := true;
        continue;
      end if;
      if jsonb_typeof(t -> 'chance') = 'object' and t -> 'chance' -> 'on' = 'true'::jsonb then
        rows := rows || jsonb_build_array(jsonb_build_object(
          'n', len,
          'c', jsonb_build_object(
            'f', t -> 'chance' -> 'first',
            'l', t -> 'chance' -> 'last',
            's', t -> 'chance' -> 'rseed')));
        any_hit := true;
        continue;
      end if;

      pat := t -> 'patterns' -> cand;
      steps := pat -> 'steps';
      vels := pat -> 'velocities';
      lens := pat -> 'lengths';
      line := '';
      hold := 0;
      for i in 0 .. len - 1 loop
        el := steps -> i;
        if el = 'true'::jsonb or (jsonb_typeof(el) = 'number' and (el #>> '{}')::numeric > 0) then
          v := 0.5;
          if jsonb_typeof(vels -> i) = 'number' then v := (vels ->> i)::numeric; end if;
          line := line || greatest(1, least(9, round(v * 9)))::int::text;
          span := 1;
          if jsonb_typeof(lens -> i) = 'number' then span := greatest(1, (lens ->> i)::numeric::int); end if;
          hold := span - 1;
          any_hit := true;
        elsif hold > 0 then
          line := line || '-';
          hold := hold - 1;
        else
          line := line || '.';
        end if;
      end loop;
      rows := rows || jsonb_build_array(jsonb_build_object('s', line));
    end loop;

    if any_hit then
      return jsonb_build_object('p', cand, 't', rows);
    end if;
  end loop;

  -- Nothing written anywhere: still a grid of the right shape, all rests.
  return jsonb_build_object('p', ap, 't', rows);
end;
$$;

-- The computed field: PostgREST exposes a function taking a table's row type
-- as a virtual column, so `.select("id,title,preview")` works on songs. It runs
-- as the caller, under the songs policies, so it previews exactly the rows the
-- caller could already read in full.
create or replace function public.preview(s public.songs)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select public.song_preview(s.data)
$$;

grant execute on function public.song_preview(jsonb) to anon, authenticated;
grant execute on function public.preview(public.songs) to anon, authenticated;
