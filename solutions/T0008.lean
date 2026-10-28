import Mathlib

/-! Counterexample: n = 40 gives 40² + 40 + 41 = 1681 = 41². -/

theorem disproof : ¬ ∀ (n : ℕ), Nat.Prime (n ^ 2 + n + 41) := by
  intro h
  have h40 := h 40
  norm_num at h40
