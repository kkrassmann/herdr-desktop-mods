# Agent Groups

A mod for the Herdr app: the agents list, grouped by space. Each Claude Code session shows its
name, its status in color, its context size, its folder and branch, and the sub-agents it runs.

```
Slot-1
  ◌ API-RC                         158k 🦀
    api-slot-1 · fix/login
    └ ◌ cd:explorer
  ! Portal-RC                      412k 🦀      <- red badge from 400k
    portal-slot-1 · main
```

With spaces on 2+ machines (`hc machine`), the machine becomes the top group, with its CPU load
and RAM usage:

```
This computer            36% · 25.3/48 GB
  Slot-1
    ◌ API-RC  221k …
home-mini                16% · 17.9/31 GB
  247-kennzeichen-historie
    ◌ License-plate-history …
```

## What you see

- **Machines** (only with spaces on 2+ machines): one header per machine, "This computer" first.
  It shows CPU % and RAM used/total, measured every 5 s. Click folds it.
- **Groups**: one per space, in space order. Click the header to fold it; folded, it shows the
  count and the most urgent status.
- **Row, line 1**: status icon, session name (the terminal title Claude sets, e.g. after
  `/rename`), context tokens, program icon. Click focuses the pane.
- **Row, line 2**: folder · branch.
- **Status colors** (theme tokens): working = orange spinner, needs you = red `!`,
  done = green dot, idle = plain ring. Non-idle rows get a light tint.
- **Context**: same number as the Claude statusline (`203k`). From 400k: red badge.
- **Sub-agents**: under each session, Claude's sub-agents (Agent tool) by type, and terminals
  the agent started with `hc run` (click to peek).

## How it works

Everything travels as labels on the session's herdr-core terminal, so it works for remote
machines (`hc machine`) too:

| Label | Written by |
|---|---|
| `claude.dir`, `claude.branch`, `claude.tokens` | your statusline, via `hooks/herdr-statusline.js` (only on change) |
| `sub.<agent_id>=<agent_type>` | `hooks/herdr-subagents.js` (SubagentStart / SubagentStop) |
| `ticker` (JSON `{total, steps}`) | the Claude mod [ticker](../ticker/): progress leads the title, its steps replace the sub-agents |

The mod reads `terminals()` and redraws when labels change. No network.

Machine stats: with 2+ machines, every 5 s the mod runs `node -e <script>` on each machine
(`exec` with `on`): two `os.cpus()` samples 500 ms apart for CPU %, `os.totalmem/freemem` for
RAM. A machine without `node` shows no numbers. With one machine nothing runs.

## Install

Paste this to your agent:

`Read ~/.config/herdr-app/AGENTS.md, then add this mod: https://github.com/kkrassmann/herdr-desktop-mods/tree/main/agent-groups and follow its README`

Or by hand. `<HOME>` is your home folder (e.g. `C:\Users\me`).

### 1. Copy the mod

Copy `mods/agent-groups/` to `~/.config/herdr-app/mods/agent-groups/`. Copy `mod.json` first:
without it, Herdr docks a stray copy.

### 2. Put it in your layout

Herdr's own layouts are read-only. Clone one first:

```sh
herdr-app do layout.clone '{"name":"main","as":"my-main"}'
```

In `~/.config/herdr-app/layouts/my-main.json`, change the block with `"id": "agents"` from
`"mod": "agents"` to `"mod": "agent-groups"`. To go back, change it back.

### 3. Claude Code hooks (sub-agents)

`node install.js` in the repo root sets them (see the main README). By hand: add to
`~/.claude/settings.json` in `hooks`, beside the hooks you already have (if an event exists, add
the entry to its list). `<REPO>` = path of your clone, forward slashes:

```json
"SessionStart": [{ "matcher": "^(startup|resume)$", "hooks": [
  { "type": "command", "timeout": 10, "command": "node \"<REPO>/agent-groups/mods/agent-groups/hooks/herdr-subagents.js\" clear" } ] }],
"SessionEnd": [{ "hooks": [
  { "type": "command", "timeout": 10, "command": "node \"<REPO>/agent-groups/mods/agent-groups/hooks/herdr-subagents.js\" clear" } ] }],
"SubagentStart": [{ "matcher": "", "hooks": [
  { "type": "command", "timeout": 10, "command": "node \"<REPO>/agent-groups/mods/agent-groups/hooks/herdr-subagents.js\" start" } ] }],
"SubagentStop": [{ "hooks": [
  { "type": "command", "timeout": 10, "command": "node \"<REPO>/agent-groups/mods/agent-groups/hooks/herdr-subagents.js\" stop" } ] }]
```

`clear` removes leftover labels after a crash (no `SubagentStop` comes then).

### 4. Statusline (folder, branch, context)

Your Claude statusline script (`statusLine` in `~/.claude/settings.json`) already knows the
folder, branch and tokens. Add one line after it computed them:

```js
try { require(require('os').homedir() + '/.config/herdr-app/mods/agent-groups/hooks/herdr-statusline.js')({ dir, branch, tokens }); } catch {}
```

`dir`: folder name, `branch`: branch or `''`, `tokens`: context tokens or `null`.
Without a statusline, line 2 shows only the folder (from the terminal's cwd).

### 5. Check

1. `herdr-app check ~/.config/herdr-app/mods/agent-groups`
2. `node ~/.config/herdr-app/mods/agent-groups/groups.test.mjs` prints `groups ok`,
   `node ~/.config/herdr-app/mods/agent-groups/hooks/herdr-subagents.test.js` prints `herdr-subagents ok`.
3. Start Claude in a Herdr terminal and send a prompt: the row shows folder, branch and tokens.
   Ask it to run a sub-agent: it shows under the row while it runs.

## Limits

- Claude sub-agents have no status of their own: they show as working while they run, by type
  (`cd:coding`), without their description.
- Sub-agents that started before the hooks were installed don't show.
- Each hook starts `node` (one process per sub-agent start/stop).
- No narrow view for the collapsed sidebar, no pinning, no sorting.

## Pairs well with

- [agent-resume](https://github.com/dougcunha/herdr-mods/tree/main/agent-resume-app): restarts
  agent sessions after a reboot.
- [mods-update](https://github.com/dougcunha/herdr-mods/tree/main/mods-update-app): update button
  for dougcunha's mods.
