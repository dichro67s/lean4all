import Mathlib

/-! Nakayama's lemma (Milne, Algebraic Geometry, Proposition 1.3).
In a local ring the maximal ideal is the Jacobson radical, so Mathlib's general Nakayama lemma
applies. -/

theorem solution (R : Type*) [CommRing R] [IsLocalRing R] (M : Type*) [AddCommGroup M]
    [Module R M] [Module.Finite R M] :
    ((⊤ : Submodule R M) = IsLocalRing.maximalIdeal R • ⊤ → Subsingleton M) ∧
      ∀ N : Submodule R M, (⊤ : Submodule R M) = N ⊔ IsLocalRing.maximalIdeal R • ⊤ → N = ⊤ := by
  have hjac : IsLocalRing.maximalIdeal R ≤ Ideal.jacobson ⊥ :=
    (IsLocalRing.jacobson_eq_maximalIdeal ⊥ bot_ne_top).ge
  refine ⟨fun h => ?_, fun N h => ?_⟩
  · -- (a) `M = 𝔪M` forces `M = 0`.
    have hbot : (⊤ : Submodule R M) = ⊥ :=
      Submodule.eq_bot_of_le_smul_of_le_jacobson_bot _ ⊤ Module.Finite.fg_top h.le hjac
    rw [← Submodule.subsingleton_iff R, ← subsingleton_iff_bot_eq_top]
    exact hbot.symm
  · -- (b) `M = N + 𝔪M` forces `M = N`.
    exact top_le_iff.mp
      (Submodule.le_of_le_smul_of_le_jacobson_bot Module.Finite.fg_top hjac h.le)
