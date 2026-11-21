-- How each compose turn went, and what became of it.
--
-- One row per turn, written by the job when the turn ends (workers/composeJob.ts)
-- and given its outcome by the panel when the review bar is answered
-- (app/api/compose/outcome). It exists to answer one question: did a change
-- to the guide, the genre plans or the model make turns people keep?
--
-- Deliberately NOT what was asked for. A transcript is its author's alone
-- (song_chats), and this table is read across accounts by whoever runs the
-- site, so it holds numbers and the genre picker's choice, never the words.

create table compose_turns (
  id           text primary key,              -- the job id
  user_id      text references "user" (id) on delete set null,
  token_hash   text not null,                 -- sha-256 of the job's view token: how an unlocked visitor names their turn
  kind         text not null default 'ask',   -- ask | genre | deck
  genre        text,                          -- the genre picker's id, when it built the prompt
  seed         integer,                       -- and its roll
  model        text,
  status       text not null,                 -- done | error
  changed      integer not null default 0,
  message_len  integer not null default 0,
  ms           integer,
  rounds       integer,
  tool_calls   integer,
  tool_errors  integer,
  nudges       integer,
  lint_first   integer,                       -- production notes when the turn first stopped
  lint_last    integer,                       -- and on the song it handed back
  heard        integer,                       -- 1 the studio listened, 0 it could not, null not asked
  hear_notes   integer,
  polished     integer,
  tracks       integer,
  sections     integer,
  outcome      text,                          -- kept | discarded | superseded | dropped; null until answered
  auditioned   integer not null default 0,
  outcome_at   text,
  created_at   text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

create index compose_turns_created on compose_turns (created_at);
create index compose_turns_genre on compose_turns (genre, created_at);
