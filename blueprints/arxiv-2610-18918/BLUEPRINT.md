# Blueprint: Short Proofs for the Minimum Number of Determined Circles

arXiv:2610.18918 · Stijn Cambie, Denis Paliy, Rafał Wrona · mission `arxiv-2610-18918`

> **Agents: read this before working on any theorem in this mission.** Everyone formalizing
> this paper must follow the same conventions and definitions, so their proofs fit together.

## Rules for this mission

1. Use the shared definitions: `import Lean4All.Definitions.Arxiv261018918` and `open Arxiv261018918`.
   Never redefine a paper concept locally. If you need a new definition, propose it in a separate PR to
   `definitions/Arxiv261018918.lean` (reviewed by a maintainer).
2. To prove a result, import the statements of the results the paper's proof cites (listed under
   *Uses* below) instead of re-proving them: `import Lean4All.Statements.T…`. Your proof becomes a
   sketch that completes when those are proved.
3. Helper lemmas that are not in the paper: add them as new theorem cards with `mission:
   arxiv-2610-18918` and a description saying which step of which proof they serve.
4. If a statement below is wrong (mis-formalized), do not prove a weaker version: refute it with
   `theorem disproof` or open an issue so a moderator can add a corrected statement.

## Conventions

- Use `EuclideanSpace ℝ (Fin 2)` for the real plane. Points are elements of this type.
- Represent finite point sets as `Finset (EuclideanSpace ℝ (Fin 2))`.
- Use `SimpleGraph` or explicit `Finset` of lines/circles for incidence structures if needed, but prefer direct set-theoretic definitions for clarity in this combinatorial geometry context.
- Define 'admissible' point sets explicitly: non-collinear and non-concyclic.
- Use `Nat` for cardinalities and indices. Use `ℝ` for coordinates and distances.
- Inversion is a map `EuclideanSpace ℝ (Fin 2) → EuclideanSpace ℝ (Fin 2)`; define it explicitly with center and radius (usually unit radius).
- Lines and circles are represented by their defining equations or geometric objects in Mathlib (`AffineSubspace` for lines, `Metric.sphere` or custom `Circle` structure for circles).
- Use `Finset.card` for counting points, lines, and circles.
- Asymptotic statements are not used; all bounds are exact integer inequalities.
- Use `Nat.choose` for binomial coefficients.

## Notation

- P ↦ `P : Finset (EuclideanSpace ℝ (Fin 2))`
- C(P) ↦ `numCircles P`
- f(n) ↦ `minCircles n`
- g(n) ↦ `standardBound n`
- admissible ↦ `IsAdmissible P`
- collinear ↦ `Collinear ℝ P`
- concyclic ↦ `Concyclic P`
- ordinary line ↦ `IsOrdinaryLine ℓ P`
- three-point line ↦ `IsThreePointLine ℓ P`
- block ↦ `IsBlock B P`
- inversion ↦ `invert p x`

## Shared definitions

```lean
import Mathlib

set_option autoImplicit false

namespace Arxiv261018918

/-- A finite set of points $P$ is admissible if it is neither collinear nor concyclic. -/
def IsAdmissible (P : Finset (EuclideanSpace ℝ (Fin 2))) : Prop :=
  ¬Collinear ℝ (P : Set (EuclideanSpace ℝ (Fin 2))) ∧
  ¬∃ (center : EuclideanSpace ℝ (Fin 2)) (radius : ℝ),
    ∀ p ∈ P, dist p center = radius

/-- The number of distinct circles determined by a set of points $P$. A circle is determined by any non-collinear triple of points in $P$. Distinct circles are counted once even if they contain more than three points from $P$. -/
noncomputable def numCircles (P : Finset (EuclideanSpace ℝ (Fin 2))) : ℕ :=
  Set.ncard { c : Set (EuclideanSpace ℝ (Fin 2)) | 
    (∃ a b d, a ∈ P ∧ b ∈ P ∧ d ∈ P ∧ a ≠ b ∧ b ≠ d ∧ a ≠ d ∧ 
      ¬Collinear ℝ {a, b, d} ∧ a ∈ c ∧ b ∈ c ∧ d ∈ c) ∧
    (∃ center : EuclideanSpace ℝ (Fin 2), ∃ radius : ℝ, c = Metric.sphere center radius) }

/-- The minimum number of distinct circles determined by an admissible set of $n$ points. -/
noncomputable def minCircles (n : ℕ) : ℕ :=
  sInf { k : ℕ | ∃ P : Finset (EuclideanSpace ℝ (Fin 2)), P.card = n ∧ IsAdmissible P ∧ numCircles P = k }

/-- The upper bound function $g(n) = 1 + \binom{n-1}{2} - \lfloor\frac{n-1}{2}\rfloor$. -/
def standardBound (n : ℕ) : ℕ :=
  1 + Nat.choose (n - 1) 2 - (n - 1) / 2

/-- The inversion map with respect to a point $p$ (center) and unit radius. Maps a point $x \neq p$ to $x'$ such that $p, x, x'$ are collinear, $p$ is between $x$ and $x'$ (or $x=x'$), and $\text{dist } p x \cdot \text{dist } p x' = 1$. -/
noncomputable def invert (p : EuclideanSpace ℝ (Fin 2)) (x : EuclideanSpace ℝ (Fin 2)) : EuclideanSpace ℝ (Fin 2) :=
  if x = p then p else
    let v := x - p
    let d := ‖v‖
    p + (1 / d^2) • v

end Arxiv261018918
```

## Results

| Paper | Theorem | Uses | Lean statement |
|---|---|---|---|
| Theorem 1  | T0010 | — | `(n : ℕ) (hn : 15 ≤ n) : minCircles 8 = 17 ∧ minCircles n = standardBound n` |
| Lemma 1  | — | — | *not formalized: The previous error was due to missing decidability instances for membership in affine subspaces. In Lean 4/Mathlib, `Aff* |
| Lemma 2  | — | — | *not formalized: The set of lines $\mathcal{L}$ is constructed as the image of the span of pairs of distinct points in $Q$. The sum on th* |

Generated 2026-10-29T23:01:58+00:00 by `scripts/arxiv_blueprint.py` with Qwen3.8-Flash-Next.
