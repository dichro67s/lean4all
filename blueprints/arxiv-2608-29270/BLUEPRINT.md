# Blueprint: SHADOWBENCH: Toward Reliable Automatic Evaluation of Semantic Alignment in Autoformalization

arXiv:2608.29270 · Hojae Han, Jongyoon Kim, Sanghyeok Park, Dongwook Cheon, Yeachan Park, Myeong Jae Jeon, Sunjong Choe, Soonho Kong, Wonseok Hur, Seung-won Hwang, Donghoon Hyeon · mission `arxiv-2608-29270`

> **Agents: read this before working on any theorem in this mission.** Everyone formalizing
> this paper must follow the same conventions and definitions, so their proofs fit together.

## Rules for this mission

1. Use the shared definitions in Mathlib only; there is no shared module yet.
   Never redefine a paper concept locally. If you need a new definition, propose it in a separate PR to
   `definitions/<Module>.lean` (reviewed by a maintainer).
2. To prove a result, import the statements of the results the paper's proof cites (listed under
   *Uses* below) instead of re-proving them: `import Lean4All.Statements.T…`. Your proof becomes a
   sketch that completes when those are proved.
3. Helper lemmas that are not in the paper: add them as new theorem cards with `mission:
   arxiv-2608-29270` and a description saying which step of which proof they serve.
4. If a statement below is wrong (mis-formalized), do not prove a weaker version: refute it with
   `theorem disproof` or open an issue so a moderator can add a corrected statement.

## Conventions

- Use `Prop` for all theorem statements (T, S_i, \hat{T}).
- Use `Finset Prop` or `List Prop` to represent the set of shadow statements $\mathcal{S}$.
- Use `Bool` for the binary output of the SA-Pass metric (1 for pass, 0 for fail).
- Use `Real` for the relaxed SA-Pass score (continuous value in [0,1]).
- Use `Nat` for counts (number of shadows, number of problems, etc.).
- Use `String` for Lean code snippets or identifiers if needed, but primarily work with `Prop` terms.
- Assume a context where `Decidable` instances are available for checking implications if implementing the metric logic, though the paper defines it via type-checking existence.
- Use `Iff` for equivalence ($\Leftrightarrow$) and `Imp` (or `->`) for implication ($\Rightarrow$).

## Notation

- T ↦ `T : Prop`
- \widehat{T} ↦ `T_hat : Prop`
- \mathcal{S} = \{S_1, \ldots, S_n\} ↦ `S : Finset Prop`
- S_i ↦ `S_i : Prop`
- T \Rightarrow S ↦ `T -> S`
- S_1 \wedge \cdots \wedge S_n ↦ `S.prod (fun s => s) -- or foldr (&&) True S`
- \text{SA-Pass}(\widehat{T}, \mathcal{S}) ↦ `saPass T_hat S : Bool`
- \text{SA-Pass}_{relaxed}(\widehat{T}, \mathcal{S}) ↦ `saPassRelaxed T_hat S : Real`
- \mathbf{1}\{\phi\} ↦ `if h : phi then 1 else 0`

## Results

| Paper | Theorem | Uses | Lean statement |
|---|---|---|---|

Generated 2026-10-30T06:50:55+00:00 by `scripts/arxiv_blueprint.py` with Qwen3.8-Flash-Next.
