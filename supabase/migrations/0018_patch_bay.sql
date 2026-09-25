-- The patch bay: your saved patches, in your account rather than one browser's
-- localStorage. They were always rows of their own in `patches` once
-- published; now every saved patch is a row, private until published, and
-- publishing flips `is_public` on the row you already have instead of
-- inserting a second copy.
--
-- The studio still reads its patches from localStorage (catalog.js); the
-- shell keeps that store and these rows in step (app/patches/patchSync.ts).

-- A saved patch is private until someone says otherwise. publishPatch sets
-- `is_public` explicitly, so nothing that publishes changes meaning.
alter table public.patches alter column is_public set default false;

-- A copy of someone else's patch, saved from its card: which one it came from,
-- so saving it twice finds the first copy, and the card can say it is saved.
alter table public.patches
  add column if not exists saved_from uuid references public.patches (id) on delete set null;

create index if not exists patches_saved_from_idx
  on public.patches (owner_id, saved_from) where saved_from is not null;
