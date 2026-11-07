// Pure helpers (no herdr imports, so node can test them: node groups.test.mjs).

// Claude prefixes its title with a spinner glyph ("✳ ").
export const clean = (s) => (s ?? "").replace(/^[^\p{L}\p{N}]+/u, "").trim();

export const nameOf = (a) => clean(a.title) || a.tab_name || a.program?.name || a.address;

// Neighbours in agents() share a space (space, tab, pane order).
export function groupBySpace(list) {
  const groups = [];
  for (const a of list) {
    if (groups.at(-1)?.id === a.space) groups.at(-1).members.push(a);
    else groups.push({ id: a.space, label: a.space_name || "", members: [a] });
  }
  return groups;
}

const RANK = { blocked: 4, done: 3, working: 2, idle: 1 };
export const topStatus = (members) => members.reduce((m, a) => ((RANK[a.status] ?? 0) > (RANK[m] ?? 0) ? a.status : m), "idle");

// Claude's in-process sub-agents, from the labels its SubagentStart/Stop hook writes (hooks/herdr-subagents.ps1).
export const subagentsOf = (labels) =>
  Object.entries(labels ?? {}).filter(([k, v]) => k.startsWith("sub.") && v).map(([k, v]) => ({ id: k.slice(4), type: v }));

// Same format as the Claude statusline: 203k, 1.2M.
export function formatTokens(n) {
  if (n == null) return "";
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, "") + "M";
  if (n >= 1_000) return Math.round(n / 1_000) + "k";
  return String(n);
}

// Session info that ~/.claude/hooks/statusline.js labels on its terminal (any machine).
export function sessionInfo(labels) {
  const l = labels ?? {};
  const tokens = Number(l["claude.tokens"]);
  return { dir: l["claude.dir"] ?? "", branch: l["claude.branch"] ?? "", tokens: l["claude.tokens"] && Number.isFinite(tokens) ? tokens : null };
}

// The machine of an agent: the address prefix of a remote one ("home-mini/t1"), null for this computer.
export const machineOf = (a) => (a.address.includes("/") ? a.address.split("/")[0] : null);

// Machines in first-seen order (agents() lists this computer first), each with its space groups.
export function groupByMachine(list) {
  const byMachine = new Map();
  for (const a of list) {
    const m = machineOf(a);
    if (!byMachine.has(m)) byMachine.set(m, []);
    byMachine.get(m).push(a);
  }
  return [...byMachine].map(([machine, members]) => ({ machine, members, spaces: groupBySpace(members) }));
}

// Runs with `node -e` on each machine: CPU % over 500 ms (two os.cpus() samples) and RAM bytes.
export const STATS_SCRIPT = "const os=require('os'),sum=(t)=>t.user+t.nice+t.sys+t.idle+t.irq,a=os.cpus();setTimeout(()=>{let busy=0,all=0;os.cpus().forEach((c,i)=>{const d=sum(c.times)-sum(a[i].times);all+=d;busy+=d-(c.times.idle-a[i].times.idle)});console.log(JSON.stringify({cpu:all?Math.round(100*busy/all):null,used:os.totalmem()-os.freemem(),total:os.totalmem()}))},500)";

export function parseStats(stdout) {
  try {
    const s = JSON.parse(String(stdout).trim());
    return Number.isFinite(s.used) && Number.isFinite(s.total) && s.total > 0 ? s : null;
  } catch {
    return null;
  }
}

// RAM as "18.2/32 GB".
export const formatRam = (used, total) => `${(used / 2 ** 30).toFixed(1)}/${Math.round(total / 2 ** 30)} GB`;
