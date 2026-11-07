import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { clean, nameOf, groupBySpace, topStatus, subagentsOf, formatTokens, sessionInfo, machineOf, groupByMachine, STATS_SCRIPT, parseStats, formatRam } from "./groups.js";

assert.equal(clean("✳ Portal-RC"), "Portal-RC");
assert.equal(clean("  "), "");
assert.equal(nameOf({ title: "⠂ ", tab_name: "1", address: "t1" }), "1");
assert.equal(nameOf({ title: "", tab_name: "", program: { name: "Claude Code" }, address: "t1" }), "Claude Code");

const g = groupBySpace([
  { space: "a", space_name: "Slot-1", status: "idle" },
  { space: "a", space_name: "Slot-1", status: "working" },
  { space: "b", space_name: "Slot-2", status: "done" },
]);
assert.deepEqual(g.map((x) => [x.label, x.members.length]), [["Slot-1", 2], ["Slot-2", 1]]);
assert.equal(topStatus(g[0].members), "working");
assert.equal(topStatus([{ status: "working" }, { status: "blocked" }, { status: "done" }]), "blocked");
assert.equal(topStatus([]), "idle");
assert.deepEqual(subagentsOf({ "sub.a1": "cd:coding", "resume.agent": "claude", "sub.b2": "", "herdr.tab": "x" }), [{ id: "a1", type: "cd:coding" }]);
assert.deepEqual(subagentsOf(undefined), []);
assert.equal(formatTokens(203456), "203k");
assert.equal(formatTokens(1_000_000), "1M");
assert.equal(formatTokens(1_250_000), "1.3M");
assert.equal(formatTokens(999), "999");
assert.equal(formatTokens(null), "");
assert.deepEqual(sessionInfo({ "claude.dir": "api-slot-1", "claude.branch": "main", "claude.tokens": "203456" }), { dir: "api-slot-1", branch: "main", tokens: 203456 });
assert.deepEqual(sessionInfo({ "claude.tokens": "abc" }), { dir: "", branch: "", tokens: null });
assert.deepEqual(sessionInfo(undefined), { dir: "", branch: "", tokens: null });
assert.equal(machineOf({ address: "t3" }), null);
assert.equal(machineOf({ address: "home-mini/t1" }), "home-mini");
const machines = groupByMachine([
  { address: "t3", space: "a", space_name: "Slot-1" },
  { address: "t4", space: "b", space_name: "Ape" },
  { address: "home-mini/t1", space: "home-mini/c", space_name: "Plates" },
]);
assert.deepEqual(machines.map((m) => [m.machine, m.spaces.map((s) => s.label)]), [[null, ["Slot-1", "Ape"]], ["home-mini", ["Plates"]]]);

// The stats script really runs and reports sane numbers on this machine.
const stats = parseStats(execFileSync(process.execPath, ["-e", STATS_SCRIPT], { encoding: "utf8" }));
assert.ok(stats && stats.cpu >= 0 && stats.cpu <= 100 && stats.used > 0 && stats.used <= stats.total, JSON.stringify(stats));
assert.equal(parseStats("not json"), null);
assert.equal(parseStats('{"used":1,"total":0}'), null);
assert.equal(formatRam(18.2 * 2 ** 30, 32 * 2 ** 30), "18.2/32 GB");
console.log("groups ok");
