-- Avatars are step grids: 16 rows of 16 steps, each unlit or lit in one of
-- the studio's own colours -- a sequencer pattern standing in for a face.
-- Drawn in settings (an editor, a generator, a set of ready-made shapes) and
-- stored as one string, which app/profile/avatarGrid.js reads and writes:
--
--   256 characters, one per cell, row by row: "0" unlit, "1".."d" a colour
--   from that file's PALETTE
--
-- NULL means the person has not drawn one; they are shown a grid generated
-- from their name instead, so nobody is without a face.
--
-- `avatar_url` stays for now (nothing sets it any more, and dropping it would
-- break every reader deployed before this).

alter table public.profiles
  add column if not exists avatar_grid text;

alter table public.profiles
  drop constraint if exists profiles_avatar_grid_shape;
alter table public.profiles
  add constraint profiles_avatar_grid_shape
  check (avatar_grid is null or avatar_grid ~ '^[0-9a-d]{256}$');

-- The attribution view carries it: an avatar is drawn beside a song's owner
-- for anonymous visitors, which is exactly what this view is for. It is a
-- display field like the others here; still no bio (see 0007). New columns
-- go on the end, the only place `create or replace view` accepts them.
create or replace view public.profile_cards as
  select id, username, username_lower, display_name, avatar_url, avatar_grid
    from public.profiles;

alter view public.profile_cards set (security_invoker = false);
grant select on public.profile_cards to anon, authenticated;
