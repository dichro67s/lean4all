import Mathlib

set_option autoImplicit false

namespace SrcHartsAg

/-- The vanishing set $Z(T)$ of a subset $T$ of the polynomial ring $A = k[x_1, \dots, x_n]$. It is the set of points $P \in \mathbf{A}^n$ such that $f(P) = 0$ for all $f \in T$. -/
def vanishingSet {k : Type*} [Field k] {n : Type*} [Fintype n] [DecidableEq n]
    (T : Set (MvPolynomial n k)) : Set (n → k) :=
  { P | ∀ f ∈ T, MvPolynomial.eval P f = 0 }

/-- A subset $Y$ of $\mathbf{A}^n$ is an algebraic set if there exists a subset $T$ of the polynomial ring $A$ such that $Y = Z(T)$. -/
def algebraicSet {k : Type*} [Field k] {n : Type*} [Fintype n] [DecidableEq n]
    (Y : Set (n → k)) : Prop :=
  ∃ T : Set (MvPolynomial n k), Y = vanishingSet T

end SrcHartsAg
