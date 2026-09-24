-- 0014's CHECK could never pass. It was written `avatar_grid ~ '^[0-9a-d]{256}$'`,
-- and Postgres caps a regex repetition count at 255 (DUPMAX): the pattern does
-- not compile, so the constraint raised "invalid regular expression: invalid
-- repetition count(s)" on every non-null grid, and nobody could save a drawn
-- avatar. NULL skipped the regex, which is why signup and every other profile
-- write went on working.
--
-- The same rule, split in two so neither half needs a count: exactly 256
-- characters, and none outside the alphabet. app/profile/avatarGrid.js's
-- AVATAR_GRID_RE is still the one-line form; test/avatarGrid.test.js holds
-- the two together.

alter table public.profiles
  drop constraint if exists profiles_avatar_grid_shape;
alter table public.profiles
  add constraint profiles_avatar_grid_shape
  check (avatar_grid is null or (char_length(avatar_grid) = 256 and avatar_grid !~ '[^0-9a-d]'));
