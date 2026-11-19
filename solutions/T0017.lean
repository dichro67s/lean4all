import Mathlib

/-! Chinese Remainder Theorem (Milne, Algebraic Geometry, Theorem 1.1). -/

theorem solution (R : Type*) [CommRing R] (n : ℕ) (I : Fin n → Ideal R)
    (hI : ∀ i j, i ≠ j → I i ⊔ I j = ⊤) :
    Function.Surjective (RingHom.pi fun i => Ideal.Quotient.mk (I i)) ∧
      RingHom.ker (RingHom.pi fun i => Ideal.Quotient.mk (I i)) = ∏ i, I i ∧
      ∏ i, I i = ⨅ i, I i := by
  have hc : Pairwise (Function.onFun IsCoprime I) := fun i j hij =>
    Ideal.isCoprime_iff_sup_eq.mpr (hI i j hij)
  -- For pairwise coprime ideals the product equals the intersection.
  have hprod : ∏ i, I i = ⨅ i, I i := by
    have := Ideal.prod_eq_iInf_of_pairwise_isCoprime (s := Finset.univ) (J := I)
      (fun i _ j _ hij => hc hij)
    simpa using this
  refine ⟨?_, ?_, hprod⟩
  · intro x
    obtain ⟨r, hr⟩ := Ideal.pi_quotient_surjective hc x
    exact ⟨r, funext hr⟩
  · rw [Ideal.ker_Pi_Quotient_mk, hprod]
