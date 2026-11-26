// Agents grouped by machine (with 2+ machines: CPU/RAM in the header), then space; each row (one line): status, session name (terminal title), branch, context.
// Row color follows status: working, blocked ("needs you"), done; idle stays plain.

import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { agents, terminals, spaces, exec, run, theme, setAgentOrder } from "herdr";
import { nameOf, topStatus, subagentsOf, tickerOf, favKey, seenId, markSeen, orderGroups, moveId, stepLabel, stepStatus, formatTokens, sessionInfo, groupByMachine, STATS_SCRIPT, parseStats, formatRam } from "./groups.js";

// Same threshold as the statusline's !LIMIT: quality drops on a fuller context.
const WARN_TOKENS = 400_000;
// Each read starts node on every machine for ~0.5 s.
const STATS_MS = 5000;
const LOCAL = "This computer";

// Machines that have spaces; null is this computer.
const machineNames = () => [...new Set(spaces().map((s) => s.machine ?? null))];

// Fold state survives reloads and restarts.
// shortcut: addresses are never pruned, so a reused terminal address (t5) starts as the old one was; prune if the list grows.
function load(key) {
  try {
    return new Set(JSON.parse(localStorage.getItem(key) ?? "[]"));
  } catch {
    return new Set();
  }
}

function toggle(set, item, key) {
  set.has(item) ? set.delete(item) : set.add(item);
  save(set, key);
}

function save(set, key) {
  try {
    localStorage.setItem(key, JSON.stringify([...set]));
  } catch {
    // not saved: the fold still applies until the next reload
  }
}

export default class AgentGroups extends View {
  init(_props, cx) {
    this.folded = load("folded");
    this.openKids = load("openKids"); // agent addresses whose sub-agents show; folded by default
    this.foldedAgents = load("foldedAgents"); // caret: agent addresses with nothing shown under the row
    this.favorites = load("favorites"); // favKey values; those agents show in the "Favoriten" group on top
    this.hovered = null; // agent address under the pointer: its heart shows
    this.seenDone = load("seenDone"); // finished tickers already looked at: their check is gone
    this.groupOrder = load("groupOrder"); // group ids in dragged order
    this.pressed = null; // group id being dragged
    this.over = null; // group header under the pointer while dragging
    this.stats = {}; // machine ("" = this computer) -> { cpu, used, total }
    cx.timer.every(STATS_MS, (cx) => this.readStats(cx));
    this.readStats(cx);
  }

  // Only with 2+ machines: a single machine shows no machine header, so no stats are needed.
  readStats(cx) {
    const names = machineNames();
    if (names.length < 2 || this.reading) return;
    this.reading = true;
    cx.spawn(async (cx) => {
      try {
        const results = await Promise.all(names.map((m) =>
          exec("node", ["-e", STATS_SCRIPT], { on: m }).then((r) => parseStats(r.stdout), () => null)));
        this.stats = Object.fromEntries(names.map((m, i) => [m ?? "", results[i]]));
      } finally {
        this.reading = false;
      }
      cx.notify();
    });
  }

  machineHeader(t, m) {
    const key = `m:${m.machine ?? ""}`;
    const open = !this.folded.has(key);
    const st = this.stats[m.machine ?? ""];
    const top = topStatus(m.members);
    return h_flex()
      .id(key)
      .h(30)
      .pt(8)
      .px(8)
      .gap(6)
      .flex_none()
      .items_center()
      .text_size(12)
      .font_semibold()
      .text_color(t.foreground)
      .cursor_pointer()
      .on_click((_e, cx) => {
        toggle(this.folded, key, "folded");
        cx.notify();
      })
      .child(svg(`mods/workspace-chrome/chevron-${open ? "down" : "right"}.svg`).size(11).flex_none().text_color(t.dim))
      .child(div().flex_1().min_w(0).truncate().child(m.machine ?? LOCAL))
      .when(!open && top !== "idle", (el) => el.child(this.statusIcon(t, top)))
      .when(Boolean(st), (el) => el.child(div().flex_none().text_size(10.5).font_normal().text_color(t.muted)
        .child(`${st.cpu ?? "?"}% · ${formatRam(st.used, st.total)}`)));
  }

  // idle: theme foreground; the others take the theme's status color.
  color(t, status) {
    return status === "idle" ? t.foreground : t[status] ?? t.dim;
  }

  statusIcon(t, status) {
    const c = this.color(t, status);
    if (status === "working") return svg("mods/workspace-chrome/spinner.svg").size(12).flex_none().text_color(c).spin(900);
    if (status === "blocked") return div().size(14).flex_none().rounded(4).bg(c + "26").text_size(10.5).font_bold().text_color(c).flex().items_center().justify_center().child("!");
    if (status === "done") return div().size(8).mx(3).flex_none().rounded(4).bg(c);
    return div().size(8).mx(3).flex_none().rounded(4).border(1.5).border_color(t.dim);
  }

  // Sub-agent count + program icon; a click shows or hides them under the row.
  kidsChip(t, a, ks) {
    const open = this.openKids.has(a.address);
    const top = topStatus(ks);
    return h_flex()
      .id(`kc-${a.address}`)
      .h(18)
      .px(5)
      .gap(4)
      .flex_none()
      .items_center()
      .rounded(4)
      .border(1)
      .border_color(open ? t.accent : t.border)
      .text_size(11)
      .font_medium()
      .text_color(top === "idle" ? t.muted : this.color(t, top))
      .cursor_pointer()
      .hover((s) => s.bg(t.hover))
      .on_click((_e, cx) => {
        cx.stop_propagation();
        toggle(this.openKids, a.address, "openKids");
        cx.notify();
      })
      .child(String(ks.length));
  }

  // Folds everything under the agent row (ticker, steps, sub-agents); an empty slot keeps names aligned.
  caret(t, a, foldable) {
    if (!foldable) return div().w(10).flex_none();
    const open = !this.foldedAgents.has(a.address);
    return div()
      .id(`ca-${a.address}`)
      .w(10)
      .flex_none()
      .cursor_pointer()
      .on_click((_e, cx) => {
        cx.stop_propagation();
        toggle(this.foldedAgents, a.address, "foldedAgents");
        cx.notify();
      })
      .child(svg(`mods/workspace-chrome/chevron-${open ? "down" : "right"}.svg`).size(10).text_color(t.dim));
  }

  // Heart at the row's right end: shown on hover, stays filled for a favorite; its slot is kept so the row doesn't shift.
  heart(t, a, key) {
    const fav = this.favorites.has(key);
    return div()
      .id(`fv-${a.address}`)
      .w(13)
      .flex_none()
      .cursor_pointer()
      .when(!fav && this.hovered !== a.address, (el) => el.invisible())
      .on_click((_e, cx) => {
        cx.stop_propagation();
        toggle(this.favorites, key, "favorites");
        cx.notify();
      })
      .child(svg(`mods/agent-groups/heart${fav ? "-filled" : ""}.svg`).size(13).text_color(fav ? t.ansi1 ?? t.blocked : t.dim));
  }

  // One line: caret, status, name, branch, context tokens, sub-agent chip when it has some, heart.
  row(t, a, all, ks, foldable) {
    const c = this.color(t, a.status);
    const labels = all.get(a.address)?.labels;
    const info = sessionInfo(labels);
    // ticker progress leads the title ("45% - name"); at 100% a green check instead, until the session is focused once
    const tk = tickerOf(labels);
    const key = favKey(a, labels);
    const finished = tk?.total >= 100;
    if (finished && a.focused && !this.seenDone.has(seenId(key, labels.ticker))) {
      markSeen(this.seenDone, key, labels.ticker);
      save(this.seenDone, "seenDone");
    }
    const showCheck = finished && !this.seenDone.has(seenId(key, labels.ticker));
    const tokens = formatTokens(info.tokens);
    return v_flex()
      .id(`ag-${a.address}`)
      .py(4)
      .pr(8)
      .flex_none()
      .rounded(7)
      .cursor_pointer()
      .when(a.status !== "idle", (el) => el.bg(c + "14"))
      .when(a.focused, (el) => el.bg(t.selected))
      .hover((s) => s.bg(t.hover))
      .on_hover((hovered, cx) => {
        if (hovered) this.hovered = a.address;
        else if (this.hovered === a.address) this.hovered = null;
        cx.notify();
      })
      .on_click(() => run("pane.focus", { pane: a.pane }))
      .child(h_flex().h(20).gap(8).items_center()
        .child(this.caret(t, a, foldable))
        .child(h_flex().w(14).flex_none().justify_center().child(this.statusIcon(t, a.status)))
        // Branch has basis 0 via flex_1: it only gets the space the name leaves and is cut first.
        .child(h_flex().flex_1().min_w(0).gap(6).items_center()
          .when(showCheck, (el) => el.child(div().flex_none().font_bold().text_color(t.done).child("✓")))
          .child(div().min_w(0).truncate().text_color(c).when(a.status !== "idle", (el) => el.font_medium()).child(tk && tk.total < 100 ? `${tk.total}% - ${nameOf(a)}` : nameOf(a)))
          .when(Boolean(info.branch), (el) => el.child(div().flex_1().min_w(0).truncate().text_size(11).text_color(t.dim).child(info.branch))))
        .when(!this.multi && a.address.includes("/"), (el) => el.child(div().text_size(10).text_color(t.dim).child(a.address.split("/")[0])))
        .when(Boolean(tokens), (el) => el.child(info.tokens >= WARN_TOKENS
          ? div().flex_none().px(4).rounded(4).bg(t.blocked + "26").text_size(11).font_semibold().text_color(t.blocked).child(tokens)
          : div().flex_none().text_size(11).text_color(t.muted).child(tokens)))
        .when(ks.length > 0, (el) => el.child(this.kidsChip(t, a, ks)))
        .child(this.heart(t, a, key)));
  }

  // Claude's in-process sub-agents (hook labels) and terminals the agent started with `hc run` (parent).
  // A ticker label replaces the sub-agents (render shows it as one row).
  kidsOf(a, all) {
    const own = all.get(a.address);
    const claude = (tickerOf(own?.labels) ? [] : subagentsOf(own?.labels)).map((s) => ({ key: `sub-${a.address}-${s.id}`, name: s.type, status: "working" }));
    const started = [...all.values()]
      .filter((k) => k.parent === a.address && k.state === "live")
      .map((k) => ({ key: `kid-${k.address}`, name: k.name || k.template || k.program?.name || k.address, status: k.status === "error" ? "blocked" : k.status ?? "idle", click: () => run("terminal.peek", { terminal: k.address }) }));
    return [...claude, ...started];
  }

  // Ticker steps under the agent row, one row each with its own status.
  stepRows(t, a, tk) {
    return this.kids(t, tk.steps.map((s, i) => ({ key: `ts-${a.address}-${i}`, name: stepLabel(s), status: stepStatus(s) })));
  }

  // Rows under an agent: { key, name, status, click? }.
  kids(t, list) {
    return list.map((k, i) => {
      const c = this.color(t, k.status);
      return h_flex()
        .id(k.key)
        .h(24)
        .pl(26)
        .pr(8)
        .gap(6)
        .flex_none()
        .items_center()
        .rounded(6)
        .text_size(12)
        .when(Boolean(k.click), (el) => el.cursor_pointer().hover((s) => s.bg(t.hover)).on_click(k.click))
        .child(div().w(10).flex_none().text_color(t.dim).child(i === list.length - 1 ? "└" : "├"))
        .child(h_flex().w(14).flex_none().justify_center().child(this.statusIcon(t, k.status)))
        .child(div().flex_1().min_w(0).truncate().text_color(k.status === "idle" ? t.muted : c).child(k.name));
    });
  }

  // Group header: click folds it; drag it onto another header of the same list to reorder (ids null: fixed).
  header(t, g, ids) {
    const open = !this.folded.has(g.id);
    const top = topStatus(g.members);
    const dragging = ids !== null && this.pressed !== null && ids.includes(this.pressed);
    const target = dragging && this.over === g.id && this.pressed !== g.id;
    return h_flex()
      .relative()
      .id(`sp-${g.id}`)
      .when(dragging && this.pressed === g.id && this.over !== g.id, (el) => el.opacity(0.5))
      .when(target, (el) => el.child(div().absolute().left(0).right(0).h(2).bg(t.accent)
        .when(ids.indexOf(this.pressed) < ids.indexOf(g.id), (line) => line.bottom(0))
        .when(ids.indexOf(this.pressed) > ids.indexOf(g.id), (line) => line.top(0))))
      .when(ids !== null, (el) => el
        .on_mouse_down("left", () => {
          this.pressed = g.id;
          this.over = g.id;
        })
        .on_mouse_move((_e, cx) => {
          const over = this.pressed !== null && ids.includes(this.pressed) ? g.id : null;
          if (this.pressed !== null && this.over !== over) {
            this.over = over;
            cx.notify();
          }
        })
        .on_mouse_up("left", (_e, cx) => {
          const from = this.pressed;
          this.pressed = null;
          this.over = null;
          if (from !== null && from !== g.id && ids.includes(from)) {
            // ids of other lists (other machines) keep their place behind the shown ones
            const order = moveId([...ids, ...[...this.groupOrder].filter((id) => !ids.includes(id))], from, g.id);
            this.groupOrder = new Set(order);
            save(this.groupOrder, "groupOrder");
          }
          cx.notify();
        }))
      .h(28)
      .pt(6)
      .px(8)
      .gap(6)
      .flex_none()
      .items_center()
      .text_size(11.5)
      .font_semibold()
      .text_color(t.muted)
      .cursor_pointer()
      .hover((s) => s.text_color(t.foreground))
      .on_click((_e, cx) => {
        toggle(this.folded, g.id, "folded");
        cx.notify();
      })
      .child(svg(`mods/workspace-chrome/chevron-${open ? "down" : "right"}.svg`).size(11).flex_none().text_color(t.dim))
      .child(div().flex_1().min_w(0).truncate().child(g.label))
      .when(!open, (el) => el
        .child(div().text_color(t.dim).font_normal().child(String(g.members.length)))
        .when(top !== "idle", (el) => el.child(this.statusIcon(t, top))));
  }

  render() {
    const t = theme();
    const list = agents();
    // Read once: every host read copies the whole list into JS.
    const all = new Map(terminals().map((k) => [k.address, k]));
    const member = (a) => {
      const ks = this.kidsOf(a, all);
      const tk = tickerOf(all.get(a.address)?.labels);
      const row = this.row(t, a, all, ks, Boolean(tk) || ks.length > 0);
      if (this.foldedAgents.has(a.address)) return [row];
      return [row, ...(tk ? this.stepRows(t, a, tk) : []), ...(this.openKids.has(a.address) ? this.kids(t, ks) : [])];
    };
    // ids: the groups shown together, between which a header can be dragged; null = fixed (favorites)
    const spaceRows = (groups, ids = groups.map((g) => g.id)) =>
      groups.flatMap((g) => [this.header(t, g, ids), ...(this.folded.has(g.id) ? [] : g.members.flatMap(member))]);
    this.multi = machineNames().length >= 2;
    // Favorites leave their space group and show first, in one group of their own.
    const isFav = (a) => this.favorites.has(favKey(a, all.get(a.address)?.labels));
    const favs = list.filter(isFav);
    const favGroups = favs.length ? [{ id: "fav", label: "Favoriten", members: favs }] : [];
    const byMachine = groupByMachine(list.filter((a) => !isFav(a)));
    for (const m of byMachine) m.spaces = orderGroups(m.spaces, [...this.groupOrder]);
    // agent.next/prev follow the shown order: grouping by name can reorder agents().
    setAgentOrder([...favs, ...byMachine.flatMap((m) => m.spaces.flatMap((g) => g.members))].map((a) => a.address));
    const rows = [...spaceRows(favGroups, null), ...(this.multi
      ? byMachine.flatMap((m) => [this.machineHeader(t, m), ...(this.folded.has(`m:${m.machine ?? ""}`) ? [] : [v_flex().pl(10).gap(1).children(spaceRows(m.spaces))])])
      : spaceRows(byMachine.flatMap((m) => m.spaces)))];
    return v_flex()
      .size_full()
      .min_h(0)
      .bg(t.chrome)
      .border_t(1)
      .border_color(t.border)
      .text_size(13)
      .child(div().px(16).pt(14).pb(4).flex_none().text_size(11.5).font_medium().text_color(t.dim).child("Agents"))
      .when(list.length === 0, (el) => el.child(div().px(16).text_size(12).text_color(t.dim).child("No agent reports a status yet.")))
      .child(v_flex().id("ag-groups").flex_1().min_h(0).px(8).pb(8).gap(1).overflow_y_scrollbar()
        // a drag released outside any group header ends without a move
        .on_mouse_up("left", (_e, cx) => {
          if (this.pressed === null) return;
          this.pressed = null;
          this.over = null;
          cx.notify();
        })
        .children(rows));
  }
}
