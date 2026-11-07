// For a Claude Code statusline: labels the session's herdr terminal with folder, branch and
// context tokens, so the agent-groups mod shows them (from any machine).
// Usage in a statusline script:
//   try { require(require('os').homedir() + '/.config/herdr-app/mods/agent-groups/hooks/herdr-statusline.js')({ dir, branch, tokens }); } catch {}
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

module.exports = function shareWithHerdr({ dir = '', branch = '', tokens = null } = {}) {
  const terminal = process.env.HC_TERMINAL_ID;
  if (!terminal || !/^[\w-]+$/.test(terminal)) return;
  try {
    // A cache file keeps hc calls to actual changes: the statusline runs on every update.
    const cacheDir = path.join(os.homedir(), '.claude', 'herdr-status');
    const file = path.join(cacheDir, `${terminal}.json`);
    const text = JSON.stringify({ dir, branch, tokens });
    let old = null;
    try { old = fs.readFileSync(file, 'utf8'); } catch { /* first write */ }
    if (old === text) return;
    const args = ['label', terminal, `claude.dir=${dir}`, `claude.branch=${branch}`, `claude.tokens=${tokens ?? ''}`];
    // Detached: the statusline must not wait for hc.
    spawn('hc', args, { detached: true, stdio: 'ignore', windowsHide: true }).on('error', () => {}).unref();
    fs.mkdirSync(cacheDir, { recursive: true });
    fs.writeFileSync(file, text);
  } catch { /* never break the statusline */ }
};
