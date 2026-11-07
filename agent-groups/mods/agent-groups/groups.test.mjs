import assert from "node:assert/strict";
import { clean, nameOf, groupBySpace, topStatus, subagentsOf, formatTokens, sessionInfo } from "./groups.js";

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
console.log("groups ok");
