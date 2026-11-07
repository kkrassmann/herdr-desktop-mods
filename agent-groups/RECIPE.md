# Agent Groups

The agents list of the Herdr sidebar, grouped by space: every Claude Code session as a two-line
row with its name, status color, context size, folder, branch and running sub-agents.

## What you see

- Panel fills the `agents` block of the sidebar (`chrome` background, 1px `border` on top).
  Title "Agents" (11.5px, `dim`, medium) at 16px left, 14px top.
- Per space a header row: 28px high, chevron (`mods/workspace-chrome/chevron-down|right.svg`,
  11px), space name (11.5px semibold, `muted`). Folded: member count (`dim`) and, if not idle,
  the most urgent status icon.
- Per agent a row (rounded 7, padding 4px vertical, 18px left):
  - Line 1 (20px): status icon in a 14px slot, session name (13px, truncated), machine name
    (10px `dim`) for remote agents, context tokens (11px `muted`), program icon (15px).
  - Line 2: `folder · branch` (11px `dim`, 22px indent).
- Sub-agent rows under their agent: 24px, 26px left, tree glyph `├`/`└` (`dim`), status icon,
  type name (12px).

## How it behaves

- Status → color: `working` theme `working` + spinning `spinner.svg` (900 ms); `blocked`
  theme `blocked` + 14px `!` badge on `blocked`+`26`; `done` theme `done` filled 8px dot;
  `idle` foreground text, 8px ring in `dim`. Non-idle rows: background status color + `14`,
  name medium weight. Focused row: `selected`; hover: `hover`.
- Tokens ≥ 400 000: badge (px 4, rounded 4, `blocked`+`26`, semibold `blocked` text).
- Click row: `pane.focus {pane}`. Click a `hc run` sub-agent: `terminal.peek`. Click header: fold.
- Calls `setAgentOrder` with the shown order.

## Built from

- `herdr`: `agents()` (grouped by consecutive `space`, label `space_name`), `terminals()` (read
  once per render into a Map: labels, cwd, `parent`, `status`), `run`, `theme`, `setAgentOrder`.
- `groups.js` (no herdr imports, tested by `groups.test.mjs` with node): `clean` (strips Claude's
  leading spinner glyph from titles), `nameOf` (title → tab name → program → address),
  `groupBySpace`, `topStatus` (blocked > done > working > idle), `subagentsOf` (labels `sub.*`),
  `sessionInfo` (labels `claude.dir|branch|tokens`), `formatTokens` (`203k`, `1.2M`).
- `hooks/herdr-subagents.ps1 start|stop|clear`: Claude Code `SubagentStart` / `SubagentStop` /
  `SessionStart(startup|resume)` + `SessionEnd`; `hc label $HC_TERMINAL_ID sub.<agent_id>=<agent_type>`,
  one label per sub-agent so parallel hooks never race. Validates id `^[A-Za-z0-9_-]+$`, type
  `^[\w:.-]+$` (else `agent`).
- `hooks/herdr-statusline.js`: required from the user's statusline with `{dir, branch, tokens}`;
  caches the last value in `~/.claude/herdr-status/<terminal>.json` and spawns detached
  `hc label … claude.dir= claude.branch= claude.tokens=` only on change.

## Watch out

- Claude's in-process sub-agents are invisible to herdr: only the hook labels reveal them.
- Labels, not files: files would live on the machine Claude runs on; labels reach every Herdr
  client.
- An empty label value removes the label (`hc label t3 key=`).
- Folder fallback: last segment of the terminal `cwd` when no statusline labels exist.
- Don't ship `gpui-kit.d.ts` / `jsconfig.json`: the app writes them.

## Done when

- `herdr-app check mods/agent-groups` passes; `node groups.test.mjs` prints `groups ok`.
- Two Claude sessions in one space show under one header with their own titles.
- A running sub-agent shows under its session and disappears when it ends.
- A session's row shows the same token count as its statusline; ≥ 400k turns red.
