-- Phase 4: a song can be a TEMPLATE -- a starting point rather than a work in
-- progress.
--
-- The whole feature is two booleans on `songs` plus one rule the writer keeps:
-- saving while a template is open inserts a NEW song instead of appending a
-- version to the template. That rule lives in the save actions rather than
-- here, because it is about where a save goes, not about what a row may hold --
-- a template is still an ordinary song, and opening one, deliberately marking
-- it not-a-template and saving is a perfectly reasonable way to edit it.
--
-- Nothing downstream learns about templates: share links, the public profile,
-- `loadSong` and the version tree all read the same columns they did before.

alter table public.songs
  add column if not exists is_template boolean not null default false,
  -- The template a new session starts from. At most one per account, enforced
  -- by the partial unique index below rather than by the writer, because the
  -- writer clears-then-sets and a second tab racing it would otherwise leave an
  -- account with two defaults and no way to tell which one is meant.
  add column if not exists is_default_template boolean not null default false;

-- A default that is not a template would be unreachable from the UI (the
-- default toggle only appears on templates) and would still be what `new`
-- loads, which is exactly the kind of invisible state that survives a bug
-- report. Hence the invariant in the database: setting the default sets both.
alter table public.songs
  drop constraint if exists songs_default_is_template;
alter table public.songs
  add constraint songs_default_is_template
    check (not is_default_template or is_template);

create unique index if not exists songs_one_default_template
  on public.songs (owner_id) where is_default_template;

-- Templates are listed apart from ordinary songs in the menu, and the default
-- is looked up on every `new`.
create index if not exists songs_template_idx
  on public.songs (owner_id) where is_template;
