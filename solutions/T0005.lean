import Mathlib

theorem solution (n : ℕ) (h : Even (n ^ 2)) : Even n :=
  (Nat.even_pow.mp h).1
