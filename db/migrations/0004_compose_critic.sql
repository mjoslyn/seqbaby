-- The critic turn's part of a compose turn's record (mcp/critic.mjs): whether
-- the finished song was reviewed by a second model call, and how many notes
-- came back. Counts only, like the rest of compose_turns: never the notes.

alter table compose_turns add column critic integer;        -- 1 reviewed, 0 the review failed, null not reviewed
alter table compose_turns add column critic_notes integer;
