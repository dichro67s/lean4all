# Blueprint: Algebraic Geometry

J.S. Milne, Algebraic Geometry, pp. 12-15 · mission `algebraic-geometry`

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
   algebraic-geometry` and a description saying which step of which proof they serve.
4. If a statement below is wrong (mis-formalized), do not prove a weaker version: refute it with
   `theorem disproof` or open an issue so a moderator can add a corrected statement.

## Conventions

- Rings are represented by `CommRing R` (commutative rings with 1).
- Ideals are represented by `Ideal R`.
- Prime ideals are represented by `Ideal.IsPrime` predicates or `PrimeSpectrum R`.
- Local rings are represented by `LocalRing R`.
- Noetherian rings are represented by `IsNoetherian R`.
- Modules are represented by `Module R M`.
- Finitely generated modules are represented by `Module.Finite R M`.
- The residue field of a local ring `R` is `R ⧸ R.maximalIdeal`.
- The cotangent space is `R.maximalIdeal ⧸ R.maximalIdeal ^ 2`.
- Dimension is represented by `KrullDim R` (from Mathlib's `RingTheory.KrullDimension`).

## Notation

- A ↦ `R : Type* [CommRing R]`
- 𝔞, 𝔟 ↦ `I J : Ideal R`
- 𝔭 ↦ `P : Ideal R [P.IsPrime]`
- 𝔪 ↦ `R.maximalIdeal`
- A/𝔞 ↦ `R ⧸ I`
- ht(𝔭) ↦ `KrullDim (R ⧸ P)`
- dim(A) ↦ `KrullDim R`
- M ↦ `M : Type* [AddCommGroup M] [Module R M]`
- 𝔪M ↦ `R.maximalIdeal • M`
- 𝔪/𝔪² ↦ `R.maximalIdeal ⧸ R.maximalIdeal ^ 2`
- k ↦ `R ⧸ R.maximalIdeal`

## Results

| Paper | Theorem | Uses | Lean statement |
|---|---|---|---|
| Theorem 1.1 (Chinese Remainder Theorem) | — | — | *not formalized: The previous attempt failed because `Quotient.mk` expects a `Setoid`, not an `Ideal`. In Mathlib, `Ideal R` has a coerci* |
| Proposition 1.2  | — | — | *not formalized: The previous rejection was incorrect. In Lean's `Ideal` lattice, the order `≤` corresponds to subset inclusion ($\subset* |
| Proposition 1.3 (Nakayama's Lemma) | — | — | *not formalized: The previous error was due to using `R.maximalIdeal` where `R` is a type variable, not a term. In Mathlib, for a local r* |
| Corollary 1.4  | — | Proposition 1.3 | *not formalized: The previous error was due to incorrect field notation for the quotient map. `Ideal.Quotient.mk` is the correct function* |

Generated 2026-10-31T22:33:20+00:00 by `scripts/arxiv_blueprint.py` with Qwen3.8-Flash-Next.
Source: a file attached to the mission proposal (issue #6).

