-- A song's title and a patch's name were clipped only by the server actions
-- (200 and 120 characters). The anon key is public, so a signed-in account can
-- write its own rows straight through PostgREST, and a public song with a
-- megabyte of title goes out to every visitor of the pages that list titles.
--
-- NOT VALID: the rule holds for every write from here on without failing the
-- migration over a row that already breaks it.
alter table public.songs
  drop constraint if exists songs_title_length,
  add constraint songs_title_length check (char_length(title) <= 200) not valid;

alter table public.patches
  drop constraint if exists patches_name_length,
  add constraint patches_name_length check (char_length(name) <= 120) not valid;
