// Sign in with GitHub for the Lean4All site.
//
// The site is static, so it cannot keep the GitHub App's client secret. This Cloudflare Worker
// does the one step that needs it: trading GitHub's one-time code for a user token. The token goes
// back to the site in the URL fragment (never sent to any server) and lives in the visitor's
// browser. The Worker stores nothing.
//
//   GET  /login?return=<site url>&state=<random>  -> redirect to GitHub
//   GET  /callback?code=…&state=…                 -> redirect to <site url>#/auth?token=…&state=…
//   POST /revoke  {"token": "…"}                   -> revoke a token on sign-out
//
// Environment: GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET (secret),
//              ALLOWED_RETURN = comma-separated site URL prefixes, e.g. https://dichro67s.github.io/lean4all/
// Setup steps are in auth/README.md.

const b64url = (s) => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64url = (s) => decodeURIComponent(escape(atob(s.replace(/-/g, "+").replace(/_/g, "/"))));

function allowedReturn(env, ret) {
  try {
    const u = new URL(ret);
    if (u.protocol !== "https:" && u.hostname !== "localhost" && u.hostname !== "127.0.0.1") return null;
    const target = u.origin + u.pathname;
    const ok = (env.ALLOWED_RETURN || "").split(",").map((s) => s.trim()).filter(Boolean).some((a) => target.startsWith(a));
    return ok ? target : null;   // drop query and fragment; the site keeps its own route
  } catch { return null; }
}

function cors(env, req) {
  const origin = req.headers.get("Origin") || "";
  const ok = (env.ALLOWED_RETURN || "").split(",").some((a) => { try { return new URL(a.trim()).origin === origin; } catch { return false; } });
  return ok ? { "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Methods": "POST, OPTIONS",
                "Access-Control-Allow-Headers": "Content-Type", "Vary": "Origin" } : {};
}

const STATE_RE = /^[A-Za-z0-9_-]{16,128}$/;
const back = (ret, params) => Response.redirect(`${ret}#/auth?${new URLSearchParams(params)}`, 302);

export default {
  async fetch(req, env) {
    const url = new URL(req.url);

    if (url.pathname === "/login") {
      const ret = allowedReturn(env, url.searchParams.get("return") || "");
      const state = url.searchParams.get("state") || "";
      if (!ret || !STATE_RE.test(state)) return new Response("Bad sign-in request.", { status: 400 });
      const gh = new URL("https://github.com/login/oauth/authorize");
      gh.searchParams.set("client_id", env.GITHUB_CLIENT_ID);
      gh.searchParams.set("redirect_uri", `${url.origin}/callback`);
      // GitHub hands `state` back unchanged; carry the return address in it. The site checks the
      // random part, and the return address is checked against ALLOWED_RETURN again below.
      gh.searchParams.set("state", b64url(JSON.stringify({ r: ret, s: state })));
      return Response.redirect(gh.toString(), 302);
    }

    if (url.pathname === "/callback") {
      let packed;
      try { packed = JSON.parse(unb64url(url.searchParams.get("state") || "")); } catch { packed = null; }
      const ret = packed && allowedReturn(env, packed.r);
      if (!ret || !STATE_RE.test(packed.s || "")) return new Response("Bad sign-in state.", { status: 400 });
      const err = url.searchParams.get("error");
      if (err) return back(ret, { error: err, state: packed.s });
      const r = await fetch("https://github.com/login/oauth/access_token", {
        method: "POST",
        headers: { "Accept": "application/json", "Content-Type": "application/json", "User-Agent": "lean4all-auth" },
        body: JSON.stringify({ client_id: env.GITHUB_CLIENT_ID, client_secret: env.GITHUB_CLIENT_SECRET,
                               code: url.searchParams.get("code"), redirect_uri: `${url.origin}/callback` }),
      });
      const tok = await r.json().catch(() => ({}));
      if (!tok.access_token) return back(ret, { error: tok.error || "exchange_failed", state: packed.s });
      return back(ret, { token: tok.access_token, expires_in: tok.expires_in || "", state: packed.s });
    }

    if (url.pathname === "/revoke") {
      const h = cors(env, req);
      if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: h });
      if (req.method !== "POST") return new Response("Method not allowed", { status: 405, headers: h });
      const { token } = await req.json().catch(() => ({}));
      if (typeof token !== "string" || !token) return new Response("Missing token", { status: 400, headers: h });
      await fetch(`https://api.github.com/applications/${env.GITHUB_CLIENT_ID}/token`, {
        method: "DELETE",
        headers: { "Authorization": "Basic " + btoa(`${env.GITHUB_CLIENT_ID}:${env.GITHUB_CLIENT_SECRET}`),
                   "Accept": "application/vnd.github+json", "User-Agent": "lean4all-auth" },
        body: JSON.stringify({ access_token: token }),
      });
      return new Response(null, { status: 204, headers: h });
    }

    return new Response("Lean4All sign-in service.", { status: 404 });
  },
};
