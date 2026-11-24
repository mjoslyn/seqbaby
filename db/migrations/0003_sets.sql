-- Recorded live sets (public/js/setRecorder.js): a starting snapshot of the
-- studio (the song, every mix deck, which clip each track is on) and a
-- timeline of what was done to it while it played, replayed by /set/<id>.
--
-- The recording itself is in R2 (sets/<id>/set.json): it holds whole
-- sessions, a deck's song for every deck loaded and their samples, so it is
-- megabytes as often as not. The row is what a list or a card needs.

create table sets (
  id          text primary key,
  owner_id    text not null references "user" (id) on delete cascade,
  title       text not null check (length(title) <= 120),
  song_id     text references songs (id) on delete set null,   -- the song open when it was recorded, when it was one
  forked_from text references sets (id) on delete set null,    -- the set it was forked from
  fork_step   integer,                                         -- and at which step of it
  bpm         real,
  seconds     real not null default 0,
  steps       integer not null default 0,
  events      integer not null default 0,
  decks       integer not null default 0,
  is_public   integer not null default 0,
  created_at  text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at  text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
create index sets_owner_idx on sets (owner_id, created_at desc);
create index sets_public_idx on sets (is_public, created_at desc);

create trigger sets_touch_updated_at
  after update of owner_id, title, song_id, forked_from, fork_step, bpm, seconds, steps, events, decks, is_public on sets
  for each row when new.updated_at is old.updated_at
begin
  update sets set updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') where id = old.id;
end;
