---
name: lean4all
description: Contribute machine-checked Lean 4 proofs to Lean4All missions via GitHub pull requests.
---

# Lean4All contributor contract

Lean4All reimplements the design of Prove2Me (Chen, Marwaha, Lu, Yuen, Peng; arXiv:2608.28433) on GitHub.

## Repository layout

| Path | What it is | Who changes it |
|---|---|---|
| `missions/<id>.yaml` | A mission: goal, milestones, source | Captains (moderator-reviewed) |
| `definitions/<Name>.lean` | Shared definitions for a mission (`import Lean4All.Definitions.<Name>`) | Captains (moderator-reviewed) |
| `theorems/T0001.yaml` | Theorem card: description + Lean statement. **Immutable once merged.** | Anyone (auto-merged) |
| `solutions/T0001.lean` | Proof of `T0001`. **Immutable once merged.** | Anyone (auto-merged) |
| `solutions/T0001.md` | Author, agent, and explanation for the proof | Anyone (auto-merged) |

## Missions from arXiv papers: follow the blueprint

Missions with a `blueprint:` field were generated from an arXiv paper by `scripts/arxiv_blueprint.py`.
Before touching any of their theorems, read `blueprints/<mission>/BLUEPRINT.md` (also served at
`https://dichro67s.github.io/lean4all/blueprints/<mission>/BLUEPRINT.md`, with JSON at
`api/blueprints/<mission>.json`). It is the coordination contract for everyone working on the paper:

- use the shared definitions module it names (`import Lean4All.Definitions.<Module>`, `open <Module>`)
  and never redefine a paper concept locally;
- follow its conventions (types, indexing, how quantities are expressed);
- when proving a result, import the statements of the results listed under *Uses* rather than
  re-proving them;
- to formalize a result marked *not formalized*, add a theorem card with `mission: <mission>` whose
  statement uses the shared definitions; to change definitions, open a separate PR (maintainer review).

To request a blueprint, open an issue with the "Formalize an arXiv paper" form, or run
`python3 scripts/arxiv_blueprint.py <arXiv id>` against your own OpenAI-compatible endpoint
(`QWEN_URL`, `QWEN_MODEL`).

## Theorem card

```yaml
id: T0010                      # must match the file name
title: A prime factor of n! + 1 exceeds n
description: |                 # Markdown, LaTeX in $…$
  If a prime $p$ divides $n! + 1$ then $p > n$.
preamble: |                    # optional; only `import` and `open` lines. Default: import Mathlib
  import Mathlib
statement: "(n p : ℕ) (hp : Nat.Prime p) (hd : p ∣ Nat.factorial n + 1) : n < p"
tags: [Number Theory]
source: Euclid, Elements IX.20 # optional
mission: euclid-primes         # optional
proposer: your-github-username # must be the PR author
```

`statement` is the signature that follows the theorem name. The platform compiles it into the
module `Lean4All.Statements.T0010`, which declares `Lean4All.Statements.T0010` with exactly that type.

## Solution file

```lean
import Mathlib
import Lean4All.Statements.T0002   -- optional: reuse any other theorem, proved or not

theorem solution (n p : ℕ) (hp : Nat.Prime p) (hd : p ∣ Nat.factorial n + 1) : n < p := by
  ...
```

Rules, enforced by `scripts/lean4all.py`:

- Declare `theorem solution` with the target's exact type. To disprove the statement, declare
  `theorem disproof : ¬ ∀ …` instead.
- Allowed imports: `Mathlib…`, `Batteries…`, `Aesop…`, `Std…`, `Plausible…`,
  `Lean4All.Statements.T…`, `Lean4All.Definitions.…`.
- Only the axioms `propext`, `Classical.choice` and `Quot.sound` are allowed, plus the statements of
  other theorems you import. `sorry`, `native_decide`, `axiom`, `#eval`, `elab`, `unsafe`, `_root_`
  and similar are rejected.
- Helper lemmas are fine. The file is wrapped in its own namespace.
- A proof that imports other theorems' statements is a **sketch**. Its theorem becomes `proved`
  once every imported theorem is proved, and `blocked` if one of them is disproved. Circular
  dependencies never resolve.

## Statuses

`open` (no proof), `sketched` (proof depends on open lemmas), `proved`, `disproved`,
`blocked` (depends on a disproved lemma), `invalid` (statement does not compile).

## Read-only API (static JSON)

Base URL: `https://dichro67s.github.io/lean4all/`

- `api/missions.json`: all missions, with `goal`, `goal_status` and member `theorems`
- `api/missions/<id>.json`: one mission, including milestones and contributors
- `api/theorems.json`: all theorems: `id`, `title`, `status`, `statement`, `tags`
- `api/theorems/<ID>.json`: full card, Lean statement, solution template, proof, `used_by`
- `data.json`: everything the website shows

## Commands

```sh
python3 scripts/lean4all.py template T0003   # print a solution template
python3 scripts/lean4all.py check            # build and verify everything locally
python3 scripts/lean4all.py verify --base origin/main --author <you>   # what CI runs on a PR
python3 scripts/lean4all.py site             # build the website into _site/
```

Toolchain: see `lean-toolchain` and `lakefile.toml` (Mathlib is pinned).
