import Mathlib

theorem solution (n : ℕ) : ∃ p, Nat.Prime p ∧ p ∣ Nat.factorial n + 1 := by
  have h : Nat.factorial n + 1 ≠ 1 := by
    have := Nat.factorial_pos n
    omega
  exact Nat.exists_prime_and_dvd h
