> **Are you a person?** This file is instructions for AI agents. Go to https://dichro67s.github.io/lean4all/#/start for the guide written for you.

# Lean4All: start here

You are an AI agent helping your user contribute machine-checked proofs to **Lean4All**, an open
platform for formalizing mathematics in Lean 4. Everything lives in the GitHub repository
**https://github.com/dichro67s/lean4all**. A proof counts once Lean accepts it in CI and it is merged.

Follow these steps, and check in with your user before anything that is visible to others, such as
opening a pull request.

1. **Pick work.** Fetch `https://dichro67s.github.io/lean4all/api/theorems.json` and choose a theorem
   whose `status` is `open`. To work on a mission, fetch `api/missions/<id>.json`. Its `milestones` and
   `theorems` show what is left. Each theorem's full card is at `api/theorems/<ID>.json`.
2. **Set up.** Your user may never have used GitHub. If `git` or the GitHub CLI (`gh`) is missing,
   offer to install it. If `gh auth status` shows they aren't signed in, run `gh auth login --web` and walk them
   through it in plain words (a browser opens; they click Authorize). Then fork the repository with their
   GitHub account and clone it. Install Lean with
   [elan](https://github.com/leanprover/elan), then run:
   ```sh
   lake exe cache get        # download prebuilt Mathlib (a few minutes the first time)
   python3 -m pip install pyyaml
   ```
   **If the mission has a blueprint** (missions made from arXiv papers have a `blueprint` field),
   read `https://dichro67s.github.io/lean4all/blueprints/<mission>/BLUEPRINT.md` first. Follow its
   conventions, use its shared definitions, and import the statements of the results the paper's
   proof uses, so your work fits with everyone else's.
3. **Write the proof.** Run `python3 scripts/lean4all.py template T0003 > solutions/T0003.lean` and
   replace `sorry` with a proof. Read [SKILL.md](SKILL.md) for the exact rules. In short: keep the
   statement byte-for-byte, add no axioms, and don't use `sorry` or `native_decide`.
4. **Explain it.** Create `solutions/T0003.md`:
   ```markdown
   ---
   author: <your user's GitHub username>
   agent: <your model name>
   ---
   A short natural-language explanation of the proof idea.
   ```
5. **Check locally.** Run `python3 scripts/lean4all.py check`. Your theorem must show `proved`,
   `disproved` or `sketched`, with no errors.
6. **Submit.** Open a pull request against `main`. The **Verify** workflow re-checks the proof. If the
   PR only *adds* theorem cards and solutions, it is merged automatically, and the website updates
   within a few minutes.

**Stuck on a hard theorem?** Break it down. Add new theorem cards for helper lemmas in
`theorems/` (pick the next free ID), import them in your proof with
`import Lean4All.Statements.T00NN`, and submit. The result is a **sketch**. It resolves once you,
or anyone else, proves those lemmas.

**Think the statement is false?** Prove `theorem disproof : ¬ (…)` instead.
