/* Lean4All front end: a hash-routed single page app over data.json. */
(() => {
  "use strict";
  let D = null;           // data.json
  let TH = {}, MI = {};   // theorems / missions by id

  const app = document.getElementById("app");
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const enc = encodeURIComponent;

  // ---------- helpers ----------------------------------------------------------------------
  const STATUS = {
    proved: "Proved", disproved: "Disproved", sketched: "Sketched",
    blocked: "Blocked", open: "Open", invalid: "Invalid",
  };
  const STATUS_HELP = {
    proved: "Machine-checked proof; all lemmas it uses are proved.",
    disproved: "Machine-checked proof of the negation.",
    sketched: "Proof checked, but it relies on lemmas that are still open.",
    blocked: "Proof relies on a lemma that was disproved.",
    open: "No accepted proof yet.",
    invalid: "The statement does not compile.",
  };
  const chip = (s) => `<span class="chip st-${s}" title="${esc(STATUS_HELP[s])}">${STATUS[s] || s}</span>`;
  const done = (s) => s === "proved" || s === "disproved";
  const ghUrl = (path = "") => `https://github.com/${D.repo}${path}`;
  const siteBase = () => location.href.split("#")[0].replace(/index\.html$/, "");
  const userLink = (u) => (u ? `<a href="#/users/${enc(u)}">@${esc(u)}</a>` : "—");
  const avatar = (u) => `<img class="avatar" alt="" loading="lazy" src="https://github.com/${enc(u)}.png?size=56" onerror="this.style.visibility='hidden'">`;
  const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;
  const thmLink = (id) => `<a class="mono" href="#/theorems/${id}">${id}</a>`;

  function ago(iso) {
    const t = new Date(iso);
    if (isNaN(t)) return "";
    const s = (Date.now() - t.getTime()) / 1000;
    if (s < 3600) return `${Math.max(1, Math.round(s / 60))}m ago`;
    if (s < 86400) return `${Math.round(s / 3600)}h ago`;
    if (s < 86400 * 30) return `${Math.round(s / 86400)}d ago`;
    return t.toISOString().slice(0, 10);
  }

  // Markdown with $…$ / $$…$$ math via KaTeX.
  function md(text, inline = false) {
    if (!text) return "";
    const math = [];
    const hold = (tex, display) => { math.push([tex, display]); return `\u0000${math.length - 1}\u0000`; };
    let src = String(text)
      .replace(/\$\$([\s\S]+?)\$\$/g, (_, t) => hold(t, true))
      .replace(/\\\[([\s\S]+?)\\\]/g, (_, t) => hold(t, true))
      .replace(/(^|[^\\$])\$([^$\n]+?)\$/g, (_, pre, t) => pre + hold(t, false));
    let html = window.marked ? (inline ? marked.parseInline(src) : marked.parse(src)) : esc(src);
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
      const [tok, c1, c2, str, id, num, op] = m;
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
    `<button class="copy" data-copy="${esc(code)}">Copy</button></div>`;

  function progressOf(m) {
    const ts = m.theorems.map((id) => TH[id]).filter(Boolean);
    const p = ts.filter((t) => done(t.status)).length;
    const s = ts.filter((t) => t.status === "sketched").length;
    const ms = m.milestones || [];
    const msDone = ms.filter((x) => TH[x.theorem] && done(TH[x.theorem].status)).length;
    return { total: ts.length, proved: p, sketched: s, ms: ms.length, msDone };
  }
  const bar = (pr) => {
    const t = Math.max(pr.total, 1);
    return `<div class="progress" title="${pr.proved} proved, ${pr.sketched} sketched of ${pr.total}">` +
      `<i class="p-proved" style="width:${(100 * pr.proved) / t}%"></i>` +
      `<i class="p-sketched" style="width:${(100 * pr.sketched) / t}%"></i></div>`;
  };

  function missionCard(m) {
    const pr = progressOf(m);
    return `<a class="card mcard" href="#/missions/${m.id}">
      <div class="row"><span class="label">${esc(m.type)}</span><span class="spacer"></span>${m.completed ? chip(m.goal_status) : ""}</div>
      <h3>${esc(m.title)}</h3>
      <p>${md(m.summary, true)}</p>
      <div class="tags">${(m.tags || []).map((t) => `<span class="tag">${esc(t)}</span>`).join("")}</div>
      ${bar(pr)}
      <div class="meta"><span>Captain @${esc(m.captain)}</span><span>${plural(pr.total, "theorem")}</span>
        <span>${pr.ms ? `${pr.msDone}/${pr.ms} milestones` : ""}</span>
        <span>${plural(m.contributors.length, "contributor")}</span>
        ${m.reviewed ? '<span class="badge-reviewed">✓ Reviewed</span>' : ""}</div>
    </a>`;
  }

  function activityItem(a) {
    const color = { proved: "var(--proved)", solution: "var(--proved)", disproof: "var(--disproved)",
      proposed: "var(--open)", mission: "var(--accent)" }[a.kind] || "var(--muted)";
    let what;
    if (a.kind === "mission") what = `launched mission <a href="#/missions/${a.mission}">${esc(MI[a.mission]?.title || a.mission)}</a>`;
    else {
      const t = TH[a.theorem];
      const name = `${thmLink(a.theorem)} ${esc(t?.title || "")}`;
      what = a.kind === "proposed" ? `proposed ${name}`
        : a.kind === "disproof" ? `disproved ${name}`
        : `submitted a proof of ${name}${t && t.status === "sketched" ? " (sketch)" : ""}`;
      if (a.agent) what += ` <span class="muted small">with ${esc(a.agent)}</span>`;
    }
    return `<li><span class="when">${ago(a.date)}</span><span class="dot" style="background:${color}"></span><span>${userLink(a.user)} ${what}</span></li>`;
  }

  // ---------- views ------------------------------------------------------------------------
  function viewDiscover() {
    const s = D.stats;
    const hot = [...D.missions].filter((m) => !m.completed).sort((a, b) => b.updated.localeCompare(a.updated));
    const rest = D.missions.filter((m) => m.completed);
    return `
      <section class="hero">
        <div class="label">Collaborative formalization in Lean 4</div>
        <h1>Find your next mission.</h1>
        <p class="lead">Each mission turns a theorem from a paper or textbook into small Lean statements.
          Prove them with your own AI agent. Lean checks every proof, and proofs build on each other's verified results.</p>
        <div class="grid grid-cta">
          <a class="card cta" href="#/start"><div class="ico">⚡</div><h3>Solve missions</h3><p>Point your agent at <code>start.md</code> and let it contribute proofs.</p></a>
          <a class="card cta" href="#/propose"><div class="ico">📄</div><h3>Formalize my paper</h3><p>Propose a mission: a goal, definitions and milestone statements.</p></a>
          <a class="card cta" href="#/about"><div class="ico">⚙︎</div><h3>How it works</h3><p>Theorem cards, proof sketches and verification on GitHub.</p></a>
        </div>
      </section>
      <div class="stats">
        <div class="stat"><b>${s.missions}</b><span>missions</span></div>
        <div class="stat"><b>${s.theorems}</b><span>theorems</span></div>
        <div class="stat"><b>${s.proved + s.disproved}</b><span>proved or disproved</span></div>
        <div class="stat"><b>${s.sketched}</b><span>sketched</span></div>
        <div class="stat"><b>${s.open}</b><span>open</span></div>
        <div class="stat"><b>${s.contributors}</b><span>contributors</span></div>
      </div>
      <section class="section">
        <div class="section-head"><h2>Open missions</h2><span class="spacer"></span><a href="#/missions">See all missions →</a></div>
        <div class="grid grid-3">${hot.slice(0, 6).map(missionCard).join("") || '<div class="empty">No open missions.</div>'}</div>
      </section>
      ${rest.length ? `<section class="section"><div class="section-head"><h2>Recently completed</h2></div>
        <div class="grid grid-3">${rest.slice(0, 3).map(missionCard).join("")}</div></section>` : ""}
      <section class="section">
        <div class="section-head"><h2>Momentum</h2><span class="spacer"></span><a href="#/momentum">All activity →</a></div>
        <div class="card pad"><ul class="feed">${D.activity.slice(0, 8).map(activityItem).join("")}</ul></div>
      </section>`;
  }

  function viewMissions(q) {
    const tab = q.get("tab") || "open", term = (q.get("q") || "").toLowerCase();
    const tag = q.get("tag") || "", sort = q.get("sort") || "hot";
    const all = D.missions;
    const counts = { open: all.filter((m) => !m.completed).length, completed: all.filter((m) => m.completed).length, all: all.length };
    let list = all.filter((m) => tab === "all" || (tab === "open" ? !m.completed : m.completed));
    if (tag) list = list.filter((m) => (m.tags || []).includes(tag));
    if (term) list = list.filter((m) => [m.title, m.summary, m.description, m.type, ...(m.tags || [])].join(" ").toLowerCase().includes(term));
    const key = {
      hot: (m) => m.updated, new: (m) => m.created,
      size: (m) => String(m.theorems.length).padStart(6, "0"),
      progress: (m) => { const p = progressOf(m); return String(Math.round(1000 * p.proved / Math.max(1, p.total))).padStart(6, "0"); },
    }[sort] || ((m) => m.updated);
    list.sort((a, b) => key(b).localeCompare(key(a)));
    const tags = [...new Set(all.flatMap((m) => m.tags || []))].sort();
    const link = (o) => { const p = new URLSearchParams({ tab, q: term, tag, sort, ...o }); for (const [k, v] of [...p]) if (!v) p.delete(k); return `#/missions?${p}`; };
    return `
      <div class="crumbs"><a href="#/">Discover</a> / Missions</div>
      <h1>All missions</h1>
      <div class="tabs">
        ${["open", "completed", "all"].map((t) => `<a class="${t === tab ? "on" : ""}" href="${link({ tab: t })}">${t[0].toUpperCase() + t.slice(1)} (${counts[t]})</a>`).join("")}
      </div>
      <div class="toolbar">
        <input type="search" id="mq" placeholder="Search missions…" value="${esc(term)}">
        <select id="msort">
          ${[["hot", "Hottest"], ["new", "Newest"], ["size", "Most theorems"], ["progress", "Most progress"]].map(([v, l]) => `<option value="${v}" ${v === sort ? "selected" : ""}>${l}</option>`).join("")}
        </select>
      </div>
      <div class="tags" style="margin-bottom:18px">
        <a class="tag ${tag ? "" : "on"}" href="${link({ tag: "" })}">All fields</a>
        ${tags.map((t) => `<a class="tag ${t === tag ? "on" : ""}" href="${link({ tag: t })}">${esc(t)}</a>`).join("")}
      </div>
      <div class="grid grid-3">${list.map(missionCard).join("") || '<div class="empty">No missions match.</div>'}</div>`;
  }

  function dagSvg(ids) {
    const set = new Set(ids);
    const deps = (id) => ((TH[id]?.proof?.deps) || []).filter((d) => set.has(d));
    const level = {};
    const visit = (id, d, seen) => {
      if (seen.has(id)) return;
      level[id] = Math.max(level[id] ?? 0, d);
      const s2 = new Set(seen).add(id);
      deps(id).forEach((c) => visit(c, d + 1, s2));
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
      const t = TH[id], p = pos[id], c = col(t.status);
      const title = t.title.length > 26 ? t.title.slice(0, 25) + "…" : t.title;
      nodes += `<a href="#/theorems/${id}" class="node"><title>${esc(id + ": " + t.title + " (" + STATUS[t.status] + ")")}</title>
        <rect x="${p.x}" y="${p.y}" width="${W}" height="${H}" rx="10" fill="var(--${c}-bg)" stroke="var(--${c})"/>
        <text x="${p.x + 12}" y="${p.y + 22}" fill="var(--text)">${esc(title)}</text>
        <text class="sub" x="${p.x + 12}" y="${p.y + 40}">${id} · ${STATUS[t.status]}</text></a>`;
    });
    return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="Dependency graph">${edges}${nodes}</svg>`;
  }

  function theoremTable(ids) {
    return `<div class="table-scroll"><table class="list"><thead><tr><th>ID</th><th>Theorem</th><th>Status</th><th>Proof by</th></tr></thead><tbody>
      ${ids.map((id) => TH[id]).filter(Boolean).map((t) => `<tr><td>${thmLink(t.id)}</td><td><a href="#/theorems/${t.id}">${esc(t.title)}</a></td>
        <td>${chip(t.status)}</td><td>${t.proof ? userLink(t.proof.author) : '<span class="muted">—</span>'}</td></tr>`).join("")}
      </tbody></table></div>`;
  }

  function viewMission(id) {
    const m = MI[id];
    if (!m) return notFound();
    const pr = progressOf(m), goal = TH[m.goal];
    const src = m.source ? (m.source.url ? `<a href="${esc(m.source.url)}">${esc(m.source.title || m.source.url)}</a>` : esc(m.source.title)) : "—";
    return `
      <div class="crumbs"><a href="#/missions">Missions</a> / ${esc(m.id)}</div>
      <div class="detail-head">
        <div class="row"><span class="label">${esc(m.type)}</span>${m.reviewed ? '<span class="badge-reviewed">✓ Reviewed</span>' : ""}</div>
        <h1>${esc(m.title)}</h1>
        <div class="tags">${(m.tags || []).map((t) => `<span class="tag">${esc(t)}</span>`).join("")}</div>
      </div>
      <div class="two-col">
        <div>
          <div class="card pad">
            <div class="row"><b>${pr.msDone} / ${pr.ms}</b> milestones reached <span class="muted">·</span> <b>${pr.proved} / ${pr.total}</b> mission theorems proved
              <span class="spacer"></span>${goal ? `Goal: ${chip(goal.status)}` : ""}</div>
            <div style="margin-top:10px">${bar(pr)}</div>
          </div>
          <div class="prose" style="margin-top:20px">${md(m.description || m.summary)}</div>
          <h2>Milestones</h2>
          <div class="card pad"><ol class="milestones">
            ${(m.milestones || []).map((x) => { const t = TH[x.theorem]; return `<li class="${t && done(t.status) ? "done" : ""}">
              <span class="num"></span>
              <div><b>${esc(x.title)}</b>${x.theorem === m.goal ? ' <span class="label">· goal</span>' : ""}<div class="prose">${md(x.statement || "", true)}</div>
                ${t ? `<div class="small muted">${thmLink(t.id)} · ${esc(t.title)}</div>` : '<div class="small muted">Not yet formalized</div>'}</div>
              <div>${t ? chip(t.status) : ""}</div></li>`; }).join("") || '<li class="muted">No milestones.</li>'}
          </ol></div>
          <h2>Proof graph</h2>
          <p class="muted small">Arrows point from a proof to the lemmas it imports. A sketched theorem resolves automatically once everything below it is proved.</p>
          <div class="card graph">${dagSvg(m.theorems)}</div>
          <h2>All mission theorems</h2>
          <div class="card">${theoremTable(m.theorems)}</div>
        </div>
        <aside class="side card pad">
          <dl>
            <dt>Captain</dt><dd>${userLink(m.captain)}</dd>
            <dt>Goal</dt><dd>${goal ? `${thmLink(goal.id)}` : "—"}</dd>
            <dt>Source</dt><dd>${src}</dd>
            <dt>Theorems</dt><dd>${pr.total}</dd>
            <dt>Launched</dt><dd>${ago(m.created)}</dd>
            <dt>Last activity</dt><dd>${ago(m.updated)}</dd>
          </dl>
          <h3 style="margin-top:20px">Contributors</h3>
          <div class="grid" style="gap:8px">${m.contributors.map((u) => `<div class="user-cell">${avatar(u)}${userLink(u)}</div>`).join("") || '<span class="muted">None yet</span>'}</div>
          <h3 style="margin-top:20px">Contribute</h3>
          <p class="small">Give your agent one instruction:</p>
          ${codeBlock(`Read ${siteBase()}start.md and work on mission ${m.id}.`, false)}
          <p class="small"><a href="${ghUrl(`/blob/${D.branch}/missions/${m.id}.yaml`)}">View mission file on GitHub</a></p>
        </aside>
      </div>`;
  }

  function viewTheorem(id) {
    const t = TH[id];
    if (!t) return notFound();
    const p = t.proof;
    const newFile = ghUrl(`/new/${D.branch}?filename=${enc(`solutions/${t.id}.lean`)}&value=${enc(t.template)}`);
    const depRow = (d) => TH[d] ? `<li>${thmLink(d)} ${esc(TH[d].title)} ${chip(TH[d].status)}</li>` : `<li class="mono">${esc(d)}</li>`;
    const proofSection = p ? `
      <h2>${p.kind === "disproof" ? "Disproof" : t.status === "sketched" ? "Proof sketch" : "Proof"}</h2>
      <div class="row small muted" style="margin-bottom:10px">${avatar(p.author)} ${userLink(p.author)}${p.agent ? ` with ${esc(p.agent)}` : ""} · ${ago(p.date)}
        · axioms: ${(p.axioms || []).map((a) => `<code>${esc(a)}</code>`).join(" ") || "none"}</div>
      <div class="prose card pad">${md(p.explanation)}</div>
      ${p.deps.length ? `<h3 style="margin-top:18px">Uses</h3><ul>${p.deps.map(depRow).join("")}</ul>
        ${t.status === "sketched" ? '<p class="callout small">This proof is checked, but some lemmas it imports are still open. Proving them completes this theorem automatically.</p>' : ""}` : ""}
      <div style="margin-top:14px">${codeBlock(p.code)}</div>
      <p class="small"><a href="${ghUrl(`/blob/${D.branch}/solutions/${t.id}.lean`)}">solutions/${t.id}.lean</a></p>`
      : `
      <h2>Prove this</h2>
      <div class="card pad">
        <p>Give your agent one instruction:</p>
        ${codeBlock(`Read ${siteBase()}start.md and prove theorem ${t.id} on Lean4All.`, false)}
        <p style="margin-top:16px">Or do it yourself:</p>
        <ol class="steps">
          <li>Fork and clone <a href="${ghUrl()}">${esc(D.repo)}</a>.</li>
          <li><code>python3 scripts/lean4all.py template ${t.id} &gt; solutions/${t.id}.lean</code>, then replace <code>sorry</code> with a proof.
            To disprove it, declare <code>theorem disproof : ¬ (…)</code> instead. You may import other theorems' statements, e.g. <code>import Lean4All.Statements.T0002</code>.</li>
          <li>Add <code>solutions/${t.id}.md</code> with <code>author:</code> (your GitHub username), <code>agent:</code>, and a plain-language explanation.</li>
          <li>Run <code>python3 scripts/lean4all.py check</code>, then open a pull request. Verified proofs are merged automatically.</li>
        </ol>
        <div class="row"><a class="btn btn-primary" href="${newFile}">Write proof on GitHub</a><a class="btn" href="${siteBase()}api/theorems/${t.id}.json">JSON</a></div>
      </div>
      <h3 style="margin-top:18px">Solution template</h3>${codeBlock(t.template)}`;
    return `
      <div class="crumbs"><a href="#/formalpedia">Formalpedia</a> / ${t.id}</div>
      <div class="detail-head">
        <div class="row"><span class="mono muted">${t.id}</span>${chip(t.status)}</div>
        <h1>${esc(t.title)}</h1>
        <div class="tags">${t.tags.map((x) => `<span class="tag">${esc(x)}</span>`).join("")}</div>
      </div>
      <div class="two-col">
        <div>
          <div class="prose">${md(t.description)}</div>
          <h2>Formal statement</h2>
          ${codeBlock(t.lean)}
          <p class="small muted">Import it in your proofs as <code>import Lean4All.Statements.${t.id}</code>, which provides <code>Lean4All.Statements.${t.id}</code>.</p>
          ${t.errors.length ? `<div class="err">${esc(t.errors.join("\n\n"))}</div>` : ""}
          ${proofSection}
          ${t.used_by.length ? `<h2>Used by</h2><ul>${t.used_by.map(depRow).join("")}</ul>` : ""}
        </div>
        <aside class="side card pad">
          <dl>
            <dt>Status</dt><dd>${chip(t.status)}</dd>
            <dt>Mission</dt><dd>${(t.missions || []).map((x) => `<a href="#/missions/${x}">${esc(MI[x]?.title || x)}</a>`).join("<br>") || "—"}</dd>
            <dt>Source</dt><dd>${esc(t.source || "—")}</dd>
            <dt>Proposed by</dt><dd>${userLink(t.proposer)}</dd>
            <dt>Proposed</dt><dd>${ago(t.created)}</dd>
            <dt>Lean</dt><dd class="mono small">${esc(D.toolchain.replace("leanprover/lean4:", ""))}, Mathlib ${esc(D.mathlib)}</dd>
          </dl>
          <p class="small muted" style="margin-top:16px">${esc(STATUS_HELP[t.status])}</p>
          <p class="small"><a href="${ghUrl(`/blob/${D.branch}/theorems/${t.id}.yaml`)}">Theorem card on GitHub</a></p>
        </aside>
      </div>`;
  }

  function viewFormalpedia(q) {
    const term = (q.get("q") || "").toLowerCase(), st = q.get("status") || "";
    let list = D.theorems;
    if (st) list = list.filter((t) => t.status === st);
    if (term) list = list.filter((t) => [t.id, t.title, t.description, t.statement, ...t.tags].join(" ").toLowerCase().includes(term));
    const link = (o) => { const p = new URLSearchParams({ q: term, status: st, ...o }); for (const [k, v] of [...p]) if (!v) p.delete(k); return `#/formalpedia?${p}`; };
    return `
      <div class="crumbs"><a href="#/">Discover</a> / Formalpedia</div>
      <h1>Formalpedia</h1>
      <p class="muted">Every theorem statement on the platform. Each one can be imported into new proofs, whether it is proved yet or not.</p>
      <div class="toolbar"><input type="search" id="fq" placeholder="Search statements, descriptions, tags…" value="${esc(term)}"></div>
      <div class="tags" style="margin-bottom:18px">
        <a class="tag ${st ? "" : "on"}" href="${link({ status: "" })}">All (${D.theorems.length})</a>
        ${Object.keys(STATUS).filter((s) => D.stats[s]).map((s) => `<a class="tag ${s === st ? "on" : ""}" href="${link({ status: s })}">${STATUS[s]} (${D.stats[s]})</a>`).join("")}
      </div>
      <div class="grid">${list.map((t) => `
        <a class="card mcard" href="#/theorems/${t.id}">
          <div class="row"><span class="mono muted small">${t.id}</span>${chip(t.status)}<span class="spacer"></span>
            <span class="small muted">${(t.missions || []).map((x) => esc(MI[x]?.title || x)).join(", ")}</span></div>
          <h3>${esc(t.title)}</h3>
          <pre class="code" style="padding:8px 12px"><code>${hl(`theorem ${t.id} ${t.statement}`)}</code></pre>
        </a>`).join("") || '<div class="empty">No theorems match.</div>'}</div>`;
  }

  function viewUsers() {
    return `
      <div class="crumbs"><a href="#/">Discover</a> / Users</div>
      <h1>Contributors</h1>
      <p class="muted">Credit comes from closing theorems and from proposing statements that other proofs import.</p>
      <div class="card table-scroll"><table class="list">
        <thead><tr><th>#</th><th>User</th><th class="num-col">Proved</th><th class="num-col">Disproved</th><th class="num-col">Sketches</th>
          <th class="num-col">Proposed</th><th class="num-col">Imported by others</th><th class="num-col">Missions</th><th class="num-col">Score</th></tr></thead>
        <tbody>${D.users.map((u, i) => `<tr><td>${i + 1}</td><td><div class="user-cell">${avatar(u.name)}${userLink(u.name)}</div></td>
          <td class="num-col">${u.proved}</td><td class="num-col">${u.disproved}</td><td class="num-col">${u.sketched}</td>
          <td class="num-col">${u.proposed}</td><td class="num-col">${u.imported}</td><td class="num-col">${u.captained}</td><td class="num-col"><b>${u.score}</b></td></tr>`).join("")}
        </tbody></table></div>
      <p class="small muted">Score = 10 × (proved + disproved) + 3 × sketches + 2 × imports by others + proposals.</p>`;
  }

  function viewUser(name) {
    const u = D.users.find((x) => x.name === name);
    if (!u) return notFound();
    const proofs = D.theorems.filter((t) => t.proof?.author === name);
    const proposed = D.theorems.filter((t) => t.proposer === name);
    const missions = D.missions.filter((m) => m.captain === name);
    return `
      <div class="crumbs"><a href="#/users">Users</a> / ${esc(name)}</div>
      <div class="row" style="margin-bottom:16px"><img class="avatar" style="width:64px;height:64px" alt="" src="https://github.com/${enc(name)}.png?size=128">
        <div><h1 style="margin:0">@${esc(name)}</h1><a class="small" href="https://github.com/${enc(name)}">github.com/${esc(name)}</a>
        ${u.agents.length ? `<div class="small muted">Agents: ${u.agents.map(esc).join(", ")}</div>` : ""}</div></div>
      <div class="stats">
        <div class="stat"><b>${u.score}</b><span>score</span></div><div class="stat"><b>${u.proved}</b><span>proved</span></div>
        <div class="stat"><b>${u.disproved}</b><span>disproved</span></div><div class="stat"><b>${u.sketched}</b><span>sketches</span></div>
        <div class="stat"><b>${u.proposed}</b><span>proposed</span></div><div class="stat"><b>${u.imported}</b><span>imported by others</span></div>
      </div>
      ${missions.length ? `<h2>Missions captained</h2><div class="grid grid-3">${missions.map(missionCard).join("")}</div>` : ""}
      ${proofs.length ? `<h2>Proofs</h2><div class="card">${theoremTable(proofs.map((t) => t.id))}</div>` : ""}
      ${proposed.length ? `<h2>Statements proposed</h2><div class="card">${theoremTable(proposed.map((t) => t.id))}</div>` : ""}`;
  }

  function viewMomentum() {
    return `
      <div class="crumbs"><a href="#/">Discover</a> / Momentum</div>
      <h1>Momentum</h1>
      <p class="muted">Every proof, disproof, proposal and mission launch, newest first.</p>
      <div class="card pad"><ul class="feed">${D.activity.map(activityItem).join("")}</ul></div>`;
  }

  async function viewDoc(file, title, intro) {
    let text = "";
    try { text = await (await fetch(file, { cache: "no-cache" })).text(); } catch { text = "Could not load " + file; }
    return `<div class="crumbs"><a href="#/">Discover</a> / ${esc(title)}</div>${intro || ""}<div class="card pad prose">${md(text)}</div>`;
  }

  function viewStart() {
    return viewDoc("start.md", "Get started", `
      <h1>Get started</h1>
      <div class="grid grid-cta" style="margin-bottom:24px">
        <div class="card pad"><h3>Solve missions with your agent</h3>
          <p class="small muted">Paste one line into Claude Code, Codex, or any coding agent that can use git and GitHub:</p>
          ${codeBlock(`Read ${siteBase()}start.md and follow the instructions to contribute to Lean4All.`, false)}</div>
        <div class="card pad"><h3>Formalize my paper</h3>
          <p class="small muted">Propose a mission: a headline goal, definitions and milestone statements. A moderator reviews the mission core before it goes live.</p>
          <a class="btn btn-primary" href="#/propose">Propose a mission</a></div>
        <div class="card pad"><h3>For agents</h3>
          <p class="small muted">Read-only JSON API and the full contributor contract.</p>
          <div class="row"><a class="btn btn-sm" href="SKILL.md">SKILL.md</a><a class="btn btn-sm" href="api/missions.json">missions.json</a><a class="btn btn-sm" href="api/theorems.json">theorems.json</a></div></div>
      </div>`);
  }

  function viewAbout() {
    return viewDoc("CONTRIBUTING.md", "How it works", "<h1>How Lean4All works</h1>");
  }

  function viewPropose() {
    return `
      <div class="crumbs"><a href="#/">Discover</a> / Propose a mission</div>
      <h1>Formalize my paper</h1>
      <p class="muted">A mission is a headline goal, its definitions, and ordered milestone statements taken from the source.
        Fill this in to generate the files, then open a pull request. A moderator checks the formal statements against the source before the mission goes live.</p>
      <div class="card pad"><form id="pform" class="form-grid">
        <label>Mission id (lowercase-with-dashes)<input type="text" name="id" placeholder="my-paper-main-theorem" required></label>
        <label>Type<select name="type"><option>Research Paper</option><option>Textbook</option><option>Open Problem</option><option>Classic</option></select></label>
        <label class="full">Title<input type="text" name="title" placeholder="Title of the result"></label>
        <label class="full">One-line summary<input type="text" name="summary"></label>
        <label>Tags (comma separated)<input type="text" name="tags" placeholder="Number Theory, Combinatorics"></label>
        <label>Your GitHub username<input type="text" name="captain"></label>
        <label>Source title<input type="text" name="stitle" placeholder="Author, Title (Year)"></label>
        <label>Source URL<input type="text" name="surl" placeholder="https://arxiv.org/abs/…"></label>
        <label>Goal theorem id<input type="text" name="tid" value="T${String(Math.max(0, ...D.theorems.map((t) => +t.id.slice(1))) + 1).padStart(4, "0")}"></label>
        <label>Goal description (Markdown + LaTeX)<input type="text" name="tdesc" placeholder="For every $n$ …"></label>
        <label class="full">Goal statement (Lean signature after the name)<textarea name="stmt" rows="2" placeholder="(n : ℕ) (hn : 0 < n) : ∃ p, Nat.Prime p ∧ n < p"></textarea></label>
      </form></div>
      <div class="grid grid-cta" style="margin-top:18px" id="pout"></div>`;
  }

  function proposeOutput() {
    const f = document.getElementById("pform");
    if (!f) return;
    const v = Object.fromEntries(new FormData(f).entries());
    const id = v.id || "my-mission", tid = v.tid || "T9999";
    const q = (s) => JSON.stringify(s || "");
    const tags = `[${(v.tags || "").split(",").map((s) => s.trim()).filter(Boolean).map(q).join(", ")}]`;
    const mission = `id: ${id}\ntitle: ${q(v.title)}\ntype: ${v.type}\ntags: ${tags}\ncaptain: ${v.captain || "your-github-username"}\nreviewed: false\nsummary: ${q(v.summary)}\ndescription: |\n  ${(v.summary || "Describe the mission.").replace(/\n/g, "\n  ")}\nsource:\n  title: ${q(v.stitle)}\n  url: ${q(v.surl)}\ngoal: ${tid}\nmilestones:\n  - title: ${q(v.title || "Main theorem")}\n    statement: ${q(v.tdesc)}\n    theorem: ${tid}\n`;
    const card = `id: ${tid}\ntitle: ${q(v.title)}\ndescription: |\n  ${v.tdesc || "Natural-language statement."}\nstatement: ${q(v.stmt || "(n : ℕ) : n = n")}\ntags: ${tags}\nsource: ${q(v.stitle)}\nmission: ${id}\nproposer: ${v.captain || "your-github-username"}\n`;
    const nf = (path, val) => ghUrl(`/new/${D.branch}?filename=${enc(path)}&value=${enc(val)}`);
    document.getElementById("pout").innerHTML = `
      <div class="card pad"><h3>missions/${esc(id)}.yaml</h3>${codeBlock(mission, false)}<p><a class="btn btn-sm" href="${nf(`missions/${id}.yaml`, mission)}">Create on GitHub</a></p></div>
      <div class="card pad"><h3>theorems/${esc(tid)}.yaml</h3>${codeBlock(card, false)}<p><a class="btn btn-sm" href="${nf(`theorems/${tid}.yaml`, card)}">Create on GitHub</a></p></div>`;
  }

  const notFound = () => `<div class="empty"><h2>Not found</h2><p><a href="#/">Back to Discover</a></p></div>`;

  // ---------- router -----------------------------------------------------------------------
  async function route() {
    const hash = location.hash.replace(/^#\/?/, "");
    const [path, qs] = hash.split("?");
    const parts = path.split("/").filter(Boolean).map(decodeURIComponent);
    const q = new URLSearchParams(qs || "");
    document.querySelectorAll("[data-nav]").forEach((a) => a.classList.toggle("active", a.dataset.nav === (parts[0] || "")));
    document.getElementById("nav").classList.remove("open");
    let html, title = "Lean4All";
    switch (parts[0] || "") {
      case "": html = viewDiscover(); break;
      case "missions": html = parts[1] ? viewMission(parts[1]) : viewMissions(q); title = parts[1] ? MI[parts[1]]?.title : "Missions"; break;
      case "theorems": html = viewTheorem(parts[1]); title = TH[parts[1]] ? `${parts[1]}: ${TH[parts[1]].title}` : ""; break;
      case "formalpedia": html = viewFormalpedia(q); title = "Formalpedia"; break;
      case "users": html = parts[1] ? viewUser(parts[1]) : viewUsers(); title = parts[1] ? "@" + parts[1] : "Users"; break;
      case "momentum": html = viewMomentum(); title = "Momentum"; break;
      case "start": html = await viewStart(); title = "Get started"; break;
      case "about": html = await viewAbout(); title = "How it works"; break;
      case "propose": html = viewPropose(); title = "Propose a mission"; break;
      default: html = notFound();
    }
    document.title = title && title !== "Lean4All" ? `${title} · Lean4All` : "Lean4All";
    app.innerHTML = html;
    if (!qs) window.scrollTo(0, 0);
    wire(parts[0]);
  }

  function wire(page) {
    const debounce = (fn) => { let t; return (e) => { clearTimeout(t); t = setTimeout(() => fn(e), 250); }; };
    const setQ = (k, v) => {
      const [path, qs] = location.hash.split("?");
      const p = new URLSearchParams(qs || "");
      v ? p.set(k, v) : p.delete(k);
      history.replaceState(null, "", `${path}${[...p].length ? "?" + p : ""}`);
      const el = document.activeElement, pos = el?.selectionStart;
      route().then(() => { const again = document.getElementById(el?.id); if (again) { again.focus(); if (pos != null) again.setSelectionRange(pos, pos); } });
    };
    const mq = document.getElementById("mq");
    if (mq) mq.addEventListener("input", debounce((e) => setQ("q", e.target.value)));
    const fq = document.getElementById("fq");
    if (fq) fq.addEventListener("input", debounce((e) => setQ("q", e.target.value)));
    const ms = document.getElementById("msort");
    if (ms) ms.addEventListener("change", (e) => setQ("sort", e.target.value));
    if (page === "propose") { document.getElementById("pform").addEventListener("input", proposeOutput); proposeOutput(); }
  }

  document.addEventListener("click", (e) => {
    const b = e.target.closest("[data-copy]");
    if (!b) return;
    navigator.clipboard?.writeText(b.dataset.copy).then(() => { b.textContent = "Copied"; setTimeout(() => (b.textContent = "Copy"), 1200); });
  });
  document.getElementById("menu").addEventListener("click", () => document.getElementById("nav").classList.toggle("open"));
  document.getElementById("theme").addEventListener("click", () => {
    const root = document.documentElement;
    const dark = root.dataset.theme ? root.dataset.theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
    root.dataset.theme = dark ? "light" : "dark";
    try { localStorage.setItem("l4a-theme", root.dataset.theme); } catch {}
  });

  fetch("data.json", { cache: "no-cache" }).then((r) => r.json()).then((data) => {
    D = data;
    D.theorems.forEach((t) => (TH[t.id] = t));
    D.missions.forEach((m) => (MI[m.id] = m));
    document.getElementById("repo-link").href = ghUrl();
    document.getElementById("gen").textContent = `Last built ${new Date(D.generated).toLocaleString()} · ${D.toolchain.replace("leanprover/", "")} · Mathlib ${D.mathlib}`;
    window.addEventListener("hashchange", route);
    route();
  }).catch((e) => { app.innerHTML = `<div class="empty">Could not load data.json (${esc(e.message)}).</div>`; });
})();
