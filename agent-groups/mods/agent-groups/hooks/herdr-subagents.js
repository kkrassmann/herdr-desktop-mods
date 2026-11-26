#!/usr/bin/env node
// Claude Code hook for the Herdr mod "agent-groups": marks running sub-agents on the session's terminal.
//   start -> label sub.<agent_id>=<agent_type>   (SubagentStart)
//   stop  -> label sub.<agent_id>= (removed)     (SubagentStop)
//   clear -> removes every sub.* label           (SessionStart startup|resume, SessionEnd: no stop comes after a crash)
// One label per sub-agent, so parallel hooks never overwrite each other. Usage: node herdr-subagents.js <start|stop|clear>
'use strict';
const { execFileSync } = require('child_process');

/** `hc label` assignments for an action; [] = nothing to do. `labels` = current terminal labels (clear only). */
function labelArgs(action, payload, labels) {
  if (action === 'clear') {
    return Object.keys(labels ?? {}).filter((k) => k.startsWith('sub.')).map((k) => `${k}=`);
  }
  const id = String(payload?.agent_id ?? '');
  if (!/^[A-Za-z0-9_-]+$/.test(id)) return [];
  if (action === 'start') {
    const type = String(payload?.agent_type ?? '');
    return [`sub.${id}=${/^[\w:.-]+$/.test(type) ? type : 'agent'}`];
  }
  return action === 'stop' ? [`sub.${id}=`] : [];
}

function main(action) {
  const terminal = process.env.HC_TERMINAL_ID;
  if (!terminal || !/^[\w-]+$/.test(terminal)) return;
  const hc = (args) => execFileSync('hc', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000, windowsHide: true });

  let payload = null;
  let labels = null;
  if (action === 'clear') {
    labels = JSON.parse(hc(['get', terminal, '--json'])).labels;
  } else {
    payload = JSON.parse(require('fs').readFileSync(0, 'utf8'));
  }
  const args = labelArgs(action, payload, labels);
  if (args.length > 0) hc(['label', terminal, ...args]);
}

if (require.main === module) {
  // A hook must never fail the Claude session: missing hc, bad stdin, no herdr -> silent exit 0.
  try { main(process.argv[2]); } catch { /* see above */ }
}

module.exports = { labelArgs };
