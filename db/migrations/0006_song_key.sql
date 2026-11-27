-- A song's key ("F# minor"), when its scale is switched on: written with the
-- song (lib/data/songs.js songColumns) so a list can show it without pulling
-- `data`. Null means no scale, or a song not saved since this column.

alter table songs add column song_key text;

-- Songs already here whose data is inline (a value too big for a row lives in
-- R2 as {"$r2": key}, and stays null until it is next saved).
update songs
   set song_key = trim(
         (case ((cast(json_extract(data, '$.scale.root') as integer) % 12) + 12) % 12
            when 0 then 'C' when 1 then 'C#' when 2 then 'D' when 3 then 'D#'
            when 4 then 'E' when 5 then 'F' when 6 then 'F#' when 7 then 'G'
            when 8 then 'G#' when 9 then 'A' when 10 then 'A#' else 'B' end)
         || ' ' || coalesce(json_extract(data, '$.scale.mode'), ''))
 where json_valid(data)
   and json_type(data, '$.scale.active') = 'true';
