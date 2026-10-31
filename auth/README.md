# Sign in with GitHub: setup and everyday use

This guide sets up the "Sign in" button on the Lean4All site. You don't need to know anything
about GitHub Apps or Cloudflare to follow it. Every step says where to click and what you
should see. Setup takes about 20 minutes, and you only do it once.

If you're working with Claude Code, it can run the terminal commands for you. You only need to
do the browser steps, which are marked **🖱 You**.

---

## What you're building, in plain words

The site lives on GitHub Pages, which can only serve files. It cannot keep a secret. Signing in
with GitHub needs one secret (the "client secret") to finish the handshake. So we add two small
pieces:

1. **A GitHub App called "Lean4All Sign-in"**
   - This is what visitors see when they click "Sign in": GitHub asks them *"Authorize Lean4All
     Sign-in?"*
   - The app may do one thing: create issues in the `dichro67s/lean4all` repository, as the
     signed-in person. It cannot touch their code, their other repositories, or anything else.
2. **A tiny Cloudflare Worker**
   - This is a free program that runs on Cloudflare. It holds the secret and finishes the
     handshake.
   - It is about 100 lines ([worker.js](worker.js)) and stores nothing.

```
 visitor clicks "Sign in"
        │
        ▼
 Cloudflare Worker ──► GitHub: "Authorize Lean4All Sign-in?" ──► visitor clicks Authorize
        ▲                                                            │
        └──────────── GitHub sends a one-time code ◄─────────────────┘
        │
        ▼  Worker trades the code (+ secret) for a sign-in token
 back to the site, signed in. The token stays in the visitor's browser
 and expires after 8 hours.
```

What visitors get once it's on:

- **My page:** their pull requests, their requests, the missions they captain, their accepted
  proofs, and the theorems they watch.
- **Submit from the site:** they can send arXiv requests and mission proposals without going to
  GitHub.
- **Higher limit:** GitHub's limit goes from 60 to 5,000 requests an hour for them, so lists
  stop failing to load.

Until setup is finished, the site works exactly as before and the Sign in button stays hidden.

---

## Before you start

You need:

- your GitHub account (`dichro67s`), signed in on this computer's browser
- a free Cloudflare account. If you don't have one, make one at https://dash.cloudflare.com/sign-up.
  No credit card or domain is needed.
- a terminal in this repository (`/home/dhyeon/lean4all`)

---

## Step 1: Connect the terminal to Cloudflare (2 minutes)

Run:

```bash
cd /home/dhyeon/lean4all/auth
npx wrangler@3 login
```

**🖱 You:** a browser tab opens on Cloudflare and asks *"Allow Wrangler to make changes to your
Cloudflare account?"*. Click **Allow**. You'll see "You have granted authorization to Wrangler".
Close the tab.

The terminal says `Successfully logged in.`

> If the first `npx` asks "Need to install the following packages: wrangler … Ok to proceed?",
> type `y` and press Enter.

## Step 2: Put the Worker online (1 minute)

```bash
npx wrangler@3 deploy
```

The first time, Cloudflare may ask you to pick a **workers.dev subdomain**, a name for your
account's free web address. Any short name works, for example `dichro67s`.

At the end you'll see a line like:

```
https://lean4all-auth.dichro67s.workers.dev
```

That's your **Worker URL**. Copy it; you need it in Steps 3 and 6. If you open it in a browser
now, you'll see "Lean4All sign-in service." That's expected. It isn't finished yet.

## Step 3: Create the GitHub App (3 minutes)

**🖱 You:** open this link, after replacing `WORKER_URL` in it with your Worker URL from Step 2.
There's one place to replace, near `callback_urls`:

```
https://github.com/settings/apps/new?name=Lean4All+Sign-in&description=Sign+in+to+the+Lean4All+site+to+see+your+work+and+submit+requests.&url=https%3A%2F%2Fdichro67s.github.io%2Flean4all%2F&callback_urls[]=WORKER_URL/callback&public=true&webhook_active=false&issues=write
```

For example, with `https://lean4all-auth.dichro67s.workers.dev` the middle part becomes
`callback_urls[]=https://lean4all-auth.dichro67s.workers.dev/callback`.

(Claude can build this link for you once you give it the Worker URL.)

GitHub opens **"Register new GitHub App"** with most of the form already filled in. Check these,
from top to bottom:

| Field | Should be |
|---|---|
| GitHub App name | `Lean4All Sign-in`. If GitHub says the name is taken, add something, e.g. `Lean4All Sign-in dichro67s` |
| Homepage URL | `https://dichro67s.github.io/lean4all/` |
| Callback URL | your Worker URL + `/callback` |
| Expire user authorization tokens | ✅ checked (leave as is) |
| Request user authorization (OAuth) during installation | ☐ unchecked |
| Webhook → Active | ☐ **unchecked** |
| Permissions → Repository permissions → **Issues** | **Read and write** |
| Everything else under Permissions | No access (Metadata becomes Read-only by itself; that's fine) |
| Where can this GitHub App be installed? | **Any account**. This is needed so other people can sign in. It doesn't let them install it on your repo |

Click **Create GitHub App** at the bottom.

You land on the app's settings page. Now:

1. Find **Client ID** near the top. It looks like `Iv23li…`. Copy it.
2. Scroll to **Client secrets** and click **Generate a new client secret**. GitHub shows a long
   string **once**. Copy it right away and keep the tab open until Step 4 is done.

> The client ID is not secret. It can be in the repository. The client secret is a password:
> don't paste it into chats, issues, or files in the repository.

## Step 4: Give the Worker the app's ID and secret (2 minutes)

1. Open [wrangler.toml](wrangler.toml) and paste the Client ID between the quotes:
   ```toml
   GITHUB_CLIENT_ID = "Iv23li…"
   ```
   (Or give the Client ID to Claude and it will do this.)
2. In the terminal, store the secret on Cloudflare:
   ```bash
   npx wrangler@3 secret put GITHUB_CLIENT_SECRET
   ```
   It asks `Enter a secret value:`. **🖱 You:** paste the client secret and press Enter. Nothing
   shows while you paste; that's normal. You'll see `✨ Success!`.
3. Deploy again so the Worker picks up the Client ID:
   ```bash
   npx wrangler@3 deploy
   ```

## Step 5: Install the app on the repository (1 minute)

This lets the app create issues in `dichro67s/lean4all`, and only there.

**🖱 You:**

1. On the app's settings page, click **Install App** in the left menu.
2. Click **Install** next to `dichro67s`.
3. Choose **Only select repositories**, pick **lean4all**, and click **Install**.

## Step 6: Turn on the button (1 minute)

Open [lean4all.yaml](../lean4all.yaml) and set the last line to your Worker URL:

```yaml
auth: https://lean4all-auth.dichro67s.workers.dev
```

Commit and push. Claude can do this for you. GitHub rebuilds the site; that takes a while
because Lean checks every proof first. Watch it under the repository's **Actions** tab, in the
"Pages" workflow. When it shows a green check, the site is updated.

## Step 7: Try it

1. Open https://dichro67s.github.io/lean4all/. A **Sign in** button appears at the top right.
2. Click it. GitHub asks *"Authorize Lean4All Sign-in"*. Click **Authorize**.
3. You come back to the site with your avatar at the top right. Click it to open **My page**.
4. Try **Launch a mission**: the form now shows a **Submit proposal** button, and your username
   is filled in.

If something goes wrong, see [Troubleshooting](#troubleshooting).

## Step 8 (optional): Let the bot reply to proposals

When a mission proposal is wrong (for example, the Lean statement doesn't compile), the bot
skips it. Without a token it can't say why. To let it leave a comment:

**🖱 You:**

1. Go to https://github.com/settings/personal-access-tokens/new (a "fine-grained" token).
2. Fill in the form:
   - **Token name:** `lean4all-bot`
   - **Expiration:** up to 1 year
   - **Repository access:** Only select repositories → `lean4all`
   - **Permissions → Repository permissions → Issues:** Read and write
3. Click **Generate token** and copy the token.

Then, in the terminal:

```bash
mkdir -p ~/.config/lean4all
printf 'LEAN4ALL_BOT_TOKEN=%s\n' 'PASTE_TOKEN_HERE' > ~/.config/lean4all/bot.env
chmod 600 ~/.config/lean4all/bot.env
```

The bot reads that file on its next run, within 5 minutes. Comments will appear under your
account name, because it's your token.

---

## Everyday use

### What happens when someone proposes a mission

1. They fill in **Launch a mission** on the site and click **Submit proposal**. Or they use the
   "Propose a mission" issue form on GitHub; both do the same thing.
2. A GitHub issue titled `[Mission] their-mission-id` appears under the repository's **Issues**
   tab, posted under their account.
3. Within about 5 minutes your bot (`scripts/informal-bot.sh`, run by cron on this computer)
   picks it up:
   - It checks the fields and the theorem-card rules, and that the Lean statement compiles.
   - If all is well, it adds `missions/<id>.yaml` and a new `theorems/T####.yaml` to `main`, with
     the proposer as captain and credited as co-author. The commit closes the issue.
   - If something is wrong, it leaves the issue open. With Step 8 done, it also comments the
     reason.
4. The mission shows on the site as **not reviewed**, just like arXiv blueprints.

### Reviewing a new mission (moderator work)

Open the mission's file `missions/<id>.yaml` on GitHub and compare the goal statement in
`theorems/T####.yaml` with the source (paper or book). If it's faithful, change
`reviewed: false` to `reviewed: true` and commit. If it's wrong or spam, delete both files in
one commit, and say why on the closed issue.

### arXiv requests

These work as before. The site now files the issue for signed-in visitors, so they don't have to
go to GitHub. The bot handles them as it always has.

### Someone is abusing it

- **Spam issues:** on the issue, click `⋯` → **Delete issue**, or close it.
- **Block a person:** go to github.com → your avatar → **Settings → Moderation → Blocked users**.
  Blocked people can't open issues in your repositories, from the site or from GitHub.
- **Turn sign-in off quickly:** clear the `auth:` line in `lean4all.yaml` and push. The button
  disappears after the site rebuilds. To cut it off immediately, go to the GitHub App's settings
  → **Advanced → Suspend** (or delete the app).

### Where to look when you're curious

| What | Where |
|---|---|
| Proposals and requests | repository → **Issues** |
| Site builds | repository → **Actions** → "Pages" |
| What the bot did | `~/.local/state/lean4all-bot.log` on this computer |
| How many people use sign-in | GitHub App settings → **Advanced** shows recent activity. Cloudflare dashboard → Workers → lean4all-auth → **Metrics** |

### Changing the secret

If the client secret may have leaked:

1. In the app's settings, generate a new client secret.
2. Run `npx wrangler@3 secret put GITHUB_CLIENT_SECRET` again.
3. Delete the old secret on GitHub.

People who are signed in stay signed in until their token expires.

### Costs

Nothing. Cloudflare's free plan allows 100,000 Worker requests a day, and each sign-in uses two.

---

## Troubleshooting

**The Sign in button doesn't appear.**
`auth:` in `lean4all.yaml` is empty, or the site hasn't rebuilt yet. Check the Actions tab, then
reload the page with Ctrl+Shift+R.

**GitHub says "The redirect_uri is not associated with this application."**
The Callback URL in the app settings doesn't exactly match the Worker URL + `/callback`. Fix it
under the app's **General** settings, then try again.

**The site says "GitHub sign-in did not finish (bad_verification_code)" or "(incorrect_client_credentials)".**
The client ID in `wrangler.toml` or the secret on Cloudflare is wrong. Redo Step 4.

**The site says "state mismatch".**
The sign-in was started in another tab or browser, or took too long. Just click Sign in again.

**"Bad sign-in request." from the Worker.**
The site's address isn't in `ALLOWED_RETURN` in `wrangler.toml`. This happens if the site moves
to a new domain. Add the new address and run `npx wrangler@3 deploy`.

**Submitting fails with "Resource not accessible by integration".**
The app isn't installed on `lean4all`, or it doesn't have Issues: Read and write. Redo Step 5,
and check the permissions in the app settings. After you change permissions, GitHub asks you to
approve the change on the installation page.

**A proposal sits there and nothing happens.**
Look at `~/.local/state/lean4all-bot.log`. The bot tries each proposal at most twice. To make it
try again, delete that issue's number from `~/.local/state/lean4all-missions.json`.

---

## Privacy, in one paragraph (also worth putting on the site)

Signing in asks GitHub for permission to create issues in the Lean4All repository on your
behalf, and nothing else. The sign-in token stays in your browser and is sent only to GitHub. It
expires after 8 hours, and signing out revokes it. Lean4All's servers store no accounts, tokens,
or personal data. Your watch list is saved only in your browser.
