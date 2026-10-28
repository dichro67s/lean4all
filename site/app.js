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
        <div class="card pad"><ul class="feed">${D.activity.slice(0, 8).map(activityItem).join("")}</ul></div>
      </section>
      <section class="section">${creditBlock()}</section>`;
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

  function dagSvg(ids) {
    const set = new Set(ids);
    const deps = (id) => ((TH[id]?.proof?.deps) || []).filter((d) => set.has(d));
    const level = {};
    const visit = (id, d, seen) => {
      if (seen.has(id)) return;
      level[id] = Math.max(level[id] ?? 0, d);
      const next = new Set(seen).add(id);
      deps(id).forEach((c) => visit(c, d + 1, next));
    };
    const parents = new Set(ids.flatMap(deps));
    ids.filter((id) => !parents.has(id)).forEach((id) => visit(id, 0, new Set()));
    ids.forEach((id) => { if (level[id] === undefined) level[id] = 0; });
    const rows = [];
    ids.forEach((id) => (rows[level[id]] ||= []).push(id));
    const W = 190, H = 54, GX = 26, GY = 56;
    const width = Math.max(...rows.map((r) => r.length)) * (W + GX) - GX + 16;
    const height = rows.length * (H + GY) - GY + 16;
    const pos = {};
    rows.forEach((r, y) => {
      const off = (width - (r.length * (W + GX) - GX)) / 2;
      r.forEach((id, x) => (pos[id] = { x: off + x * (W + GX), y: 8 + y * (H + GY) }));
    });
    const col = (s) => ({ proved: "proved", disproved: "disproved", sketched: "sketched", blocked: "blocked", invalid: "blocked" }[s] || "open");
    let edges = "", nodes = "";
    ids.forEach((id) => deps(id).forEach((c) => {
      const a = pos[id], b = pos[c];
      const x1 = a.x + W / 2, y1 = a.y + H, x2 = b.x + W / 2, y2 = b.y, my = (y1 + y2) / 2;
      edges += `<path class="edge" d="M${x1},${y1} C${x1},${my} ${x2},${my} ${x2},${y2}"/>`;
    }));
    ids.forEach((id) => {
      const th = TH[id], p = pos[id], c = col(th.status);
      const full = loc(th, "title");
      const title = full.length > 24 ? full.slice(0, 23) + "…" : full;
      nodes += `<a href="#/theorems/${id}" class="node"><title>${esc(`${id}: ${full} (${stName(th.status)})`)}</title>
        <rect x="${p.x}" y="${p.y}" width="${W}" height="${H}" rx="10" fill="var(--${c}-bg)" stroke="var(--${c})"/>
        <text x="${p.x + 12}" y="${p.y + 22}" fill="var(--text)">${esc(title)}</text>
        <text class="sub" x="${p.x + 12}" y="${p.y + 40}">${id} · ${esc(stName(th.status))}</text></a>`;
    });
    return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(t("m.graph"))}">${edges}${nodes}</svg>`;
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
        </aside>
      </div>`;
  }

  function viewLibrary(q) {
    const term = (q.get("q") || "").toLowerCase(), st = q.get("status") || "";
    let list = D.theorems;
    if (st) list = list.filter((x) => x.status === st);
    if (term) list = list.filter((x) => [x.id, x.title, x.title_ko, x.description, x.description_ko, x.statement, ...x.tags]
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
          <div class="row"><span class="mono muted small">${x.id}</span>${chip(x.status)}<span class="spacer"></span>
            <span class="small muted">${(x.missions || []).map((mm) => esc(loc(MI[mm], "title") || mm)).join(", ")}</span></div>
          <h3>${esc(loc(x, "title"))}</h3>
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

  function viewActivity() {
    return `
      <div class="crumbs"><a href="#/">${t("nav.home")}</a> / ${t("nav.activity")}</div>
      <h1>${t("a.title")}</h1>
      <p class="muted">${t("a.lead")}</p>
      <div class="card pad"><ul class="feed">${D.activity.map(activityItem).join("")}</ul></div>`;
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
    const faq = [1, 2, 3, 4, 5].map((n) => `<details class="faq"><summary>${t(`s.q${n}`)}</summary><p>${t(`s.a${n}`)}</p></details>`).join("");
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
          <h2>${t("s.steps")}</h2>
          <ol class="stepper">
            ${step(1, `<div class="row"><a class="btn btn-sm" href="#/missions">${t("s.st1.a")}</a><a class="btn btn-sm" href="#/library?status=open">${t("s.st1.b")}</a></div>`)}
            ${step(2, `<div class="inline-line">${codeBlock(line, false)}</div>`)}
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
        <label>${t("p.user")}<input type="text" name="captain"></label>
        <label>${t("p.stitle")}<input type="text" name="stitle" placeholder="Author, Title (Year)"></label>
        <label>${t("p.surl")}<input type="text" name="surl" placeholder="https://arxiv.org/abs/…"></label>
        <label>${t("p.tid")}<input type="text" name="tid" value="${nextId}"></label>
        <label>${t("p.tdesc")}<input type="text" name="tdesc" placeholder="For every $n$ …"></label>
        <label class="full">${t("p.stmt")}<textarea name="stmt" rows="2" placeholder="(n : ℕ) (hn : 0 < n) : ∃ p, Nat.Prime p ∧ n < p"></textarea></label>
      </form></div>
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
    document.getElementById("lang").setAttribute("aria-label", t("lang.switch"));
    if (D) {
      document.getElementById("repo-link").href = ghUrl();
      document.getElementById("gen").textContent = t("footer.built",
        new Date(D.generated).toLocaleString(LANG), D.toolchain.replace("leanprover/", ""), D.mathlib);
    }
    document.getElementById("start-link").href = LANG === "en" ? "start.md" : `start.${LANG}.md`;
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
      case "activity": html = viewActivity(); title = t("nav.activity"); break;
      case "start": html = await viewStart(); title = t("nav.start"); break;
      case "about": html = await viewAbout(); title = t("footer.how"); break;
      case "propose": html = viewPropose(); title = t("nav.propose"); break;
      default: html = notFound();
    }
    document.title = title ? `${title} · Lean4All` : "Lean4All";
    app.innerHTML = html;
    if (!qs) window.scrollTo(0, 0);
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
    if (page === "propose") { document.getElementById("pform").addEventListener("input", proposeOutput); proposeOutput(); }
  }

  document.addEventListener("click", (e) => {
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
    paintChrome();
    window.addEventListener("hashchange", route);
    route();
  }).catch((e) => { app.innerHTML = `<div class="empty">${esc(t("loadFail", e.message))}</div>`; });
})();
