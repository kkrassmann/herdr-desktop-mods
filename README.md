# herdr-desktop-mods

Mods for the [Herdr app](https://herdr.dev).

| Mod | What it does |
|---|---|
| [agent-groups](agent-groups/) | Agents list grouped by machine (CPU/RAM) and space: session name, status colors, context size, folder · branch, sub-agents. |
| [ticker](ticker/) | Claude Code mod: live progress band + pane for multi-step tasks; labels the herdr terminal, so agent-groups shows `45% - <title>` and the steps. |

## Install

One command for ticker + agent-groups + sub-agent hooks (Windows, macOS, Linux; needs `git`, `node`):

```sh
git clone https://github.com/kkrassmann/herdr-desktop-mods ~/.claude/herdr-desktop-mods
node ~/.claude/herdr-desktop-mods/install.js --dry-run   # shows what it would change
node ~/.claude/herdr-desktop-mods/install.js
```

It adds `ticker` to `CLAUDE_CODE_PLUGIN_DIRS` and the sub-agent hooks to `~/.claude/settings.json`
(backup `settings.json.bak-herdr`, older ticker/hook entries replaced), and copies agent-groups into
`~/.config/herdr-app/mods/` when the Herdr desktop app is installed. Keep the clone: Claude loads
from it. Update: `git pull`, rerun. Tests: `node install.test.js`. Layout and statusline stay manual
(agent-groups README steps 2 and 4); the script reports them.

Or per mod:

Paste to your coding agent (in a Herdr terminal):

`Read ~/.config/herdr-app/AGENTS.md, then add this mod: https://github.com/kkrassmann/herdr-desktop-mods/tree/main/<mod> and follow its README`

Each mod's README also has the steps by hand.

## Also recommended

From [dougcunha/herdr-mods](https://github.com/dougcunha/herdr-mods):
[agent-resume](https://github.com/dougcunha/herdr-mods/tree/main/agent-resume-app) (resume agent
sessions after a reboot) and
[mods-update](https://github.com/dougcunha/herdr-mods/tree/main/mods-update-app).
