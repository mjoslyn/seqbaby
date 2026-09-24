# seqbaby MCP server

An MCP server that lets an AI agent write seqbaby songs. It holds one song
in memory, exposes the song builder (`public/js/songBuilder.js`) as tools,
serves the engine catalog and a compose guide as resources, and exports the
result as the JSON the studio loads, or posts it to `/api/share` for a link.

## Run

Straight from GitHub, no clone (`bin` in package.json names the server):

```json
{ "mcpServers": { "seqbaby": { "command": "npx", "args": ["-y", "github:mjoslyn/seqbaby"] } } }
```

The first run installs the repo into npx's cache, which brings the whole app's
dependencies with it (a minute or so); after that it starts at once. Pin a
branch or tag with `github:mjoslyn/seqbaby#<ref>`.

From a checkout:

```
npm install
npm run mcp           # stdio; the client starts it
```

- **Claude Code**: the repo's `.mcp.json` names it, so opening the repo
  offers it. The `compose` skill (`.claude/skills/compose/SKILL.md`) is the
  guide the tools expect an agent to have read; the server also serves it as
  the resource `seqbaby://guide`.
- **Claude Desktop**: in `claude_desktop_config.json`
  ```json
  { "mcpServers": { "seqbaby": { "command": "node", "args": ["/path/to/seqbaby/mcp/server.mjs"] } } }
  ```
- Any MCP client over stdio works the same way.

Env:

| var | what |
|---|---|
| `SEQBABY_URL` | where `share_song` posts and `audition_song` opens the studio. Default `https://www.playseqbaby.com`; `http://localhost:3000` for a dev server (a bare site URL opens its `/studio`) |
| `SEQBABY_CHROME` | a Chromium binary for `audition_song` when playwright's own is not installed |

## Tools

| group | tools |
|---|---|
| song | `new_song`, `get_song`, `set_tempo`, `set_scale`, `set_arrangement`, `set_meter`, `load_song` |
| engines | `list_engines`, `describe_engine` |
| tracks | `add_track`, `remove_track`, `set_track` (name, length, mute, solo, glide, speed, out) |
| steps | `set_steps` (a step string), `set_notes`, `set_step` (one step in full), `clear_pattern`, `copy_pattern` |
| sound | `set_params`, `apply_preset`, `set_filter`, `set_eq`, `set_comp`, `set_fx` |
| modulation | `add_lfo`, `remove_lfo`, `set_automation`, `remove_automation` |
| generators | `set_euclid`, `set_chance` |
| out | `validate_song`, `export_song`, `share_song`, `audition_song` |

Resources: `seqbaby://guide`, `seqbaby://engines`, `seqbaby://targets`,
`seqbaby://samples`, `seqbaby://format`, `seqbaby://song`. Prompt: `compose`.

## Audition

`audition_song` opens the studio in a headless Chromium, loads the song,
presses play and reads every track's meter for a few seconds, reporting rms
and peak in dB per track and for the master. It needs the `playwright`
package (`npm i playwright`, which downloads a Chromium) and a studio to
open: the live site by default, or a local `npm run dev` with `SEQBABY_URL`.

## How it is built

`songBuilder.js` is pure: it imports only the engine's data modules
(`engineData.js`, `soundDefaults.js`, `constants.js`, `theoryData.js`,
`chanceGen.js`, `sessionFormat.js`), which is what lets it run under Node
and be tested (`test/songBuilder.test.js`). Validation uses the same tables
the engine reads, so an engine control added to its list is a control the
tools know. The song it writes is sparse; the studio fills every absent
field with the default the panels start from.
