-- A song's tags: a genre from the compose panel's list or anything its owner
-- typed, as a JSON array of normalized strings (lib/songTags.js). Written by
-- the save box, the songs menu and a kept compose turn (which adds its
-- genre); read with the lists, never from `data`.

alter table songs add column tags text not null default '[]';
