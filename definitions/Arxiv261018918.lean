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
