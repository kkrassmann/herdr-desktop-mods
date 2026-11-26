// node install.test.js -> "install ok"
'use strict';
const assert = require('assert');
const { mergeSettings, hasAgentGroupsLayout, statuslineFile } = require('./install.js');

const REPO = '/home/me/.claude/herdr-desktop-mods';
const SCRIPT = `${REPO}/agent-groups/mods/agent-groups/hooks/herdr-subagents.js`;
const cmds = (s, event) => (s.hooks[event] ?? []).flatMap((g) => g.hooks.map((h) => h.command));

// Empty settings -> plugin dir + 4 hook events
const fresh = mergeSettings({}, REPO, ':');
assert.strictEqual(fresh.env.CLAUDE_CODE_PLUGIN_DIRS, `${REPO}/ticker`);
assert.deepStrictEqual(cmds(fresh, 'SubagentStart'), [`node "${SCRIPT}" start`]);
assert.strictEqual(fresh.hooks.SessionStart[0].matcher, '^(startup|resume)$');
assert.strictEqual(fresh.hooks.SubagentStart[0].matcher, '');
assert.ok(!('matcher' in fresh.hooks.SubagentStop[0]));

// Second run changes nothing
assert.deepStrictEqual(mergeSettings(fresh, REPO, ':'), fresh);

// Migration: old ticker copy + ps1 hooks replaced, foreign plugin dirs, hooks and keys kept
const old = {
  model: 'opus',
  env: { CLAUDE_CODE_PLUGIN_DIRS: 'C:/Users/me/.claude/mods/ticker;C:/Users/me/.claude/mods/other' },
  hooks: {
    SessionStart: [
      { matcher: '^(startup|resume)$', hooks: [{ type: 'command', command: 'powershell -File "x\\herdr-subagents.ps1" clear' }, { type: 'command', command: 'foreign start' }] },
    ],
    SubagentStop: [{ hooks: [{ type: 'command', command: 'powershell -File "x\\herdr-subagents.ps1" stop' }] }],
    Stop: [{ hooks: [{ type: 'command', command: 'keep me' }] }],
  },
};
const migrated = mergeSettings(old, 'C:/Users/me/.claude/herdr-desktop-mods', ';');
assert.strictEqual(migrated.model, 'opus');
assert.strictEqual(migrated.env.CLAUDE_CODE_PLUGIN_DIRS, 'C:/Users/me/.claude/mods/other;C:/Users/me/.claude/herdr-desktop-mods/ticker');
assert.deepStrictEqual(cmds(migrated, 'SessionStart'), ['foreign start', 'node "C:/Users/me/.claude/herdr-desktop-mods/agent-groups/mods/agent-groups/hooks/herdr-subagents.js" clear']);
assert.strictEqual(cmds(migrated, 'SubagentStop').length, 1);
assert.deepStrictEqual(cmds(migrated, 'Stop'), ['keep me']);
assert.ok(old.hooks.SubagentStop[0].hooks[0].command.includes('ps1'), 'input not mutated');

// Layout + statusline helpers
assert.ok(hasAgentGroupsLayout(['{"id": "agents", "mod": "agent-groups"}']));
assert.ok(!hasAgentGroupsLayout(['{"id": "agents", "mod": "agents"}']));
assert.strictEqual(statuslineFile('node "C:/Users/me/.claude/hooks/statusline.js"'), 'C:/Users/me/.claude/hooks/statusline.js');
assert.strictEqual(statuslineFile('bash ~/x.sh'), null);

console.log('install ok');
