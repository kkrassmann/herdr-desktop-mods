#!/usr/bin/env node
// Sets up this repo's mods on this machine: Claude mod "ticker" + sub-agent hooks (always),
// herdr mod "agent-groups" (only where the Herdr desktop app is installed). Idempotent.
// Usage: node install.js [--dry-run]
// The Claude side points at this clone (plugin dir + hook paths): keep the clone, update with git pull + rerun.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const REPO = __dirname;
const MOD_SRC = path.join(REPO, 'agent-groups', 'mods', 'agent-groups');
const HOOK_MARK = 'herdr-subagents.';
const slash = (p) => p.replace(/\\/g, '/');

// event -> [matcher or undefined, action]
const HOOK_EVENTS = {
  SessionStart: ['^(startup|resume)$', 'clear'],
  SessionEnd: [undefined, 'clear'],
  SubagentStart: ['', 'start'],
  SubagentStop: [undefined, 'stop'],
};

/** New settings object: ticker plugin dir + sub-agent hooks set, older copies of both replaced, everything else kept. */
function mergeSettings(settings, repoDir, delimiter) {
  const out = JSON.parse(JSON.stringify(settings ?? {}));
  const tickerDir = slash(path.join(repoDir, 'ticker'));

  // Plugin dirs: drop other "ticker" copies -> the tool "update" is registered once
  out.env = out.env ?? {};
  const dirs = String(out.env.CLAUDE_CODE_PLUGIN_DIRS ?? '').split(delimiter).filter(Boolean)
    .filter((d) => slash(d) === tickerDir || path.basename(slash(d).replace(/\/+$/, '')) !== 'ticker');
  if (!dirs.some((d) => slash(d) === tickerDir)) dirs.push(tickerDir);
  out.env.CLAUDE_CODE_PLUGIN_DIRS = dirs.join(delimiter);

  // Hooks: remove every older herdr-subagents entry (ps1 or other path), then add ours
  out.hooks = out.hooks ?? {};
  const script = slash(path.join(repoDir, 'agent-groups', 'mods', 'agent-groups', 'hooks', 'herdr-subagents.js'));
  for (const [event, [matcher, action]] of Object.entries(HOOK_EVENTS)) {
    const groups = (out.hooks[event] ?? [])
      .map((g) => ({ ...g, hooks: (g.hooks ?? []).filter((h) => !String(h.command ?? '').includes(HOOK_MARK)) }))
      .filter((g) => g.hooks.length > 0);
    const group = { hooks: [{ type: 'command', timeout: 10, command: `node "${script}" ${action}` }] };
    if (matcher !== undefined) group.matcher = matcher;
    out.hooks[event] = [...groups, group];
  }
  return out;
}

/** True when one of the layout texts puts agent-groups into a block. */
const hasAgentGroupsLayout = (texts) => texts.some((t) => /"mod"\s*:\s*"agent-groups"/.test(t));

/** Script file a statusLine command runs, or null. */
function statuslineFile(command) {
  const m = /"([^"]+\.(?:c?js|mjs))"|(\S+\.(?:c?js|mjs))/.exec(String(command ?? ''));
  return m ? (m[1] ?? m[2]).replace(/^~(?=[\\/])/, os.homedir()) : null;
}

function report(label, detail) {
  console.log(`${label.padEnd(8)} ${detail}`);
}

function installClaude(home, dryRun) {
  const file = path.join(home, '.claude', 'settings.json');
  const text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '{}';
  const before = JSON.parse(text);
  const after = mergeSettings(before, REPO, path.delimiter);
  if (JSON.stringify(before) === JSON.stringify(after)) return report('OK', `${file}: ticker + sub-agent hooks already set`);

  if (!dryRun) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    if (fs.existsSync(file)) fs.copyFileSync(file, `${file}.bak-herdr`);
    fs.writeFileSync(file, JSON.stringify(after, null, 2) + '\n');
  }
  report(dryRun ? 'WOULD' : 'CHANGED', `${file}: CLAUDE_CODE_PLUGIN_DIRS + hooks SessionStart/SessionEnd/SubagentStart/SubagentStop${dryRun ? '' : ` (backup: ${file}.bak-herdr)`}`);
  report('PLUGINS', after.env.CLAUDE_CODE_PLUGIN_DIRS);

  const statusFile = statuslineFile(after.statusLine?.command);
  if (statusFile && fs.existsSync(statusFile) && !fs.readFileSync(statusFile, 'utf8').includes('herdr-statusline')) {
    report('HINT', `statusline ${statusFile} does not feed herdr yet (agent-groups/README.md step 4)`);
  }
}

function installHerdr(home, dryRun) {
  const appDir = path.join(home, '.config', 'herdr-app');
  if (!fs.existsSync(appDir)) return report('SKIP', `no Herdr desktop app (${appDir}): agent-groups not copied, labels still work for a remote desktop`);

  const target = path.join(appDir, 'mods', 'agent-groups');
  const files = execFileSync('git', ['-C', MOD_SRC, 'ls-files'], { encoding: 'utf8' }).split('\n').filter(Boolean);
  // mod.json first: without it Herdr docks a stray copy
  files.sort((a, b) => (b === 'mod.json') - (a === 'mod.json'));
  const changed = files.filter((f) => {
    const dst = path.join(target, f);
    return !fs.existsSync(dst) || !fs.readFileSync(dst).equals(fs.readFileSync(path.join(MOD_SRC, f)));
  });
  if (!dryRun) {
    for (const f of changed) {
      fs.mkdirSync(path.dirname(path.join(target, f)), { recursive: true });
      fs.copyFileSync(path.join(MOD_SRC, f), path.join(target, f));
    }
  }
  report(changed.length === 0 ? 'OK' : dryRun ? 'WOULD' : 'CHANGED', `${target}: ${changed.length} of ${files.length} files ${dryRun ? 'to copy' : 'copied'}`);

  const layouts = path.join(appDir, 'layouts');
  const texts = fs.existsSync(layouts) ? fs.readdirSync(layouts).filter((f) => f.endsWith('.json')).map((f) => fs.readFileSync(path.join(layouts, f), 'utf8')) : [];
  report(hasAgentGroupsLayout(texts) ? 'OK' : 'MISSING', hasAgentGroupsLayout(texts) ? 'a layout uses agent-groups' : 'no layout uses agent-groups (agent-groups/README.md step 2)');
}

function checkTerminal() {
  if (!process.env.HC_TERMINAL_ID) return report('HINT', 'HC_TERMINAL_ID not set: this shell is not a herdr terminal, labels only appear in sessions started in one');
  try {
    execFileSync('hc', ['get', process.env.HC_TERMINAL_ID, '--json'], { stdio: 'ignore', timeout: 5000, windowsHide: true });
    report('OK', `herdr terminal ${process.env.HC_TERMINAL_ID}, hc works`);
  } catch (err) {
    report('MISSING', `hc failed (${err.code ?? err.message}): install herdr-core / put hc on PATH`);
  }
}

if (require.main === module) {
  const dryRun = process.argv.includes('--dry-run');
  const home = os.homedir();
  installClaude(home, dryRun);
  installHerdr(home, dryRun);
  checkTerminal();
}

module.exports = { mergeSettings, hasAgentGroupsLayout, statuslineFile };
