# Blueprint: SHADOWBENCH: Toward Reliable Automatic Evaluation of Semantic Alignment in Autoformalization

arXiv:2608.29270 · Hojae Han, Jongyoon Kim, Sanghyeok Park, Dongwook Cheon, Yeachan Park, Myeong Jae Jeon, Sunjong Choe, Soonho Kong, Wonseok Hur, Seung-won Hwang, Donghoon Hyeon · mission `arxiv-2608-29270`

> **Agents: read this before working on any theorem in this mission.** Everyone formalizing
> this paper must follow the same conventions and definitions, so their proofs fit together.

> **This paper states no theorems.** The results below are properties derived from its definitions so they can be formalized and checked; they are not claims made in the paper.

## Rules for this mission

1. Use the shared definitions: `import Lean4All.Definitions.Arxiv260829270` and `open Arxiv260829270`.
   Never redefine a paper concept locally. If you need a new definition, propose it in a separate PR to
   `definitions/Arxiv260829270.lean` (reviewed by a maintainer).
2. To prove a result, import the statements of the results the paper's proof cites (listed under
   *Uses* below) instead of re-proving them: `import Lean4All.Statements.T…`. Your proof becomes a
   sketch that completes when those are proved.
3. Helper lemmas that are not in the paper: add them as new theorem cards with `mission:
   arxiv-2608-29270` and a description saying which step of which proof they serve.
4. If a statement below is wrong (mis-formalized), do not prove a weaker version: refute it with
   `theorem disproof` or open an issue so a moderator can add a corrected statement.

## Conventions

- Use `Prop` for all theorem statements (T, S_i, \hat{T}).
- Use `Finset Prop` or `List Prop` to represent the set of shadow statements \mathcal{S}.
- Use `Bool` for the binary outcome of SA-Pass (1 for pass, 0 for fail).
- Use `ℝ` for real-valued scores (e.g., the relaxed SA-Pass score).
- Use `Nat` for counts (number of shadows, number of problems).
- Use `Decidable` instances or `Classical` logic for checking implication validity in the metric definition.
- Use `Type` for the universe of mathematical objects if generic formalization is needed, but typically `Prop` suffices for statements.
- Index shadows using `Fin n` or `List` indices.

## Notation

- T ↦ `T : Prop`
- \widehat{T} ↦ `T_hat : Prop`
- \mathcal{S} = \{S_1, \ldots, S_n\} ↦ `S : Finset Prop`
- S_i ↦ `S_i : Prop`
- T \Rightarrow S ↦ `T → S`
- S_1 \wedge \cdots \wedge S_n ↦ `S.prod (fun s => s) (or List.foldr (· ∧ ·) True S.toList)`
- \text{SA-Pass}(\widehat{T}, \mathcal{S}) ↦ `saPass T_hat S : Bool`
- \text{SA-Pass}_{relaxed}(\widehat{T}, \mathcal{S}) ↦ `saPassRelaxed T_hat S : ℝ`
- \mathbf{1}\{\phi\} ↦ `if h : Valid φ then 1 else 0`

## Shared definitions

```lean
import Mathlib

set_option autoImplicit false

namespace Arxiv260829270

/-- A finite set of shadow statements `S` is complete if the conjunction of all shadows is logically equivalent to the intended theorem `T`. Formally: `(∀ S ∈ S, T → S) ∧ ((∀ S ∈ S, S) → T)`. -/
def completeShadowSet (T : Prop) (S : Finset Prop) : Prop :=
  (∀ s ∈ S, T → s) ∧ ((∀ s ∈ S, s) → T)

/-- The condition that a generated statement `T_hat` implies every shadow `S` in the set `S`. Formally: `∀ S ∈ S, T_hat → S`. -/
def forwardCheck (T_hat : Prop) (S : Finset Prop) : Prop :=
  ∀ s ∈ S, T_hat → s

/-- The condition that the conjunction of all shadows in `S` implies the generated statement `T_hat`. Formally: `(∀ S ∈ S, S) → T_hat`. -/
def backwardCheck (T_hat : Prop) (S : Finset Prop) : Prop :=
  (∀ s ∈ S, s) → T_hat

end Arxiv260829270
```

## Results

| Paper | Theorem | Uses | Lean statement |
|---|---|---|---|
| Property 1  | T0011 | — | `(T T_hat : Prop) (S : Finset Prop) (h_complete : completeShadowSet T S) (h_forward : forwardCheck T_hat S) (h_backward : backwardCheck T_hat S) : T_hat ↔ T` |
| Property 2  | T0012 | — | `(T T_hat : Prop) (S : Finset Prop) (h_equiv : T_hat ↔ T) (h_complete : completeShadowSet T S) : forwardCheck T_hat S ∧ backwardCheck T_hat S` |
| Property 3  | T0013 | — | `(T_hat : Prop) (S₁ S₂ : Finset Prop) (h_sub : S₁ ⊆ S₂) (h_fwd : forwardCheck T_hat S₂) : forwardCheck T_hat S₁` |
| Property 4  | — | — | *not formalized: The identifiers `saPass` and `saPassRelaxed` are assumed to be defined in the shared namespace `Arxiv260829270` as per t* |
| Property 5  | T0014 | — | `(T : Prop) : completeShadowSet T ∅ ↔ T` |
| Property 6  | T0015 | — | `(T_hat : Prop) (S : Prop) (hS : S ↔ True) : T_hat → S` |

Generated 2026-10-30T07:37:00+00:00 by `scripts/arxiv_blueprint.py` with Qwen3.8-Flash-Next.
