// Agents grouped by space; each row: status, session name (terminal title), context, folder · branch.
// Row color follows status: working, blocked ("needs you"), done; idle stays plain.

import { View, div, image, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { agents, terminals, run, theme, setAgentOrder } from "herdr";
import { nameOf, groupBySpace, topStatus, subagentsOf, formatTokens, sessionInfo } from "./groups.js";

// Same threshold as the statusline's !LIMIT: quality drops on a fuller context.
const WARN_TOKENS = 400_000;

function programIcon(p, color) {
  if (!p?.icon) return null;
  return p.tint ? svg(p.icon).size(15).flex_none().text_color(color) : image(p.icon).w(15).h(15).flex_none();
}

export default class AgentGroups extends View {
  init() {
    this.folded = new Set();
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

  // Line 1: status, name, context tokens, program icon. Line 2: folder · branch.
  row(t, a, all) {
    const c = this.color(t, a.status);
    const term = all.get(a.address);
    const info = sessionInfo(term?.labels);
    const dir = info.dir || (term?.cwd ?? "").split(/[\\/]/).filter(Boolean).at(-1) || "";
    const where = [dir, info.branch].filter(Boolean).join(" · ");
    const tokens = formatTokens(info.tokens);
    return v_flex()
      .id(`ag-${a.address}`)
      .py(4)
      .pl(18)
      .pr(8)
      .flex_none()
      .rounded(7)
      .cursor_pointer()
      .when(a.status !== "idle", (el) => el.bg(c + "14"))
      .when(a.focused, (el) => el.bg(t.selected))
      .hover((s) => s.bg(t.hover))
      .on_click(() => run("pane.focus", { pane: a.pane }))
      .child(h_flex().h(20).gap(8).items_center()
        .child(h_flex().w(14).flex_none().justify_center().child(this.statusIcon(t, a.status)))
        .child(div().flex_1().min_w(0).truncate().text_color(c).when(a.status !== "idle", (el) => el.font_medium()).child(nameOf(a)))
        .when(a.address.includes("/"), (el) => el.child(div().text_size(10).text_color(t.dim).child(a.address.split("/")[0])))
        .when(Boolean(tokens), (el) => el.child(info.tokens >= WARN_TOKENS
          ? div().flex_none().px(4).rounded(4).bg(t.blocked + "26").text_size(11).font_semibold().text_color(t.blocked).child(tokens)
          : div().flex_none().text_size(11).text_color(t.muted).child(tokens)))
        .child(programIcon(a.program, t.muted) ?? div()))
      .when(Boolean(where), (el) => el.child(div().pl(22).truncate().text_size(11).text_color(t.dim).child(where)));
  }

  // Claude's in-process sub-agents (hook labels) and terminals the agent started with `hc run` (parent).
  kids(t, a, all) {
    const own = all.get(a.address);
    const claude = subagentsOf(own?.labels).map((s) => ({ key: `sub-${a.address}-${s.id}`, name: s.type, status: "working", peek: null }));
    const started = [...all.values()]
      .filter((k) => k.parent === a.address && k.state === "live")
      .map((k) => ({ key: `kid-${k.address}`, name: k.name || k.template || k.program?.name || k.address, status: k.status === "error" ? "blocked" : k.status ?? "idle", peek: k.address }));
    const list = [...claude, ...started];
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
        .when(Boolean(k.peek), (el) => el.cursor_pointer().hover((s) => s.bg(t.hover)).on_click(() => run("terminal.peek", { terminal: k.peek })))
        .child(div().w(10).flex_none().text_color(t.dim).child(i === list.length - 1 ? "└" : "├"))
        .child(h_flex().w(14).flex_none().justify_center().child(this.statusIcon(t, k.status)))
        .child(div().flex_1().min_w(0).truncate().text_color(k.status === "idle" ? t.muted : c).child(k.name));
    });
  }

  header(t, g) {
    const open = !this.folded.has(g.id);
    const top = topStatus(g.members);
    return h_flex()
      .id(`sp-${g.id}`)
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
        open ? this.folded.add(g.id) : this.folded.delete(g.id);
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
    setAgentOrder(list.map((a) => a.address));
    const groups = groupBySpace(list);
    // Read once: every host read copies the whole list into JS.
    const all = new Map(terminals().map((k) => [k.address, k]));
    const rows = groups.flatMap((g) => [this.header(t, g), ...(this.folded.has(g.id) ? [] : g.members.flatMap((a) => [this.row(t, a, all),...this.kids(t, a, all)]))]);
    return v_flex()
      .size_full()
      .min_h(0)
      .bg(t.chrome)
      .border_t(1)
      .border_color(t.border)
      .text_size(13)
      .child(div().px(16).pt(14).pb(4).flex_none().text_size(11.5).font_medium().text_color(t.dim).child("Agents"))
      .when(list.length === 0, (el) => el.child(div().px(16).text_size(12).text_color(t.dim).child("No agent reports a status yet.")))
      .child(v_flex().id("ag-groups").flex_1().min_h(0).px(8).pb(8).gap(1).overflow_y_scrollbar().children(rows));
  }
}
