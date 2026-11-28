-- What each compose turn cost (mcp/composeTurn.mjs sums the usage of every
-- request it made, the critic's included). Tokens as the API reported them;
-- cost_usd priced at the time of the turn by lib/composePricing.js, so a
-- later price change does not rewrite history. Null on a turn recorded
-- before this, or on a model with no price in the table.

alter table compose_turns add column tokens_in integer;
alter table compose_turns add column tokens_out integer;
alter table compose_turns add column cache_read integer;
alter table compose_turns add column cache_write integer;
alter table compose_turns add column cost_usd real;

create index compose_turns_user on compose_turns (user_id, created_at);
