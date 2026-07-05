-- Profile pages: add a bio and a page-visibility flag. `username` (already on the
-- table) is the profile URL handle. Profiles stay publicly selectable so public
-- songs/patches can be attributed; the /u/<username> page enforces is_public for
-- non-owners in its query layer.

alter table public.profiles add column if not exists bio text;
alter table public.profiles add column if not exists is_public boolean not null default true;

create unique index if not exists profiles_username_key on public.profiles (lower(username))
  where username is not null;
