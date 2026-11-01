#!/usr/bin/env bash
# Runs on the machine that serves Qwen. Keeps its own clone of the repo, turns arXiv requests
# (GitHub issues) into blueprints, informalizes new or changed theorem statements, and pushes the
# results to main (which redeploys the site).
# Install:  (crontab -l; echo "*/5 * * * * $PWD/scripts/informal-bot.sh >> $HOME/.local/state/lean4all-bot.log 2>&1") | crontab -
set -euo pipefail
export PATH="$HOME/.elan/bin:$HOME/miniconda3/bin:/usr/local/bin:/usr/bin:/bin"
# Optional settings, e.g. LEAN4ALL_BOT_TOKEN (lets the bot explain rejected proposals). See auth/README.md.
[ -f "$HOME/.config/lean4all/bot.env" ] && . "$HOME/.config/lean4all/bot.env"
export LEAN4ALL_BOT_TOKEN="${LEAN4ALL_BOT_TOKEN:-}"
REPO="${LEAN4ALL_BOT_DIR:-$HOME/.local/share/lean4all-bot}"
REMOTE="${LEAN4ALL_REMOTE:-git@github.com:dichro67s/lean4all.git}"
mkdir -p "$(dirname "$REPO")" "$HOME/.local/state"
exec 9>"$HOME/.local/state/lean4all-bot.lock"
flock -n 9 || exit 0   # previous run still going

[ -d "$REPO/.git" ] || git clone -q "$REMOTE" "$REPO"
cd "$REPO"
git fetch -q origin main
git reset -q --hard origin/main

# Lean + Mathlib are needed to check generated statements (first run downloads the Mathlib cache).
[ -d .lake/packages/mathlib ] || lake exe cache get >/dev/null 2>&1 || { echo "$(date -Is) mathlib cache failed"; exit 1; }

# Push. Someone else may have pushed meanwhile (a book can take hours), so rebase and retry.
# Never lose finished work: the next run resets to origin/main, so if pushing keeps failing,
# park the commits on a branch on GitHub.
push_main() {
  local n pushed=0
  n=$(git rev-list --count origin/main..HEAD)
  [ "$n" -gt 0 ] || return 0
  for attempt in 1 2 3; do
    if git push -q origin main 2>/dev/null; then pushed=1; break; fi
    git fetch -q origin main
    git rebase -q origin/main || { git rebase --abort; break; }
  done
  if [ "$pushed" = 1 ]; then
    echo "$(date -Is) pushed $n commit(s)"
  else
    local b="bot-unpushed-$(date +%Y%m%d-%H%M%S)"
    git push -q origin "HEAD:refs/heads/$b" && echo "$(date -Is) could not push to main; saved $n commit(s) on branch $b"
    git fetch -q origin main && git reset -q --hard origin/main
  fi
}

# 1. arXiv requests (GitHub issues titled "[arXiv] ...") -> blueprints, missions, theorem cards
rm -f build/commit-message.txt
python3 -u scripts/arxiv_blueprint.py --from-issues 2>&1 | while IFS= read -r line; do echo "$(date -Is) arxiv: $line"; done
if [ -s build/commit-message.txt ]; then
  git add blueprints missions theorems definitions
  git commit -q -F build/commit-message.txt && echo "$(date -Is) committed blueprint(s)"
fi

# 1b. mission proposals (GitHub issues titled "[Mission] ...", filed from the site or the issue form).
# Fast: a proposal with a source only gets its mission pages ("preparing") and queued jobs here.
proposals() {
  rm -f build/mission-commit-message.txt
  python3 -u scripts/mission_requests.py 2>&1 | while IFS= read -r line; do echo "$(date -Is) missions: $line"; done
  if [ -s build/mission-commit-message.txt ]; then
    git add missions theorems blueprints definitions
    git commit -q -F build/mission-commit-message.txt && echo "$(date -Is) committed mission proposal(s)"
  fi
}
proposals
push_main

# 1c. fill in the prepared missions in the background, one part (5 pages) at a time, publishing
# each as soon as it's done. Up to 40 minutes per run; new proposals are still picked up in between.
start=$(date +%s)
while [ $(( $(date +%s) - start )) -lt 2400 ]; do
  rm -f build/part-commit-message.txt
  python3 -u scripts/mission_requests.py --work 2>&1 | while IFS= read -r line; do echo "$(date -Is) parts: $line"; done
  [ -s build/part-commit-message.txt ] || break
  git add missions theorems blueprints definitions
  git commit -q -F build/part-commit-message.txt && echo "$(date -Is) committed a mission part"
  push_main
  proposals
  push_main
done

# 2. plain-language readings for new or changed statements
out=$(python3 scripts/informalize.py 2>&1) || { echo "$(date -Is) informalize failed: $out"; exit 1; }
if [ -n "$(git status --porcelain -- informal)" ]; then
  ids=$(git status --porcelain -- informal | sed -E 's|.*informal/(T[0-9]+)\.json|\1|' | tr '\n' ' ')
  git add informal
  git commit -qm "Qwen informalization: ${ids% }" -m "Automated read-back by ${QWEN_MODEL:-Qwen3.8-Flash-Next} (scripts/informal-bot.sh)."
fi

push_main
