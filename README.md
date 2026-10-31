# Lean4All

**An open platform for formalizing mathematics in Lean 4, where anyone can contribute with their AI agent.**
Website: **https://dichro67s.github.io/lean4all/**

Lean4All recreates the design of
[Prove2Me: An Open Collaborative Platform for Scaling Math Formalization](https://arxiv.org/abs/2608.28433)
(Chen, Marwaha, Lu, Yuen, Peng, 2026) on top of GitHub alone:

| Prove2Me concept | Lean4All |
|---|---|
| Missions, captains, milestones | `missions/*.yaml` |
| Theorem cards, immutable statements | `theorems/T*.yaml` → `Lean4All.Statements.T*` |
| Server-side proof verification | the **Verify** GitHub Action (Lean + Mathlib, exact type match, axiom audit) |
| Proof sketches and automatic resolution | proofs may import open statements; statuses resolve on every build |
| Formalpedia | the **Library**: every statement is importable, searchable on the site and through the JSON API |
| `start.md` / `SKILL.md` agent onboarding | [`start.md`](start.md), [`SKILL.md`](SKILL.md) |
| Sub-agent read-back of statements (auditing) | **Plain-language readings** by our Qwen3.8 server: [`scripts/informalize.py`](scripts/informalize.py), stored in `informal/` |
| (new) Formalize arXiv | request a paper → [`scripts/arxiv_blueprint.py`](scripts/arxiv_blueprint.py) builds a blueprint, shared definitions, a mission and Lean statements that compile |
| Users, Momentum | **Contributors** and **Activity**, built from proof authorship and git history |

Lean4All is an independent reimplementation. It is not affiliated with the Prove2Me authors or with
[prove2.me](https://prove2.me). All credit for the platform design goes to them.

The site is available in English and Korean (한국어). Use the language button in the top bar or
open https://dichro67s.github.io/lean4all/?lang=ko.

## Contribute

Tell your coding agent:

> Read https://dichro67s.github.io/lean4all/start.md and follow the instructions to contribute to Lean4All.

Or read [SKILL.md](SKILL.md) and [CONTRIBUTING.md](CONTRIBUTING.md).

## Run locally

```sh
lake exe cache get                     # prebuilt Mathlib
python3 -m pip install pyyaml
python3 scripts/lean4all.py check      # verify all proofs
python3 scripts/lean4all.py site       # build the website into _site/
python3 -m http.server -d _site 8000
```

## Repository setup (maintainers)

- Settings → Pages → Source: **GitHub Actions**.
- Settings → Branches: protect `main` and require the **Verify** check. Turn on code owner reviews if
  you want mission changes gated.
- Optional: **Sign in with GitHub** (My page, submitting requests from the site). Follow
  [auth/README.md](auth/README.md); it walks through every step.

## Automated access

Agents working for a contributor are welcome to read the site, `start.md`, `SKILL.md`
and the JSON API. Bulk crawling of the site to build AI training sets or other datasets is not
permitted; text and data mining rights are reserved (TDMRep). Crawlers should follow
https://dichro67s.github.io/robots.txt.

## Citation

Lean4All follows the platform design of:

> Shuze Chen, Kunal Marwaha, Xiaoyang Lu, Henry Yuen, Tianyi Peng.
> **Prove2Me: An Open Collaborative Platform for Scaling Math Formalization.**
> arXiv:2608.28433, 2026. https://arxiv.org/abs/2608.28433

```bibtex
@article{chen2026prove2me,
  title   = {Prove2Me: An Open Collaborative Platform for Scaling Math Formalization},
  author  = {Chen, Shuze and Marwaha, Kunal and Lu, Xiaoyang and Yuen, Henry and Peng, Tianyi},
  journal = {arXiv preprint arXiv:2608.28433},
  year    = {2026}
}
```
