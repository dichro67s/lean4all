/* Lean4All front end: a hash-routed single page app over data.json, in English and Korean. */
(() => {
  "use strict";
  let D = null;           // data.json
  let TH = {}, MI = {};   // theorems / missions by id

  // ---------- language ---------------------------------------------------------------------
  const I18N = window.L4A_I18N;
  let LANG = (() => {
    try {
      const q = new URLSearchParams(location.search).get("lang");
      if (q && I18N[q]) { localStorage.setItem("l4a-lang", q); return q; }
      const s = localStorage.getItem("l4a-lang");
      if (s && I18N[s]) return s;
    } catch {}
    return (navigator.language || "").toLowerCase().startsWith("ko") ? "ko" : "en";
  })();
  const t = (key, ...args) => {
    const v = I18N[LANG][key] ?? I18N.en[key] ?? key;
    return typeof v === "function" ? v(...args) : v;
  };
  // Content fields: use `<field>_ko` when Korean is selected and it exists.
  const loc = (obj, field) => (obj && LANG !== "en" && obj[`${field}_${LANG}`]) || obj?.[field] || "";

  const PAPER = {
    title: "Prove2Me: An Open Collaborative Platform for Scaling Math Formalization",
    authors: "Shuze Chen, Kunal Marwaha, Xiaoyang Lu, Henry Yuen, Tianyi Peng",
    url: "https://arxiv.org/abs/2608.28433", site: "https://prove2.me",
    bibtex: `@article{chen2026prove2me,
  title   = {Prove2Me: An Open Collaborative Platform for Scaling Math Formalization},
  author  = {Chen, Shuze and Marwaha, Kunal and Lu, Xiaoyang and Yuen, Henry and Peng, Tianyi},
  journal = {arXiv preprint arXiv:2608.28433},
  year    = {2026}
}`,
  };

  const app = document.getElementById("app");
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const enc = encodeURIComponent;

  // ---------- helpers ----------------------------------------------------------------------
  const STATUSES = ["proved", "disproved", "sketched", "blocked", "open", "invalid"];
  const stName = (s) => t(`st.${s}`);
  const chip = (s) => `<span class="chip st-${s}" title="${esc(t(`sth.${s}`))}">${esc(stName(s))}</span>`;
  const done = (s) => s === "proved" || s === "disproved";
  const ghUrl = (path = "") => `https://github.com/${D.repo}${path}`;
  const siteBase = () => location.origin + location.pathname.replace(/index\.html$/, "");
  const userLink = (u) => (u ? `<a href="#/contributors/${enc(u)}">@${esc(u)}</a>` : "—");
  const avatar = (u) => `<img class="avatar" alt="" loading="lazy" src="https://github.com/${enc(u)}.png?size=56" onerror="this.style.visibility='hidden'">`;
  const thmLink = (id) => `<a class="mono" href="#/theorems/${id}">${id}</a>`;
  const typeName = (ty) => t(`type.${ty}`);

  function ago(iso) {
    const d = new Date(iso);
    if (isNaN(d)) return "";
    const s = (Date.now() - d.getTime()) / 1000;
    if (s < 3600) return t("ago", Math.max(1, Math.round(s / 60)), "m");
    if (s < 86400) return t("ago", Math.round(s / 3600), "h");
    if (s < 86400 * 30) return t("ago", Math.round(s / 86400), "d");
    return d.toLocaleDateString(LANG);
  }

  // Markdown with $…$ / $$…$$ math via KaTeX.
  function md(text, inline = false) {
    if (!text) return "";
    const math = [];
    const hold = (tex, display) => { math.push([tex, display]); return `\u0000${math.length - 1}\u0000`; };
    const src = String(text)
      .replace(/\$\$([\s\S]+?)\$\$/g, (_, x) => hold(x, true))
      .replace(/\\\[([\s\S]+?)\\\]/g, (_, x) => hold(x, true))
      .replace(/(^|[^\\$])\$([^$\n]+?)\$/g, (_, pre, x) => pre + hold(x, false));
    const html = window.marked ? (inline ? marked.parseInline(src) : marked.parse(src)) : esc(src);
    return html.replace(/\u0000(\d+)\u0000/g, (_, i) => {
      const [tex, display] = math[+i];
      try { return katex.renderToString(tex, { displayMode: display, throwOnError: false }); }
      catch { return esc(tex); }
    });
  }

  // Small Lean 4 highlighter.
  const KW = new Set(("theorem lemma def abbrev axiom example instance structure class inductive where " +
    "fun λ by have show from exact intro intros obtain rcases rintro cases induction with match at " +
    "simp simp_all omega ring linarith nlinarith norm_num positivity decide apply refine use " +
    "constructor calc rw rwa unfold let in if then else do return open namespace end section " +
    "variable import sorry push_neg by_contra contradiction trivial aesop exact? field_simp gcongr " +
    "specialize subst ext funext congr symm exfalso left right noncomputable private").split(" "));
  function hl(code) {
    const re = /(--[^\n]*)|(\/-[\s\S]*?-\/)|("(?:[^"\\]|\\.)*")|([A-Za-z_À-ɏͰ-Ͽᴀ-ᶿ][A-Za-z0-9_.'!?À-ɏͰ-Ͽ₀-₉]*)|(\b\d+\b)|([∀∃¬∧∨→↔≤≥≠∣∑∏∈∉⊆⊂∪∩×⟨⟩↑ℕℤℚℝℂ√!^]|:=|=>|<;>)/g;
    let out = "", last = 0, m;
    while ((m = re.exec(code))) {
      out += esc(code.slice(last, m.index));
      const [tok, c1, c2, str, id, num] = m;
      if (c1 || c2) out += `<span class="hl-com">${esc(tok)}</span>`;
      else if (str) out += `<span class="hl-str">${esc(tok)}</span>`;
      else if (id) out += KW.has(id) ? `<span class="hl-kw">${esc(id)}</span>`
        : /^[A-Z]/.test(id) ? `<span class="hl-ty">${esc(id)}</span>` : esc(id);
      else if (num) out += `<span class="hl-num">${tok}</span>`;
      else out += `<span class="hl-op">${esc(tok)}</span>`;
      last = re.lastIndex;
    }
    return out + esc(code.slice(last));
  }
  const codeBlock = (code, lean = true) =>
    `<div class="code-wrap"><pre class="code${lean ? "" : " wrap-text"}"><code>${lean ? hl(code) : esc(code)}</code></pre>` +
    `<button class="copy" data-copy="${esc(code)}">${esc(t("copy"))}</button></div>`;

  function progressOf(m) {
    const ts = m.theorems.map((id) => TH[id]).filter(Boolean);
    const ms = m.milestones || [];
    return {
      total: ts.length,
      proved: ts.filter((x) => done(x.status)).length,
      sketched: ts.filter((x) => x.status === "sketched").length,
      ms: ms.length,
      msDone: ms.filter((x) => TH[x.theorem] && done(TH[x.theorem].status)).length,
    };
  }
  const bar = (pr) => {
    const n = Math.max(pr.total, 1);
    return `<div class="progress">` +
      `<i class="p-proved" style="width:${(100 * pr.proved) / n}%"></i>` +
      `<i class="p-sketched" style="width:${(100 * pr.sketched) / n}%"></i></div>`;
  };
  const tags = (list) => `<div class="tags">${(list || []).map((x) => `<span class="tag">${esc(x)}</span>`).join("")}</div>`;

  function missionCard(m) {
    const pr = progressOf(m);
    return `<a class="card mcard" href="#/missions/${m.id}">
      <div class="row"><span class="label">${esc(typeName(m.type))}</span><span class="spacer"></span>${m.completed ? chip(m.goal_status) : ""}</div>
      <h3>${esc(loc(m, "title"))}</h3>
      <p>${md(loc(m, "summary"), true)}</p>
      ${tags(m.tags)}
      ${bar(pr)}
      <div class="meta"><span>${esc(t("captainBy", m.captain))}</span><span>${t("theorems", pr.total)}</span>
        ${pr.ms ? `<span>${t("milestonesShort", pr.msDone, pr.ms)}</span>` : ""}
        <span>${t("contributors", m.contributors.length)}</span>
        ${m.reviewed ? `<span class="badge-reviewed">${t("reviewed")}</span>` : ""}</div>
    </a>`;
  }

  function activityItem(a) {
    const color = { solution: "var(--proved)", disproof: "var(--disproved)",
      proposed: "var(--open)", mission: "var(--accent)" }[a.kind] || "var(--muted)";
    let what;
    if (a.kind === "mission") {
      what = t("a.launched", `<a href="#/missions/${a.mission}">${esc(loc(MI[a.mission], "title") || a.mission)}</a>`);
    } else {
      const th = TH[a.theorem];
      const name = `${thmLink(a.theorem)} ${esc(loc(th, "title"))}`;
      what = a.kind === "proposed" ? t("a.proposed", name)
        : a.kind === "disproof" ? t("a.disproved", name)
        : th && th.status === "sketched" ? t("a.sketch", name) : t("a.proved", name);
      if (a.agent) what += ` <span class="muted small">· ${esc(t("a.with", a.agent))}</span>`;
    }
    return `<li><span class="when">${ago(a.date)}</span><span class="dot" style="background:${color}"></span><span>${userLink(a.user)} ${what}</span></li>`;
  }

  function creditBlock(full = false) {
    return `<div class="card pad credit">
      <h3>${t("credit.title")}</h3>
      <p>${t("credit.lead")}</p>
      <p class="paper"><a href="${PAPER.url}"><b>${esc(PAPER.title)}</b></a><br>
        <span>${esc(PAPER.authors)}</span><br><span class="muted small">arXiv:2608.28433, 2026</span></p>
      <p class="muted small">${t("credit.note")}</p>
      <div class="row"><a class="btn btn-sm" href="${PAPER.url}">${t("credit.links")} (arXiv)</a>
        <a class="btn btn-sm" href="${PAPER.site}">${t("credit.site")}: prove2.me</a></div>
      ${full ? `<h3 style="margin-top:18px">${t("credit.cite")}</h3>${codeBlock(PAPER.bibtex, false)}` : ""}
    </div>`;
  }

  // ---------- views ------------------------------------------------------------------------
  function viewHome() {
    const s = D.stats;
    const active = D.missions.filter((m) => !m.completed).sort((a, b) => b.updated.localeCompare(a.updated));
    const finished = D.missions.filter((m) => m.completed);
    return `
      <section class="hero">
        <div class="label">${t("home.kicker")}</div>
        <h1>${t("home.title")}</h1>
        <p class="lead">${t("home.lead")}</p>
        <div class="grid grid-cta">
          <a class="card cta" href="#/start"><div class="ico">⚡</div><h3>${t("home.cta1.t")}</h3><p>${t("home.cta1.d")}</p></a>
          <a class="card cta" href="#/propose"><div class="ico">📄</div><h3>${t("home.cta2.t")}</h3><p>${t("home.cta2.d")}</p></a>
          <a class="card cta" href="#/about"><div class="ico">⚙︎</div><h3>${t("home.cta3.t")}</h3><p>${t("home.cta3.d")}</p></a>
        </div>
      </section>
      <div class="stats">
        <div class="stat"><b>${s.missions}</b><span>${t("stat.missions")}</span></div>
        <div class="stat"><b>${s.theorems}</b><span>${t("stat.theorems")}</span></div>
        <div class="stat"><b>${s.proved + s.disproved}</b><span>${t("stat.closed")}</span></div>
        <div class="stat"><b>${s.sketched}</b><span>${t("stat.sketched")}</span></div>
        <div class="stat"><b>${s.open}</b><span>${t("stat.open")}</span></div>
        <div class="stat"><b>${s.contributors}</b><span>${t("stat.contributors")}</span></div>
      </div>
      <section class="section">
        <div class="section-head"><h2>${t("home.inProgress")}</h2><span class="spacer"></span><a href="#/missions">${t("home.browse")}</a></div>
        <div class="grid grid-3">${active.slice(0, 6).map(missionCard).join("") || `<div class="empty">${t("home.noOpen")}</div>`}</div>
      </section>
      ${finished.length ? `<section class="section"><div class="section-head"><h2>${t("home.completed")}</h2></div>
        <div class="grid grid-3">${finished.slice(0, 3).map(missionCard).join("")}</div></section>` : ""}
      <section class="section">
        <div class="section-head"><h2>${t("home.latest")}</h2><span class="spacer"></span><a href="#/activity">${t("home.allActivity")}</a></div>
        <div class="card pad"><ul class="feed">${homeFeed().map(activityItem).join("")}</ul></div>
      </section>
      <section class="section">${creditBlock()}</section>`;
  }

  function homeFeed() {
    const main = D.activity.filter((a) => a.kind !== "proposed");
    return (main.length >= 6 ? main : D.activity).slice(0, 8);
  }

  function viewMissions(q) {
    const tab = q.get("tab") || "open", term = (q.get("q") || "").toLowerCase();
    const tag = q.get("tag") || "", sort = q.get("sort") || "hot";
    const all = D.missions;
    const counts = { open: all.filter((m) => !m.completed).length, completed: all.filter((m) => m.completed).length, all: all.length };
    let list = all.filter((m) => tab === "all" || (tab === "open" ? !m.completed : m.completed));
    if (tag) list = list.filter((m) => (m.tags || []).includes(tag));
    if (term) list = list.filter((m) => [m.title, m.title_ko, m.summary, m.summary_ko, m.description, m.description_ko, m.type, ...(m.tags || [])]
      .join(" ").toLowerCase().includes(term));
    const key = {
      hot: (m) => m.updated, new: (m) => m.created,
      size: (m) => String(m.theorems.length).padStart(6, "0"),
      progress: (m) => { const p = progressOf(m); return String(Math.round(1000 * p.proved / Math.max(1, p.total))).padStart(6, "0"); },
    }[sort] || ((m) => m.updated);
    list.sort((a, b) => key(b).localeCompare(key(a)));
    const allTags = [...new Set(all.flatMap((m) => m.tags || []))].sort();
    const link = (o) => { const p = new URLSearchParams({ tab, q: term, tag, sort, ...o }); for (const [k, v] of [...p]) if (!v) p.delete(k); return `#/missions?${p}`; };
    return `
      <div class="crumbs"><a href="#/">${t("nav.home")}</a> / ${t("nav.missions")}</div>
      <h1>${t("ms.title")}</h1>
      <div class="tabs">
        ${["open", "completed", "all"].map((x) => `<a class="${x === tab ? "on" : ""}" href="${link({ tab: x })}">${t(`ms.tab.${x}`)} (${counts[x]})</a>`).join("")}
      </div>
      <div class="toolbar">
        <input type="search" id="mq" placeholder="${esc(t("ms.search"))}" value="${esc(term)}">
        <select id="msort">
          ${["hot", "new", "size", "progress"].map((v) => `<option value="${v}" ${v === sort ? "selected" : ""}>${t(`ms.sort.${v}`)}</option>`).join("")}
        </select>
      </div>
      <div class="tags" style="margin-bottom:18px">
        <a class="tag ${tag ? "" : "on"}" href="${link({ tag: "" })}">${t("ms.allFields")}</a>
        ${allTags.map((x) => `<a class="tag ${x === tag ? "on" : ""}" href="${link({ tag: x })}">${esc(x)}</a>`).join("")}
      </div>
      <div class="grid grid-3">${list.map(missionCard).join("") || `<div class="empty">${t("ms.none")}</div>`}</div>`;
  }

  // Layered DAG. node(id) -> {href, title, sub, color}; deps(id) -> child ids (drawn below).
  function graphSvg(ids, deps, node) {
    if (!ids.length) return "";
    const set = new Set(ids);
    const kids = (id) => (deps(id) || []).filter((d) => set.has(d) && d !== id);
    const level = {};
    const visit = (id, d, seen) => {
      if (seen.has(id) || d > 40) return;
      level[id] = Math.max(level[id] ?? 0, d);
      const next = new Set(seen).add(id);
      kids(id).forEach((c) => visit(c, d + 1, next));
    };
    const parents = new Set(ids.flatMap(kids));
    ids.filter((id) => !parents.has(id)).forEach((id) => visit(id, 0, new Set()));
    ids.forEach((id) => { if (level[id] === undefined) level[id] = 0; });
    const rows = [];
    ids.forEach((id) => (rows[level[id]] ||= []).push(id));
    const W = 190, H = 54, GX = 26, GY = 56;
    const width = Math.max(...rows.map((r) => (r || []).length)) * (W + GX) - GX + 16;
    const height = rows.length * (H + GY) - GY + 16;
    const pos = {};
    rows.forEach((r, y) => {
      r = r || [];
      const off = (width - (r.length * (W + GX) - GX)) / 2;
      r.forEach((id, x) => (pos[id] = { x: off + x * (W + GX), y: 8 + y * (H + GY) }));
    });
    let edges = "", nodes = "";
    ids.forEach((id) => kids(id).forEach((c) => {
      const a = pos[id], b = pos[c];
      const x1 = a.x + W / 2, y1 = a.y + H, x2 = b.x + W / 2, y2 = b.y, my = (y1 + y2) / 2;
      edges += `<path class="edge" d="M${x1},${y1} C${x1},${my} ${x2},${my} ${x2},${y2}"/>`;
    }));
    ids.forEach((id) => {
      const n = node(id), p = pos[id];
      const title = n.title.length > 24 ? n.title.slice(0, 23) + "…" : n.title;
      const inner = `<title>${esc(n.tip || n.title)}</title>
        <rect x="${p.x}" y="${p.y}" width="${W}" height="${H}" rx="10" fill="var(--${n.color}-bg)" stroke="var(--${n.color})" ${n.dashed ? 'stroke-dasharray="5 4"' : ""}/>
        <text x="${p.x + 12}" y="${p.y + 22}" fill="var(--text)">${esc(title)}</text>
        <text class="sub" x="${p.x + 12}" y="${p.y + 40}">${esc(n.sub)}</text>`;
      nodes += n.href ? `<a href="${n.href}" class="node">${inner}</a>` : `<g class="node">${inner}</g>`;
    });
    return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img">${edges}${nodes}</svg>`;
  }
  const stColor = (s) => ({ proved: "proved", disproved: "disproved", sketched: "sketched", blocked: "blocked", invalid: "blocked" }[s] || "open");

  function dagSvg(ids) {
    return graphSvg(ids, (id) => TH[id]?.proof?.deps, (id) => {
      const th = TH[id];
      return { href: `#/theorems/${id}`, title: loc(th, "title"), sub: `${id} · ${stName(th.status)}`,
        color: stColor(th.status), tip: `${id}: ${loc(th, "title")} (${stName(th.status)})` };
    });
  }

  function theoremTable(ids) {
    return `<div class="table-scroll"><table class="list"><thead><tr><th>${t("tbl.id")}</th><th>${t("tbl.thm")}</th><th>${t("tbl.status")}</th><th>${t("tbl.by")}</th></tr></thead><tbody>
      ${ids.map((id) => TH[id]).filter(Boolean).map((x) => `<tr><td>${thmLink(x.id)}</td><td><a href="#/theorems/${x.id}">${esc(loc(x, "title"))}</a></td>
        <td>${chip(x.status)}</td><td>${x.proof ? userLink(x.proof.author) : '<span class="muted">—</span>'}</td></tr>`).join("")}
      </tbody></table></div>`;
  }

  function viewMission(id) {
    const m = MI[id];
    if (!m) return notFound();
    const pr = progressOf(m), goal = TH[m.goal];
    const src = m.source ? (m.source.url ? `<a href="${esc(m.source.url)}">${esc(m.source.title || m.source.url)}</a>` : esc(m.source.title)) : "—";
    return `
      <div class="crumbs"><a href="#/missions">${t("nav.missions")}</a> / ${esc(m.id)}</div>
      <div class="detail-head">
        <div class="row"><span class="label">${esc(typeName(m.type))}</span>${m.reviewed ? `<span class="badge-reviewed">${t("reviewed")}</span>` : ""}</div>
        <h1>${esc(loc(m, "title"))}</h1>
        ${tags(m.tags)}
      </div>
      <div class="two-col">
        <div>
          <div class="card pad">
            <div class="row">${t("m.reached", pr.msDone, pr.ms)} <span class="muted">·</span> ${t("m.provedOf", pr.proved, pr.total)}
              <span class="spacer"></span>${goal ? `${t("m.goal")}: ${chip(goal.status)}` : ""}</div>
            <div style="margin-top:10px">${bar(pr)}</div>
          </div>
          ${m.blueprint ? `<div class="card pad bp-link row" style="margin-top:16px"><div><b>${t("m.bp.t")}</b><div class="small muted">${t("m.bp.d")}</div></div><span class="spacer"></span><a class="btn btn-primary btn-sm" href="#/blueprints/${m.blueprint}">${t("m.bp.b")}</a></div>` : ""}
          <div class="prose" style="margin-top:20px">${md(loc(m, "description") || loc(m, "summary"))}</div>
          <h2>${t("m.milestones")}</h2>
          <div class="card pad"><ol class="milestones">
            ${(m.milestones || []).map((x) => { const th = TH[x.theorem]; return `<li class="${th && done(th.status) ? "done" : ""}">
              <span class="num"></span>
              <div><b>${esc(loc(x, "title"))}</b>${x.theorem === m.goal ? ` <span class="label">· ${t("m.goalTag")}</span>` : ""}<div class="prose">${md(loc(x, "statement"), true)}</div>
                ${th ? `<div class="small muted">${thmLink(th.id)} · ${esc(loc(th, "title"))}</div>` : `<div class="small muted">${t("m.notFormal")}</div>`}</div>
              <div>${th ? chip(th.status) : ""}</div></li>`; }).join("") || `<li class="muted">${t("m.noMilestones")}</li>`}
          </ol></div>
          <h2>${t("m.graph")}</h2>
          <p class="muted small">${t("m.graphHelp")}</p>
          <div class="card graph">${dagSvg(m.theorems)}</div>
          <h2>${t("m.all")}</h2>
          <div class="card">${theoremTable(m.theorems)}</div>
        </div>
        <aside class="side card pad">
          <dl>
            <dt>${t("m.captain")}</dt><dd>${userLink(m.captain)}</dd>
            <dt>${t("m.goal")}</dt><dd>${goal ? thmLink(goal.id) : "—"}</dd>
            <dt>${t("m.source")}</dt><dd>${src}</dd>
            <dt>${t("m.count")}</dt><dd>${pr.total}</dd>
            <dt>${t("m.launched")}</dt><dd>${ago(m.created)}</dd>
            <dt>${t("m.last")}</dt><dd>${ago(m.updated)}</dd>
          </dl>
          <h3 style="margin-top:20px">${t("m.people")}</h3>
          <div class="grid" style="gap:8px">${m.contributors.map((u) => `<div class="user-cell">${avatar(u)}${userLink(u)}</div>`).join("") || `<span class="muted">${t("m.nobody")}</span>`}</div>
          <h3 style="margin-top:20px">${t("m.help")}</h3>
          <p class="small">${t("m.oneLine")}</p>
          ${codeBlock(t("agent.mission", siteBase(), m.id), false)}
          <p class="small"><a href="${ghUrl(`/blob/${D.branch}/missions/${m.id}.yaml`)}">${t("m.file")}</a></p>
        </aside>
      </div>`;
  }

  function viewTheorem(id) {
    const th = TH[id];
    if (!th) return notFound();
    const p = th.proof;
    const newFile = ghUrl(`/new/${D.branch}?filename=${enc(`solutions/${th.id}.lean`)}&value=${enc(th.template)}`);
    const depRow = (d) => TH[d] ? `<li>${thmLink(d)} ${esc(loc(TH[d], "title"))} ${chip(TH[d].status)}</li>` : `<li class="mono">${esc(d)}</li>`;
    const proofSection = p ? `
      <h2>${p.kind === "disproof" ? t("t.disproof") : th.status === "sketched" ? t("t.sketch") : t("t.proof")}</h2>
      <div class="row small muted" style="margin-bottom:10px">${avatar(p.author)} ${userLink(p.author)}${p.agent ? esc(t("t.with", p.agent)) : ""} · ${ago(p.date)}
        · ${t("t.axioms")}: ${(p.axioms || []).map((a) => `<code>${esc(a)}</code>`).join(" ") || t("t.none")}</div>
      <div class="prose card pad">${md(p.explanation)}</div>
      ${p.deps.length ? `<h3 style="margin-top:18px">${t("t.uses")}</h3><ul>${p.deps.map(depRow).join("")}</ul>
        ${th.status === "sketched" ? `<p class="callout small">${t("t.sketchNote")}</p>` : ""}` : ""}
      <div style="margin-top:14px">${codeBlock(p.code)}</div>
      <p class="small"><a href="${ghUrl(`/blob/${D.branch}/solutions/${th.id}.lean`)}">solutions/${th.id}.lean</a></p>`
      : `
      <h2>${t("t.prove")}</h2>
      <div class="card pad">
        <p>${t("t.oneLine")}</p>
        ${codeBlock(t("agent.theorem", siteBase(), th.id), false)}
        <p style="margin-top:16px">${t("t.diy")}</p>
        <ol class="steps">
          <li>${t("t.step1", ghUrl(), esc(D.repo))}</li>
          <li>${t("t.step2", th.id)}</li>
          <li>${t("t.step3", th.id)}</li>
          <li>${t("t.step4")}</li>
        </ol>
        <div class="row"><a class="btn btn-primary" href="${newFile}">${t("t.onGitHub")}</a><a class="btn" href="${siteBase()}api/theorems/${th.id}.json">${t("json")}</a></div>
      </div>
      <h3 style="margin-top:18px">${t("t.template")}</h3>${codeBlock(th.template)}`;
    return `
      <div class="crumbs"><a href="#/library">${t("crumb.library")}</a> / ${th.id}</div>
      <div class="detail-head">
        <div class="row"><span class="mono muted">${th.id}</span>${chip(th.status)}</div>
        <h1>${esc(loc(th, "title"))}</h1>
        ${tags(th.tags)}
      </div>
      <div class="two-col">
        <div>
          <div class="prose">${md(loc(th, "description"))}</div>
          <h2>${t("t.statement")}</h2>
          ${codeBlock(th.lean)}
          <p class="small muted">${t("t.importHint", th.id)}</p>
          ${informalBlock(th)}
          ${th.errors.length ? `<div class="err">${esc(th.errors.join("\n\n"))}</div>` : ""}
          ${proofSection}
          ${th.used_by.length ? `<h2>${t("t.usedBy")}</h2><ul>${th.used_by.map(depRow).join("")}</ul>` : ""}
        </div>
        <aside class="side card pad">
          <dl>
            <dt>${t("tbl.status")}</dt><dd>${chip(th.status)}</dd>
            <dt>${t("t.mission")}</dt><dd>${(th.missions || []).map((x) => `<a href="#/missions/${x}">${esc(loc(MI[x], "title") || x)}</a>`).join("<br>") || "—"}</dd>
            <dt>${t("m.source")}</dt><dd>${esc(th.source || "—")}</dd>
            <dt>${t("t.proposedBy")}</dt><dd>${userLink(th.proposer)}</dd>
            <dt>${t("t.proposed")}</dt><dd>${ago(th.created)}</dd>
            <dt>Lean</dt><dd class="mono small">${esc(D.toolchain.replace("leanprover/lean4:", ""))}, Mathlib ${esc(D.mathlib)}</dd>
          </dl>
          <p class="small muted" style="margin-top:16px">${esc(t(`sth.${th.status}`))}</p>
          <p class="small"><a href="${ghUrl(`/blob/${D.branch}/theorems/${th.id}.yaml`)}">${t("t.card")}</a></p>
          <p>${watchBtn(th.id)}</p>
        </aside>
      </div>`;
  }

  // ---------- sign in with GitHub ----------------------------------------------------------
  // The auth Worker (auth/worker.js) trades GitHub's code for a user token and hands it back in
  // the URL fragment. The token stays in this browser and is only sent to api.github.com.
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
    set(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  };
  let ME = store.get("l4a-auth", null);
  if (ME && ME.exp && ME.exp < Date.now()) { ME = null; store.set("l4a-auth", null); }
  let authNote = "";

  function signIn() {
    if (!D?.auth) return;
    const a = new Uint8Array(24); crypto.getRandomValues(a);
    const state = btoa(String.fromCharCode(...a)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    try { sessionStorage.setItem("l4a-auth-state", state); sessionStorage.setItem("l4a-auth-return", location.hash || "#/me"); } catch {}
    location.href = `${D.auth.replace(/\/$/, "")}/login?return=${enc(siteBase())}&state=${enc(state)}`;
  }
  function signOut() {
    if (ME && D?.auth) fetch(`${D.auth.replace(/\/$/, "")}/revoke`, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: ME.token }) }).catch(() => {});
    ME = null; store.set("l4a-auth", null); ghCache = {}; paintAuth();
    if (location.hash.startsWith("#/me")) route(); else location.hash = "#/me";
  }
  // Finish sign-in when the Worker sends us back to #/auth?token=…&state=….
  async function finishSignIn() {
    if (!location.hash.startsWith("#/auth?")) return;
    const p = new URLSearchParams(location.hash.slice("#/auth?".length));
    let want = null, ret = "#/me";
    try { want = sessionStorage.getItem("l4a-auth-state"); ret = sessionStorage.getItem("l4a-auth-return") || ret;
          sessionStorage.removeItem("l4a-auth-state"); sessionStorage.removeItem("l4a-auth-return"); } catch {}
    if (ret.startsWith("#/auth")) ret = "#/me";
    history.replaceState(null, "", location.pathname + location.search + ret);   // drop the token from the address bar
    if (!want || p.get("state") !== want) { authNote = t("auth.failed", "state mismatch"); return; }
    if (p.get("error") || !p.get("token")) { authNote = t("auth.failed", p.get("error") || "no token"); return; }
    const token = p.get("token"), exp = +p.get("expires_in");
    try {
      const r = await fetch("https://api.github.com/user", { headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" } });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const u = await r.json();
      ME = { token, login: u.login, avatar: u.avatar_url, exp: exp ? Date.now() + exp * 1000 - 60000 : null };
      store.set("l4a-auth", ME);
    } catch (e) { authNote = t("auth.failed", e.message); }
  }
  // GitHub API with the visitor's token when signed in (5,000 requests an hour instead of 60).
  let ghCache = {};
  async function gh(path, opts = {}) {
    const headers = { Accept: "application/vnd.github+json", ...(opts.body ? { "Content-Type": "application/json" } : {}) };
    if (ME) headers.Authorization = `Bearer ${ME.token}`;
    const r = await fetch(`https://api.github.com${path}`, { ...opts, headers });
    if (r.status === 401 && ME) { ME = null; store.set("l4a-auth", null); authNote = t("auth.expired"); paintAuth(); }
    const body = r.status === 204 ? null : await r.json().catch(() => null);
    if (!r.ok) throw new Error(body?.message || `HTTP ${r.status}`);
    return body;
  }
  const ghGet = (path) => (ghCache[path] ||= gh(path).catch((e) => { delete ghCache[path]; throw e; }));
  function paintAuth() {
    const slot = document.getElementById("auth-slot");
    if (!slot) return;
    if (!D?.auth) { slot.innerHTML = ""; return; }
    slot.innerHTML = ME
      ? `<a class="me-link" href="#/me" title="${esc(t("auth.me"))} (@${esc(ME.login)})"><img class="avatar" alt="@${esc(ME.login)}" src="${esc(ME.avatar)}&s=56"></a>`
      : `<button class="btn btn-sm" data-signin>${t("auth.signin")}</button>`;
  }

  // Watch list: theorem id -> status when last seen. Kept in this browser.
  const watched = () => store.get("l4a-watch", {});
  function toggleWatch(id) {
    const w = watched();
    if (w[id]) delete w[id]; else w[id] = TH[id]?.status || "open";
    store.set("l4a-watch", w);
  }
  const watchBtn = (id) => `<button class="btn btn-sm watch-btn${watched()[id] ? " on" : ""}" data-watch="${esc(id)}">${t(watched()[id] ? "w.watching" : "w.watch")}</button>`;

  function viewMe() {
    const w = watched();
    const wl = Object.keys(w).filter((id) => TH[id]).map((id) => {
      const now = TH[id].status, changed = now !== w[id];
      return `<li><span>${thmLink(id)} ${esc(loc(TH[id], "title"))}</span><span class="spacer"></span>
        ${changed ? `<span class="small changed">${esc(t("me.changed", stName(w[id]), stName(now)))}</span>
          <button class="btn btn-sm" data-seen="${esc(id)}">${t("me.seen")}</button>` : ""}${chip(now)}</li>`;
    }).join("");
    const watchCard = `<div class="card pad"><h2>${t("me.watch")}</h2>${wl ? `<ul class="me-list">${wl}</ul>` : `<p class="muted small">${t("me.watchNone")}</p>`}</div>`;
    const note = authNote ? `<p class="callout small">${esc(authNote)}</p>` : "";
    authNote = "";
    if (!ME) {
      return `<h1>${t("me.title")}</h1>${note}
        <div class="card pad callout-card"><h3>${t("me.signinT")}</h3><p class="muted">${t("me.signinD")}</p>
          ${D.auth ? `<button class="btn btn-primary" data-signin>${t("auth.signinLong")}</button>` : ""}</div>
        <div style="margin-top:18px">${watchCard}</div>`;
    }
    const me = ME.login, same = (u) => (u || "").toLowerCase() === me.toLowerCase();
    const ms = D.missions.filter((m) => same(m.captain));
    const proposed = D.theorems.filter((x) => same(x.proposer));
    const proofs = D.theorems.filter((x) => x.proof && same(x.proof.author));
    const thList = (xs) => xs.length ? `<ul class="me-list">${xs.map((x) => `<li><span>${thmLink(x.id)} ${esc(loc(x, "title"))}</span><span class="spacer"></span>${chip(x.status)}</li>`).join("")}</ul>` : `<p class="muted small">${t("me.none")}</p>`;
    const known = D.users.some((u) => same(u.name));
    return `
      <div class="me-head">
        <img class="avatar avatar-lg" alt="" src="${esc(ME.avatar)}&s=128">
        <div><h1 style="margin:0">@${esc(me)}</h1><p class="muted" style="margin:4px 0 0">${t("me.lead")}</p></div>
        <span class="spacer"></span>
        ${known ? `<a class="btn btn-sm" href="#/contributors/${enc(me)}">${t("me.profile")}</a>` : ""}
        <button class="btn btn-sm" data-signout>${t("auth.signout")}</button>
      </div>${note}
      <div class="me-grid">
        <div class="card pad"><h2>${t("me.prs")}</h2><div id="me-prs" class="small muted">${t("loading")}</div></div>
        <div class="card pad"><h2>${t("me.requests")}</h2><div id="me-issues" class="small muted">${t("loading")}</div></div>
        ${watchCard}
        <div class="card pad"><h2>${t("me.missions")}</h2>${ms.length ? `<ul class="me-list">${ms.map((m) => `<li><a href="#/missions/${m.id}">${esc(loc(m, "title"))}</a><span class="spacer"></span>${m.completed ? chip(m.goal_status) : ""}</li>`).join("")}</ul>` : `<p class="muted small">${t("me.none")}</p>`}</div>
        <div class="card pad"><h2>${t("me.proofs")}</h2>${thList(proofs)}</div>
        <div class="card pad"><h2>${t("me.thms")}</h2>${thList(proposed)}</div>
      </div>`;
  }
  async function loadMe() {
    if (!ME) return;
    const list = async (elId, q, state) => {
      const el = document.getElementById(elId);
      try {
        const r = await ghGet(`/search/issues?q=${enc(`repo:${D.repo} author:${ME.login} ${q}`)}&sort=updated&per_page=20`);
        if (!document.getElementById(elId)) return;
        el.innerHTML = r.items.length ? `<ul class="feed">${r.items.map((i) => `<li><span class="when">${ago(i.updated_at)}</span>
          <span><a href="${esc(i.html_url)}" target="_blank" rel="noopener">#${i.number}</a> ${esc(i.title)}
          <span class="gh-state gh-${state(i)}">${t(`gh.${state(i)}`)}</span></span></li>`).join("")}</ul>` : t("me.none");
      } catch (e) { if (el) el.textContent = t("err.generic", e.message); }
    };
    list("me-prs", "is:pr", (i) => i.state === "open" ? "open" : i.pull_request?.merged_at ? "merged" : "closed");
    list("me-issues", "is:issue", (i) => i.state === "open" ? "issueOpen" : "issueClosed");
  }

  // ---------- arXiv blueprints -------------------------------------------------------------
  const parseArxiv = (text) => {
    const s = (text || "").trim();
    let m = s.match(/(\d{4}\.\d{4,5})(v\d+)?/);
    if (m) return m[1];
    m = s.match(/([a-z\-]+(?:\.[A-Z]{2})?\/\d{7})(v\d+)?/);
    return m ? m[1] : null;
  };
  const bpSlug = (aid) => "arxiv-" + aid.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  let issueCache = null;

  function viewArxiv(q) {
    const raw = q.get("id") || "";
    const aid = raw ? parseArxiv(raw) : null;
    const existing = aid && (D.blueprints || []).find((b) => b.id === bpSlug(aid));
    let result = "";
    if (raw && !aid) result = `<p class="err" style="font-family:var(--sans)">${t("ax.bad")}</p>`;
    else if (existing) result = `<div class="card pad callout-card"><b>${t("ax.exists")}</b>
        <p class="muted">${esc(loc(existing, "title"))}</p><a class="btn btn-primary" href="#/blueprints/${existing.id}">${t("ax.open")}</a></div>`;
    else if (aid) {
      const issue = ghUrl(`/issues/new?template=formalize-arxiv.yml&title=${enc("[arXiv] " + aid)}&arxiv=${enc(aid)}`);
      result = `<div class="card pad callout-card"><h3>${t("ax.request.t", aid)}</h3>
        <p class="muted">${t("ax.request.d")}</p>
        ${ME ? `<form id="axsubmit" data-aid="${esc(aid)}" class="ax-submit">
            <label class="small muted">${t("ax.notes")}<textarea name="notes" rows="2"></textarea></label>
            <div class="row"><button class="btn btn-primary" type="submit">${t("ax.submit")}</button>
              <a class="btn" href="https://arxiv.org/abs/${esc(aid)}" target="_blank" rel="noopener">arXiv:${esc(aid)}</a></div>
            <div id="axmsg" class="small" style="margin-top:8px"></div></form>`
          : `<div class="row"><a class="btn btn-primary" href="${issue}" target="_blank" rel="noopener">${t("ax.request.b")}</a>
          ${D.auth ? `<button class="btn" data-signin>${t("ax.orSignin")}</button>` : ""}
          <a class="btn" href="https://arxiv.org/abs/${esc(aid)}" target="_blank" rel="noopener">arXiv:${esc(aid)}</a></div>`}</div>`;
    }
    const steps = [1, 2, 3, 4, 5].map((n) => `<li><div class="step-num">${n}</div><div class="step-body"><h3>${t(`ax.s${n}.t`)}</h3><p>${t(`ax.s${n}.d`)}</p></div></li>`).join("");
    const bps = (D.blueprints || []).map((b) => `<a class="card mcard" href="#/blueprints/${b.id}">
        <div class="row"><span class="label">arXiv:${esc(b.arxiv)}</span><span class="spacer"></span>
          <span class="small muted">${b.status === "no-results" ? t("bp.noneShort") : t("bp.formalized", b.counts.formalized, b.counts.results)}</span></div>
        <h3>${esc(loc(b, "title"))}</h3><p>${esc(b.authors.slice(0, 4).join(", "))}${b.authors.length > 4 ? " et al." : ""}</p>
        ${bar({ total: b.counts.results, proved: b.counts.proved, sketched: b.counts.formalized - b.counts.proved })}</a>`).join("");
    return `
      <section class="start-hero">
        <div class="label">${t("ax.kicker")}</div>
        <h1>${t("ax.title")}</h1>
        <p class="lead">${t("ax.lead")}</p>
      </section>
      <form id="axform" class="ax-form card pad">
        <input type="text" id="axid" placeholder="${esc(t("ax.ph"))}" value="${esc(raw)}" autocomplete="off">
        <button class="btn btn-primary" type="submit">${t("ax.go")}</button>
      </form>
      <div style="margin-top:16px">${result}</div>
      <div class="start-grid">
        <div>
          <h2>${t("ax.how")}</h2>
          <ol class="stepper">${steps}</ol>
          <h2>${t("ax.done")}</h2>
          <div class="grid">${bps || `<div class="empty">—</div>`}</div>
        </div>
        <aside class="start-side">
          <div class="card pad"><h3>${t("ax.pending")}</h3><div id="ax-pending" class="small muted">${t("loading")}</div></div>
        </aside>
      </div>`;
  }

  async function loadPending() {
    const el = document.getElementById("ax-pending");
    if (!el) return;
    try {
      issueCache ||= await gh(`/repos/${D.repo}/issues?state=open&per_page=50`);
      const list = (Array.isArray(issueCache) ? issueCache : []).filter((i) => !i.pull_request && /^\[arxiv\]/i.test(i.title));
      el.innerHTML = list.length ? `<ul class="feed">${list.map((i) => `<li><span class="when">${ago(i.created_at)}</span>
        <span><a href="${esc(i.html_url)}" target="_blank" rel="noopener">#${i.number}</a> ${esc(i.title.replace(/^\[arxiv\]\s*/i, "arXiv:"))}
        <span class="muted">· @${esc(i.user.login)}</span></span></li>`).join("")}</ul>` : t("ax.none");
    } catch { el.textContent = "—"; }
  }

  // Issue bodies follow the issue forms in .github/ISSUE_TEMPLATE, so the server reads them the
  // same way whether they were filed here or on GitHub.
  const formBody = (fields) => fields.map(([h, v]) => `### ${h}\n\n${(v || "").trim() || "_No response_"}`).join("\n\n");

  async function submitArxiv(e) {
    e.preventDefault();
    const f = e.target, aid = f.dataset.aid, msg = document.getElementById("axmsg"), btn = f.querySelector("button");
    btn.disabled = true; msg.textContent = "";
    try {
      issueCache = null;
      issueCache = await gh(`/repos/${D.repo}/issues?state=open&per_page=50`);
      const dup = issueCache.find((i) => !i.pull_request && /^\[arxiv\]/i.test(i.title) && parseArxiv(i.title.slice(7)) === aid);
      if (dup) { msg.innerHTML = t("ax.dup", dup.number, esc(dup.html_url)); return; }
      const iss = await gh(`/repos/${D.repo}/issues`, { method: "POST", body: JSON.stringify({
        title: `[arXiv] ${aid}`, body: formBody([["arXiv URL or ID", aid], ["Notes (optional)", f.elements.notes.value]]) }) });
      msg.innerHTML = t("ax.sent", iss.number, esc(iss.html_url));
      f.querySelector("textarea").disabled = true;
      issueCache = null; ghCache = {}; loadPending();
    } catch (err) { msg.textContent = t("err.generic", err.message); btn.disabled = false; return; }
  }

  async function submitProposal(e) {
    e.preventDefault();
    const v = Object.fromEntries(new FormData(document.getElementById("pform")).entries());
    const msg = document.getElementById("pmsg"), btn = e.target.querySelector("button");
    const id = (v.id || "").trim();
    msg.textContent = "";
    if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) { msg.textContent = t("p.errId"); return; }
    if (MI[id]) { msg.textContent = t("p.errTaken"); return; }
    if (!(v.title || "").trim() || !(v.stmt || "").trim()) { msg.textContent = t("p.errReq"); return; }
    btn.disabled = true;
    try {
      const iss = await gh(`/repos/${D.repo}/issues`, { method: "POST", body: JSON.stringify({
        title: `[Mission] ${id}`,
        body: formBody([["Mission ID", id], ["Type", v.type], ["Title", v.title], ["Summary", v.summary], ["Tags", v.tags],
          ["Source title", v.stitle], ["Source URL", v.surl], ["Goal description", v.tdesc],
          ["Goal statement (Lean)", "```lean\n" + v.stmt.trim() + "\n```"]]) }) });
      msg.innerHTML = t("p.sent", iss.number, esc(iss.html_url));
      ghCache = {};
    } catch (err) { msg.textContent = t("err.generic", err.message); btn.disabled = false; }
  }

  const bpCache = {};
  async function viewBlueprint(id) {
    if (!bpCache[id]) {
      try { bpCache[id] = await (await fetch(`api/blueprints/${id}.json`, { cache: "no-cache" })).json(); } catch { return notFound(); }
    }
    const bp = bpCache[id], ko = LANG === "ko";
    const empty = bp.status === "no-results";
    const bykey = Object.fromEntries(bp.items.map((it) => [it.key, it]));
    const results = bp.items.filter((it) => !["remark", "example", "other", "definition"].includes(it.kind));
    const defsItems = bp.items.filter((it) => it.kind === "definition");
    const formal = results.filter((it) => it.theorem && TH[it.theorem]);
    const proved = formal.filter((it) => done(TH[it.theorem].status));
    const m = bp.mission && MI[bp.mission];

    // ---- main: join card
    const stat = (n, label, cls = "") => `<div class="bp-stat ${cls}"><b>${n}</b><span>${label}</span></div>`;
    const join = empty ? `<div class="card pad bp-hero-card"><p style="margin:0">${t("bp.none")}</p>
        <div class="row" style="margin-top:14px"><a class="btn" href="${esc(bp.url)}">arXiv:${esc(bp.arxiv)}</a>
        ${bp.issue ? `<a class="btn" href="${ghUrl(`/issues/${bp.issue}`)}">${t("bp.request")} #${bp.issue}</a>` : ""}</div></div>`
      : `<div class="card bp-hero-card">
        <div class="bp-hero-grid">
          <div class="bp-hero-left">
            <h2>${t("bp.join.t")}</h2>
            <p class="muted">${t("bp.join.d")}</p>
            ${codeBlock(t("agent.blueprint", siteBase(), bp.id), false)}
            <div class="row" style="margin-top:12px">
              ${m ? `<a class="btn btn-primary" href="#/missions/${m.id}">${t("bp.openMission")}</a>` : ""}
              <a class="btn" href="${esc(bp.url)}" target="_blank" rel="noopener">arXiv:${esc(bp.arxiv)}</a>
              <a class="btn" href="blueprints/${esc(bp.id)}/BLUEPRINT.md">BLUEPRINT.md</a>
            </div>
          </div>
          <div class="bp-hero-right">
            <div class="bp-stats">${stat(results.length, t("bp.stat.results"))}${stat(formal.length, t("bp.stat.formalized"), "sk")}${stat(proved.length, t("bp.stat.proved"), "ok")}</div>
            ${bar({ total: results.length, proved: proved.length, sketched: formal.length - proved.length })}
            <p class="small muted" style="margin:10px 0 0">${t("bp.hint")}</p>
          </div>
        </div>
      </div>`;

    // ---- main: results as cards
    const card = (it) => {
      const th = it.theorem && TH[it.theorem];
      const title = (ko && it.title_ko) || it.title_en || it.name || "";
      const stmt = (ko && it.statement_ko) || it.statement_en;
      const uses = (it.uses || []).filter((u) => bykey[u]).map((u) => `<a href="#bp-${esc(u)}" data-jump="bp-${esc(u)}">${esc(bykey[u].display)}</a>`).join(", ");
      return `<div class="card bp-item ${th ? "" : "bp-item-todo"}" id="bp-${esc(it.key)}">
        <div class="row"><b>${esc(it.display)}</b>${it.name ? `<span class="muted small">${esc(it.name)}</span>` : ""}${it.derived ? `<span class="tag">${t("bp.derived")}</span>` : ""}<span class="spacer"></span>
          ${th ? `${thmLink(th.id)} ${chip(th.status)}` : `<span class="tag">${t("bp.notFormal")}</span>`}</div>
        ${title ? `<div class="bp-item-title">${esc(title)}</div>` : ""}
        <div class="prose small">${stmt ? md(stmt) : `<code class="tex">${esc(it.tex.slice(0, 400))}</code>`}</div>
        ${uses ? `<div class="small muted">${t("bp.uses")}: ${uses}</div>` : ""}
        ${th ? `<details class="informal-cav"><summary>Lean</summary><pre class="code" style="margin-top:6px"><code>${hl(`theorem ${th.id} ${it.lean}`)}</code></pre></details>` : ""}
      </div>`;
    };
    const gIds = results.map((it) => it.key);
    const graph = results.length > 1 ? graphSvg(gIds, (k) => bykey[k].uses, (k) => {
      const it = bykey[k], th = it.theorem && TH[it.theorem];
      return { href: th ? `#/theorems/${th.id}` : null, title: (ko && it.title_ko) || it.title_en || it.name || it.display,
        sub: `${it.display}${th ? " · " + th.id + " · " + stName(th.status) : " · " + t("bp.notFormal")}`,
        color: th ? stColor(th.status) : "open", dashed: !th, tip: it.display };
    }) : "";

    // ---- side: details, collapsed
    const conv = (ko && bp.conventions_ko?.length ? bp.conventions_ko : bp.conventions) || [];
    const nDefs = (bp.definitions.match(/^\s*(?:noncomputable\s+)?(?:def|abbrev|structure|inductive)\s/gm) || []).length;
    const box = (title, count, body, open = false) => `<details class="bp-detail card" ${open ? "open" : ""}>
        <summary><span>${title}</span>${count !== null ? `<span class="tag">${count}</span>` : ""}</summary><div class="bp-detail-body">${body}</div></details>`;
    const details = [
      empty ? "" : box(t("bp.rules"), null, `<ol class="rules small">
        <li>${bp.module ? t("bp.r1", bp.module) : t("bp.r1none")}</li><li>${t("bp.r2")}</li><li>${t("bp.r3", bp.mission)}</li><li>${t("bp.r4")}</li></ol>`),
      conv.length ? box(t("bp.conv"), conv.length, `<ul class="conv small">${conv.map((c) => `<li>${md(c, true)}</li>`).join("")}</ul>`) : "",
      bp.notation?.length ? box(t("bp.notation"), bp.notation.length, `<table class="list small">${bp.notation.map((n) =>
        `<tr><td>${md(n.paper.includes("$") ? n.paper : `$${n.paper}$`, true)}</td><td><code>${esc(n.lean)}</code></td></tr>`).join("")}</table>`) : "",
      bp.definitions ? box(t("bp.defs"), nDefs, `<p class="small muted"><code>import Lean4All.Definitions.${esc(bp.module)}</code></p>${codeBlock(bp.definitions)}
        <p class="small"><a href="${ghUrl(`/blob/${D.branch}/definitions/${bp.module}.lean`)}">definitions/${esc(bp.module)}.lean</a></p>`) : "",
      defsItems.length ? box(t("bp.paperDefs"), defsItems.length, defsItems.map((it) =>
        `<p class="small"><b>${esc(it.display)}</b>${it.name ? " (" + esc(it.name) + ")" : ""}<br><code class="tex">${esc(it.tex.slice(0, 300))}</code></p>`).join("")) : "",
      box(t("bp.about"), null, `<dl class="small">
        <dt>${t("bp.paper")}</dt><dd><a href="${esc(bp.url)}">arXiv:${esc(bp.arxiv)}</a></dd>
        ${bp.issue ? `<dt>${t("bp.request")}</dt><dd><a href="${ghUrl(`/issues/${bp.issue}`)}">#${bp.issue}</a></dd>` : ""}
        <dt>${t("bp.generated")}</dt><dd>${esc(bp.model)}, ${new Date(bp.generated).toLocaleDateString(LANG)}</dd></dl>
        ${empty ? "" : `<p class="small muted">${t("bp.machine", bp.model, new Date(bp.generated).toLocaleDateString(LANG))}</p>`}
        <p class="small"><a href="api/blueprints/${esc(bp.id)}.json">JSON</a> · <a href="blueprints/${esc(bp.id)}/BLUEPRINT.md">BLUEPRINT.md</a></p>`),
    ].join("");

    return `
      <div class="crumbs"><a href="#/arxiv">${t("nav.arxiv")}</a> / arXiv:${esc(bp.arxiv)}</div>
      <div class="detail-head">
        <div class="row"><span class="label">${t("bp.kicker")}</span>${bp.reviewed ? "" : `<span class="tag">${t("bp.unreviewed")}</span>`}</div>
        <h1>${esc((ko && bp.title_ko) || bp.title)}</h1>
        <p class="muted" style="margin:0">${esc(bp.authors.join(", "))}</p>
      </div>
      ${bp.status === "derived" ? `<p class="callout" style="margin-top:0">${t("bp.derivedNote")}</p>` : ""}
      ${join}
      ${empty ? `<div class="bp-side bp-side-wide" style="margin-top:28px"><div class="label">${t("bp.details")}</div>${details}</div>` : `
      <div class="two-col" style="margin-top:28px">
        <div>
          ${results.length ? `<h2 style="margin-top:0">${t("bp.results")}</h2><div class="grid" style="gap:12px">${results.map(card).join("")}</div>` : ""}
          ${graph ? `<h2>${t("bp.graph")}</h2><p class="muted small">${t("bp.graphHelp")}</p><div class="card graph">${graph}</div>` : ""}
        </div>
        <aside class="bp-side">
          <div class="label" style="margin-bottom:8px">${t("bp.details")}</div>
          ${details}
        </aside>
      </div>`}`;
  }

  function auditChip(inf) {
    if (!inf || !inf.audit) return "";
    const v = inf.audit.verdict;
    const cls = v === "match" ? "st-proved" : v === "minor" ? "st-sketched" : "st-blocked";
    return `<span class="chip ${cls}" title="${esc(t("q.badge"))}">${t(`q.${v}`)}</span>`;
  }

  function informalBlock(th) {
    const inf = th.informal;
    if (!inf) return "";
    const ko = LANG === "ko";
    const text = (ko && inf.ko) || inf.en;
    const cav = ((ko && inf.caveats_ko) || inf.caveats_en || []).filter(Boolean);
    const note = ko ? inf.audit?.note_ko : inf.audit?.note_en;
    return `<div class="informal card">
      <div class="row"><span class="qwen-mark">Q</span><b>${t("q.title")}</b><span class="spacer"></span>${auditChip(inf)}</div>
      <div class="prose informal-text">${md(text)}</div>
      ${cav.length ? `<details class="informal-cav"><summary>${t("q.caveats")} (${cav.length})</summary><ul>${cav.map((c) => `<li>${md(c, true)}</li>`).join("")}</ul></details>` : ""}
      ${note && inf.audit.verdict !== "match" ? `<p class="callout small">${md(note, true)}</p>` : ""}
      ${inf.stale ? `<p class="small" style="color:var(--blocked)">${t("q.stale")}</p>` : ""}
      <p class="small muted informal-by">${esc(t("q.by", inf.model))}</p>
    </div>`;
  }

  function viewLibrary(q) {
    const term = (q.get("q") || "").toLowerCase(), st = q.get("status") || "";
    let list = D.theorems;
    if (st) list = list.filter((x) => x.status === st);
    if (term) list = list.filter((x) => [x.id, x.title, x.title_ko, x.description, x.description_ko, x.statement, x.informal?.en, x.informal?.ko, ...x.tags]
      .join(" ").toLowerCase().includes(term));
    const link = (o) => { const p = new URLSearchParams({ q: term, status: st, ...o }); for (const [k, v] of [...p]) if (!v) p.delete(k); return `#/library?${p}`; };
    return `
      <div class="crumbs"><a href="#/">${t("nav.home")}</a> / ${t("nav.library")}</div>
      <h1>${t("lib.title")}</h1>
      <p class="muted">${t("lib.lead")}</p>
      <div class="toolbar"><input type="search" id="fq" placeholder="${esc(t("lib.search"))}" value="${esc(term)}"></div>
      <div class="tags" style="margin-bottom:18px">
        <a class="tag ${st ? "" : "on"}" href="${link({ status: "" })}">${t("lib.all")} (${D.theorems.length})</a>
        ${STATUSES.filter((s) => D.stats[s]).map((s) => `<a class="tag ${s === st ? "on" : ""}" href="${link({ status: s })}">${esc(stName(s))} (${D.stats[s]})</a>`).join("")}
      </div>
      <div class="grid">${list.map((x) => `
        <a class="card mcard" href="#/theorems/${x.id}">
          <div class="row"><span class="mono muted small">${x.id}</span>${chip(x.status)}${x.informal?.audit && x.informal.audit.verdict !== "match" ? auditChip(x.informal) : ""}<span class="spacer"></span>
            <span class="small muted">${(x.missions || []).map((mm) => esc(loc(MI[mm], "title") || mm)).join(", ")}</span></div>
          <h3>${esc(loc(x, "title"))}</h3>
          ${x.informal ? `<div class="lib-reading">${md((LANG === "ko" && x.informal.ko) || x.informal.en, true)}</div>` : ""}
          <pre class="code" style="padding:8px 12px"><code>${hl(`theorem ${x.id} ${x.statement}`)}</code></pre>
        </a>`).join("") || `<div class="empty">${t("lib.none")}</div>`}</div>`;
  }

  function viewContributors() {
    return `
      <div class="crumbs"><a href="#/">${t("nav.home")}</a> / ${t("nav.contributors")}</div>
      <h1>${t("u.title")}</h1>
      <p class="muted">${t("u.lead")}</p>
      <div class="card table-scroll"><table class="list">
        <thead><tr><th>#</th><th></th><th class="num-col">${t("u.proved")}</th><th class="num-col">${t("u.disproved")}</th><th class="num-col">${t("u.sketches")}</th>
          <th class="num-col">${t("u.proposed")}</th><th class="num-col">${t("u.imported")}</th><th class="num-col">${t("u.missions")}</th><th class="num-col">${t("u.score")}</th></tr></thead>
        <tbody>${D.users.map((u, i) => `<tr><td>${i + 1}</td><td><div class="user-cell">${avatar(u.name)}${userLink(u.name)}</div></td>
          <td class="num-col">${u.proved}</td><td class="num-col">${u.disproved}</td><td class="num-col">${u.sketched}</td>
          <td class="num-col">${u.proposed}</td><td class="num-col">${u.imported}</td><td class="num-col">${u.captained}</td><td class="num-col"><b>${u.score}</b></td></tr>`).join("")}
        </tbody></table></div>
      <p class="small muted">${t("u.formula")}</p>`;
  }

  function viewContributor(name) {
    const u = D.users.find((x) => x.name === name);
    if (!u) return notFound();
    const proofs = D.theorems.filter((x) => x.proof?.author === name);
    const proposed = D.theorems.filter((x) => x.proposer === name);
    const missions = D.missions.filter((m) => m.captain === name);
    return `
      <div class="crumbs"><a href="#/contributors">${t("nav.contributors")}</a> / ${esc(name)}</div>
      <div class="row" style="margin-bottom:16px"><img class="avatar" style="width:64px;height:64px" alt="" src="https://github.com/${enc(name)}.png?size=128">
        <div><h1 style="margin:0">@${esc(name)}</h1><a class="small" href="https://github.com/${enc(name)}">github.com/${esc(name)}</a>
        ${u.agents.length ? `<div class="small muted">${t("u.agents")}: ${u.agents.map(esc).join(", ")}</div>` : ""}</div></div>
      <div class="stats">
        <div class="stat"><b>${u.score}</b><span>${t("u.score")}</span></div><div class="stat"><b>${u.proved}</b><span>${t("u.proved")}</span></div>
        <div class="stat"><b>${u.disproved}</b><span>${t("u.disproved")}</span></div><div class="stat"><b>${u.sketched}</b><span>${t("u.sketches")}</span></div>
        <div class="stat"><b>${u.proposed}</b><span>${t("u.proposed")}</span></div><div class="stat"><b>${u.imported}</b><span>${t("u.imported")}</span></div>
      </div>
      ${missions.length ? `<h2>${t("u.captained")}</h2><div class="grid grid-3">${missions.map(missionCard).join("")}</div>` : ""}
      ${proofs.length ? `<h2>${t("u.proofs")}</h2><div class="card">${theoremTable(proofs.map((x) => x.id))}</div>` : ""}
      ${proposed.length ? `<h2>${t("u.statements")}</h2><div class="card">${theoremTable(proposed.map((x) => x.id))}</div>` : ""}`;
  }

  function viewActivity(q) {
    const f = q.get("f") || "all";
    const groups = { all: () => true, proofs: (a) => a.kind === "solution" || a.kind === "disproof",
      statements: (a) => a.kind === "proposed", missions: (a) => a.kind === "mission" };
    const list = D.activity.filter(groups[f] || groups.all);
    const dayKey = (iso) => new Date(iso).toLocaleDateString(LANG, { year: "numeric", month: "long", day: "numeric" });
    const today = dayKey(new Date().toISOString()), yest = dayKey(new Date(Date.now() - 864e5).toISOString());
    let html = "", cur = null;
    for (const a of list) {
      const k = dayKey(a.date);
      if (k !== cur) {
        if (cur !== null) html += "</ul>";
        html += `<div class="day">${k === today ? t("a.today") : k === yest ? t("a.yesterday") : k}</div><ul class="feed">`;
        cur = k;
      }
      html += activityItem(a);
    }
    if (cur !== null) html += "</ul>";
    return `
      <div class="crumbs"><a href="#/">${t("nav.home")}</a> / ${t("nav.activity")}</div>
      <h1>${t("a.title")}</h1>
      <p class="muted">${t("a.lead")}</p>
      <div class="tags" style="margin-bottom:16px">${Object.keys(groups).map((k) =>
        `<a class="tag ${k === f ? "on" : ""}" href="#/activity${k === "all" ? "" : "?f=" + k}">${t(`a.f.${k}`)} (${D.activity.filter(groups[k]).length})</a>`).join("")}</div>
      <div class="card pad">${html || `<div class="empty">—</div>`}</div>`;
  }

  async function viewDoc(base, crumb, intro, outro = "") {
    const file = LANG === "en" ? `${base}.md` : `${base}.${LANG}.md`;
    let text = "";
    try {
      let r = await fetch(file, { cache: "no-cache" });
      if (!r.ok) r = await fetch(`${base}.md`, { cache: "no-cache" });
      text = await r.text();
    } catch { text = `Could not load ${file}`; }
    return `<div class="crumbs"><a href="#/">${t("nav.home")}</a> / ${esc(crumb)}</div>${intro}<div class="card doc-card prose">${md(text)}</div>${outro}`;
  }

  async function viewStart() {
    const startFile = LANG === "en" ? "start.md" : `start.${LANG}.md`;
    let agentDoc = "";
    try { agentDoc = await (await fetch(startFile, { cache: "no-cache" })).text(); } catch {}
    agentDoc = agentDoc.replace(/^>[^\n]*\n(>[^\n]*\n)*\n?/m, "");  // drop the "humans go here" notice
    const line = t("agent.general", siteBase());
    const step = (n, extra = "") => `<li><div class="step-num">${n}</div><div class="step-body">
      <h3>${t(`s.st${n}.t`)}</h3><p>${t(`s.st${n}.d`)}</p>${extra}</div></li>`;
    const what = `<p class="small"><a href="#" data-jump="install" data-block="start">${t("s.what.link")}</a></p>`;
    const cmd = (label, c) => `<p class="small muted">${t(label)}</p>${codeBlock(c, false)}`;
    const opt = (k, body) => `<details class="install-opt"><summary>${t(`in.${k}.t`)}</summary><div>${body}</div></details>`;
    const istep = (n, body) => `<li><div class="step-num">${n}</div><div class="step-body"><h3>${t(`in.s${n}.t`)}</h3><p>${t(`in.s${n}.d`)}</p>${body}</div></li>`;
    const install = `
          <section id="install" class="install">
            <h2>${t("in.t")}</h2>
            <p>${t("in.lead")}</p>
            <div class="card pad why-gh"><h3>${t("in.gh.t")}</h3><p class="small">${t("in.gh.d")}</p></div>
            <ol class="stepper">
              ${istep(1, "")}
              ${istep(2, opt("vs", t("in.vs.d")) +
                opt("cli", `<p class="small">${t("in.cli.d")}</p>` +
                  cmd("in.cli.mac", "curl -fsSL https://claude.ai/install.sh | bash") +
                  cmd("in.cli.win", "irm https://claude.ai/install.ps1 | iex") +
                  cmd("in.cli.codex", "npm install -g @openai/codex") +
                  cmd("in.cli.run", "mkdir lean4all-work\ncd lean4all-work\nclaude      # Codex: codex")) +
                opt("app", t("in.app.d")))}
              ${istep(3, `<details class="install-opt"><summary>${t("in.s4.t")}</summary><div><p class="small">${t("in.s4.d")}</p>` +
                cmd("in.os.mac", "brew install git gh") +
                cmd("in.os.win", "winget install --id Git.Git\nwinget install --id GitHub.cli") +
                cmd("in.os.linux", "sudo apt install git gh") +
                codeBlock("gh auth login", false) + `</div></details>`)}
            </ol>
          </section>`;
    const faq = [1, 2, 3, 4, 5, 6].map((n) => `<details class="faq"><summary>${t(`s.q${n}`)}</summary><p>${t(`s.a${n}`)}</p></details>`).join("");
    return `
      <section class="start-hero">
        <div class="label">${t("s.kicker")}</div>
        <h1>${t("s.title")}</h1>
        <p class="lead">${t("s.lead")}</p>
      </section>
      <div class="start-grid">
        <div>
          <div class="card pad need">
            <h2>${t("s.need")}</h2>
            <ul class="checklist">${[1, 2, 3, 4].map((n) => `<li>${t(`s.need${n}`)}</li>`).join("")}</ul>
          </div>
          ${install}
          <h2>${t("s.steps")}</h2>
          <ol class="stepper">
            ${step(1, `<div class="row"><a class="btn btn-sm" href="#/missions">${t("s.st1.a")}</a><a class="btn btn-sm" href="#/library?status=open">${t("s.st1.b")}</a></div>`)}
            ${step(2, `<div class="inline-line">${codeBlock(line, false)}</div>${what}`)}
            ${step(3)}
            ${step(4)}
            ${step(5)}
          </ol>
          <h2>${t("s.faq")}</h2>
          <div class="card faq-list">${faq}</div>
        </div>
        <aside class="start-side">
          <div class="card pad line-card">
            <div class="label">${t("s.line")}</div>
            ${codeBlock(line, false)}
            <p class="small muted">${t("s.lineNote")}</p>
            ${what}
            <p class="small muted">${t("s.byHand")}</p>
          </div>
          <div class="card pad">
            <h3>${t("s.mission.t")}</h3>
            <p class="small muted">${t("s.mission.d")}</p>
            <a class="btn btn-primary btn-sm" href="#/propose">${t("s.mission.b")}</a>
          </div>
        </aside>
      </div>
      <section class="agent-box">
        <div class="row"><h2>${t("s.agent.t")}</h2><span class="tag">${t("s.agent.skip")}</span></div>
        <p class="muted">${t("s.agent.d")}</p>
        <div class="row"><a class="btn btn-sm" href="${startFile}">${startFile}</a><a class="btn btn-sm" href="SKILL.md">SKILL.md</a>
          <a class="btn btn-sm" href="api/missions.json">missions.json</a><a class="btn btn-sm" href="api/theorems.json">theorems.json</a></div>
        <details class="agent-preview"><summary>${t("s.agent.preview")}</summary><div class="prose">${md(agentDoc)}</div></details>
      </section>`;
  }

  const viewAbout = () => viewDoc("CONTRIBUTING", t("footer.how"), `<h1>${t("about.title")}</h1>`,
    `<div style="margin-top:24px;max-width:820px">${creditBlock(true)}</div>`);

  function viewPropose() {
    const nextId = "T" + String(Math.max(0, ...D.theorems.map((x) => +x.id.slice(1))) + 1).padStart(4, "0");
    const types = ["Research Paper", "Textbook", "Open Problem", "Classic"];
    return `
      <div class="crumbs"><a href="#/">${t("nav.home")}</a> / ${t("nav.propose")}</div>
      <h1>${t("p.title")}</h1>
      <p class="muted">${t("p.lead")}</p>
      <div class="card pad"><form id="pform" class="form-grid">
        <label>${t("p.id")}<input type="text" name="id" placeholder="my-paper-main-theorem" required></label>
        <label>${t("p.type")}<select name="type">${types.map((x) => `<option value="${x}">${esc(typeName(x))}</option>`).join("")}</select></label>
        <label class="full">${t("p.titleF")}<input type="text" name="title"></label>
        <label class="full">${t("p.summary")}<input type="text" name="summary"></label>
        <label>${t("p.tags")}<input type="text" name="tags" placeholder="Number Theory, Combinatorics"></label>
        <label>${t("p.user")}<input type="text" name="captain"${ME ? ` value="${esc(ME.login)}" readonly` : ""}></label>
        <label>${t("p.stitle")}<input type="text" name="stitle" placeholder="Author, Title (Year)"></label>
        <label>${t("p.surl")}<input type="text" name="surl" placeholder="https://arxiv.org/abs/…"></label>
        <label>${t("p.tid")}<input type="text" name="tid" value="${nextId}"></label>
        <label>${t("p.tdesc")}<input type="text" name="tdesc" placeholder="For every $n$ …"></label>
        <label class="full">${t("p.stmt")}<textarea name="stmt" rows="2" placeholder="(n : ℕ) (hn : 0 < n) : ∃ p, Nat.Prime p ∧ n < p"></textarea></label>
      </form></div>
      ${ME ? `<form id="psubmit" class="card pad callout-card" style="margin-top:18px"><h3>${t("p.submitT")}</h3>
          <p class="muted small">${t("p.submitD")}</p><button class="btn btn-primary" type="submit">${t("p.submit")}</button>
          <div id="pmsg" class="small" style="margin-top:8px"></div></form>`
        : D.auth ? `<p class="callout small" style="margin-top:18px">${t("p.signin")} <button class="btn btn-sm" data-signin>${t("auth.signinLong")}</button></p>` : ""}
      <div class="grid grid-cta" style="margin-top:18px" id="pout"></div>`;
  }

  function proposeOutput() {
    const f = document.getElementById("pform");
    if (!f) return;
    const v = Object.fromEntries(new FormData(f).entries());
    const id = v.id || "my-mission", tid = v.tid || "T9999";
    const q = (s) => JSON.stringify(s || "");
    const tg = `[${(v.tags || "").split(",").map((s) => s.trim()).filter(Boolean).map(q).join(", ")}]`;
    const who = v.captain || "your-github-username";
    const mission = `id: ${id}\ntitle: ${q(v.title)}\ntype: ${v.type}\ntags: ${tg}\ncaptain: ${who}\nreviewed: false\nsummary: ${q(v.summary)}\ndescription: |\n  ${v.summary || "Describe the mission."}\nsource:\n  title: ${q(v.stitle)}\n  url: ${q(v.surl)}\ngoal: ${tid}\nmilestones:\n  - title: ${q(v.title || "Main theorem")}\n    statement: ${q(v.tdesc)}\n    theorem: ${tid}\n`;
    const card = `id: ${tid}\ntitle: ${q(v.title)}\ndescription: |\n  ${v.tdesc || "Natural-language statement."}\nstatement: ${q(v.stmt || "(n : ℕ) : n = n")}\ntags: ${tg}\nsource: ${q(v.stitle)}\nmission: ${id}\nproposer: ${who}\n`;
    const nf = (path, val) => ghUrl(`/new/${D.branch}?filename=${enc(path)}&value=${enc(val)}`);
    document.getElementById("pout").innerHTML = `
      <div class="card pad"><h3>missions/${esc(id)}.yaml</h3>${codeBlock(mission, false)}<p><a class="btn btn-sm" href="${nf(`missions/${id}.yaml`, mission)}">${t("p.create")}</a></p></div>
      <div class="card pad"><h3>theorems/${esc(tid)}.yaml</h3>${codeBlock(card, false)}<p><a class="btn btn-sm" href="${nf(`theorems/${tid}.yaml`, card)}">${t("p.create")}</a></p></div>`;
  }

  const notFound = () => `<div class="empty"><h2>${t("notFound")}</h2><p><a href="#/">${t("backHome")}</a></p></div>`;

  // ---------- chrome (nav, footer) ---------------------------------------------------------
  function paintChrome() {
    document.documentElement.lang = LANG;
    document.querySelectorAll("[data-i18n]").forEach((el) => { el.innerHTML = t(el.dataset.i18n); });
    document.getElementById("lang").textContent = t("lang.switch");
    document.getElementById("search-open").setAttribute("aria-label", t("search.open"));
    document.getElementById("lang").setAttribute("aria-label", t("lang.switch"));
    if (D) {
      document.getElementById("repo-link").href = ghUrl();
      document.getElementById("gen").textContent = t("footer.built",
        new Date(D.generated).toLocaleString(LANG), D.toolchain.replace("leanprover/", ""), D.mathlib);
    }
    document.getElementById("start-link").href = LANG === "en" ? "start.md" : `start.${LANG}.md`;
    paintAuth();
  }

  // ---------- router -----------------------------------------------------------------------
  const ALIASES = { formalpedia: "library", users: "contributors", momentum: "activity" };

  async function route() {
    const hash = location.hash.replace(/^#\/?/, "");
    const [path, qs] = hash.split("?");
    const parts = path.split("/").filter(Boolean).map(decodeURIComponent);
    if (ALIASES[parts[0]]) parts[0] = ALIASES[parts[0]];
    const q = new URLSearchParams(qs || "");
    document.querySelectorAll("[data-nav]").forEach((a) => a.classList.toggle("active", a.dataset.nav === (parts[0] || "")));
    document.getElementById("nav").classList.remove("open");
    let html, title = "";
    switch (parts[0] || "") {
      case "": html = viewHome(); break;
      case "missions": html = parts[1] ? viewMission(parts[1]) : viewMissions(q); title = parts[1] ? loc(MI[parts[1]], "title") : t("nav.missions"); break;
      case "theorems": html = viewTheorem(parts[1]); title = TH[parts[1]] ? `${parts[1]}: ${loc(TH[parts[1]], "title")}` : ""; break;
      case "library": html = viewLibrary(q); title = t("nav.library"); break;
      case "contributors": html = parts[1] ? viewContributor(parts[1]) : viewContributors(); title = parts[1] ? "@" + parts[1] : t("nav.contributors"); break;
      case "activity": html = viewActivity(q); title = t("nav.activity"); break;
      case "start": html = await viewStart(); title = t("nav.start"); break;
      case "about": html = await viewAbout(); title = t("footer.how"); break;
      case "propose": html = viewPropose(); title = t("nav.propose"); break;
      case "arxiv": html = viewArxiv(q); title = t("nav.arxiv"); break;
      case "blueprints": html = await viewBlueprint(parts[1]); title = t("bp.kicker"); break;
      case "me": html = viewMe(); title = t("me.title"); break;
      default: html = notFound();
    }
    document.title = title ? `${title} · Lean4All` : "Lean4All";
    app.innerHTML = html;
    const y = history.state && typeof history.state.y === "number" ? history.state.y : null;
    if (y !== null) window.scrollTo(0, y);
    else if (!qs) window.scrollTo(0, 0);
    wire(parts[0]);
  }

  function wire(page) {
    const debounce = (fn) => { let h; return (e) => { clearTimeout(h); h = setTimeout(() => fn(e), 250); }; };
    const setQ = (k, v) => {
      const [path, qs] = location.hash.split("?");
      const p = new URLSearchParams(qs || "");
      v ? p.set(k, v) : p.delete(k);
      history.replaceState(null, "", `${path}${[...p].length ? "?" + p : ""}`);
      const el = document.activeElement, pos = el?.selectionStart;
      route().then(() => { const again = el?.id && document.getElementById(el.id); if (again) { again.focus(); if (pos != null) again.setSelectionRange(pos, pos); } });
    };
    for (const id of ["mq", "fq"]) {
      const el = document.getElementById(id);
      if (el) el.addEventListener("input", debounce((e) => setQ("q", e.target.value)));
    }
    const ms = document.getElementById("msort");
    if (ms) ms.addEventListener("change", (e) => setQ("sort", e.target.value));
    if (page === "arxiv") {
      document.getElementById("axform").addEventListener("submit", (e) => {
        e.preventDefault();
        const v = document.getElementById("axid").value.trim();
        location.hash = `#/arxiv${v ? "?id=" + enc(v) : ""}`;
      });
      loadPending();
      document.getElementById("axsubmit")?.addEventListener("submit", submitArxiv);
    }
    if (page === "me") loadMe();
    if (page === "propose") {
      document.getElementById("pform").addEventListener("input", proposeOutput); proposeOutput();
      document.getElementById("psubmit")?.addEventListener("submit", submitProposal);
    }
  }

  // ---------- search (/ or Ctrl+K) -------------------------------------------------------
  const sEl = document.getElementById("search"), sQ = document.getElementById("search-q");
  const sRes = document.getElementById("search-results");
  let sItems = [], sSel = 0;
  function searchIndex() {
    const ms = D.missions.map((m) => ({ kind: "mission", href: `#/missions/${m.id}`, id: m.id, title: loc(m, "title"), status: m.completed ? m.goal_status : null,
      text: [m.id, m.title, m.title_ko, m.summary, m.summary_ko, ...(m.tags || [])].join(" ").toLowerCase() }));
    const ts = D.theorems.map((x) => ({ kind: "theorem", href: `#/theorems/${x.id}`, id: x.id, title: loc(x, "title"), status: x.status,
      text: [x.id, x.title, x.title_ko, x.description, x.description_ko, x.statement, x.informal?.en, x.informal?.ko, ...x.tags].join(" ").toLowerCase() }));
    return [...ms, ...ts];
  }
  function renderSearch() {
    const words = sQ.value.toLowerCase().split(/\s+/).filter(Boolean);
    const all = searchIndex();
    sItems = (words.length ? all.filter((it) => words.every((w) => it.text.includes(w))) : all.filter((it) => it.kind === "mission")).slice(0, 12);
    sSel = Math.min(sSel, Math.max(0, sItems.length - 1));
    sRes.innerHTML = sItems.map((it, i) => `<li role="option" aria-selected="${i === sSel}" class="${i === sSel ? "on" : ""}" data-i="${i}">
      <span class="label">${t(`search.${it.kind}`)}</span><span class="mono muted small">${esc(it.kind === "theorem" ? it.id : "")}</span>
      <span class="s-title">${esc(it.title)}</span>${it.status ? chip(it.status) : ""}</li>`).join("") || `<li class="muted">${t("search.none")}</li>`;
  }
  function openSearch() {
    if (!D) return;
    sQ.placeholder = t("search.ph");
    document.getElementById("search-hint").textContent = t("search.hint");
    sEl.hidden = false; sQ.value = ""; sSel = 0; renderSearch(); sQ.focus();
  }
  const closeSearch = () => { sEl.hidden = true; };
  const goSearch = (i) => { const it = sItems[i]; if (it) { closeSearch(); location.hash = it.href; } };
  document.getElementById("search-open").addEventListener("click", openSearch);
  sQ.addEventListener("input", () => { sSel = 0; renderSearch(); });
  sQ.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") { sSel = Math.min(sSel + 1, sItems.length - 1); renderSearch(); e.preventDefault(); }
    else if (e.key === "ArrowUp") { sSel = Math.max(sSel - 1, 0); renderSearch(); e.preventDefault(); }
    else if (e.key === "Enter") { goSearch(sSel); e.preventDefault(); }
    else if (e.key === "Escape") closeSearch();
  });
  sRes.addEventListener("click", (e) => { const li = e.target.closest("[data-i]"); if (li) goSearch(+li.dataset.i); });
  sEl.addEventListener("click", (e) => { if (e.target === sEl) closeSearch(); });
  document.addEventListener("keydown", (e) => {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || "");
    if ((e.key === "/" && !typing) || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k")) { e.preventDefault(); openSearch(); }
    else if (e.key === "Escape" && !sEl.hidden) closeSearch();
  });

  // Remember the scroll position in the current history entry, so Back returns to it.
  let scrollTimer;
  window.addEventListener("scroll", () => {
    clearTimeout(scrollTimer);
    scrollTimer = setTimeout(() => { try { history.replaceState({ ...(history.state || {}), y: window.scrollY }, ""); } catch {} }, 250);
  }, { passive: true });

  document.addEventListener("click", (e) => {
    if (e.target.closest("[data-signin]")) { e.preventDefault(); signIn(); return; }
    if (e.target.closest("[data-signout]")) { e.preventDefault(); signOut(); return; }
    const wb = e.target.closest("[data-watch]");
    if (wb) { toggleWatch(wb.dataset.watch); wb.outerHTML = watchBtn(wb.dataset.watch); return; }
    const sb = e.target.closest("[data-seen]");
    if (sb) { const w = watched(); w[sb.dataset.seen] = TH[sb.dataset.seen]?.status; store.set("l4a-watch", w); route(); return; }
    const j = e.target.closest("[data-jump]");
    if (j) {
      e.preventDefault();
      const el = document.getElementById(j.dataset.jump);
      if (el) { el.scrollIntoView({ behavior: "smooth", block: j.dataset.block || "center" }); el.classList.add("flash"); setTimeout(() => el.classList.remove("flash"), 1200); }
      return;
    }
    const b = e.target.closest("[data-copy]");
    if (!b) return;
    navigator.clipboard?.writeText(b.dataset.copy).then(() => { b.textContent = t("copied"); setTimeout(() => (b.textContent = t("copy")), 1200); });
  });
  document.getElementById("menu").addEventListener("click", () => document.getElementById("nav").classList.toggle("open"));
  document.getElementById("theme").addEventListener("click", () => {
    const root = document.documentElement;
    const dark = root.dataset.theme ? root.dataset.theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
    root.dataset.theme = dark ? "light" : "dark";
    try { localStorage.setItem("l4a-theme", root.dataset.theme); } catch {}
  });
  document.getElementById("lang").addEventListener("click", () => {
    LANG = LANG === "en" ? "ko" : "en";
    try { localStorage.setItem("l4a-lang", LANG); } catch {}
    const url = new URL(location.href);
    url.searchParams.delete("lang");
    history.replaceState(null, "", url);
    paintChrome();
    route();
  });

  paintChrome();
  app.innerHTML = `<p class="muted loading">${t("loading")}</p>`;
  fetch("data.json", { cache: "no-cache" }).then((r) => r.json()).then((data) => {
    D = data;
    D.theorems.forEach((x) => (TH[x.id] = x));
    D.missions.forEach((m) => (MI[m.id] = m));
    return finishSignIn();
  }).then(() => {
    paintChrome();
    window.addEventListener("hashchange", route);
    route();
  }).catch((e) => { app.innerHTML = `<div class="empty">${esc(t("loadFail", e.message))}</div>`; });
})();
