#!/usr/bin/env bash
# Runs on the machine that serves Qwen. Keeps its own clone of the repo, turns arXiv requests
# (GitHub issues) into blueprints, informalizes new or changed theorem statements, and pushes the
# results to main (which redeploys the site).
# Install:  (crontab -l; echo "*/5 * * * * $PWD/scripts/informal-bot.sh >> $HOME/.local/state/lean4all-bot.log 2>&1") | crontab -
set -euo pipefail
export PATH="$HOME/.elan/bin:$HOME/miniconda3/bin:/usr/local/bin:/usr/bin:/bin"
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

# 1. arXiv requests (GitHub issues titled "[arXiv] ...") -> blueprints, missions, theorem cards
rm -f build/commit-message.txt
python3 scripts/arxiv_blueprint.py --from-issues 2>&1 | sed "s/^/$(date -Is) arxiv: /"
if [ -s build/commit-message.txt ]; then
  git add blueprints missions theorems definitions
  git commit -q -F build/commit-message.txt && echo "$(date -Is) committed blueprint(s)"
fi

# 2. plain-language readings for new or changed statements
out=$(python3 scripts/informalize.py 2>&1) || { echo "$(date -Is) informalize failed: $out"; exit 1; }
if [ -n "$(git status --porcelain -- informal)" ]; then
  ids=$(git status --porcelain -- informal | sed -E 's|.*informal/(T[0-9]+)\.json|\1|' | tr '\n' ' ')
  git add informal
  git commit -qm "Qwen informalization: ${ids% }" -m "Automated read-back by ${QWEN_MODEL:-Qwen3.8-Flash-Next} (scripts/informal-bot.sh)."
fi

if [ -n "$(git log origin/main..HEAD --oneline)" ]; then
  git push -q origin main && echo "$(date -Is) pushed $(git log origin/main..HEAD --oneline | wc -l) commit(s)"
fi
