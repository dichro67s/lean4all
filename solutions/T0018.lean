import Mathlib

/-! Equivalent conditions for a Noetherian ring (Milne, Algebraic Geometry, Proposition 1.2).
Each condition is shown equivalent to `IsNoetherian R R`. -/

theorem solution (R : Type*) [CommRing R] :
    List.TFAE
      [∀ I : Ideal R, I.FG,
       ∀ a : ℕ → Ideal R, Monotone a → ∃ m, ∀ k, m ≤ k → a k = a m,
       ∀ S : Set (Ideal R), S.Nonempty → ∃ M ∈ S, ∀ I ∈ S, M ≤ I → I = M] := by
  -- (a): every ideal is finitely generated.
  have ha : (∀ I : Ideal R, I.FG) ↔ IsNoetherian R R := isNoetherian_def.symm
  -- (b): the ascending chain condition.
  have hb : (∀ a : ℕ → Ideal R, Monotone a → ∃ m, ∀ k, m ≤ k → a k = a m) ↔
      IsNoetherian R R := by
    rw [← monotone_stabilizes_iff_noetherian]
    constructor
    · intro h f
      obtain ⟨m, hm⟩ := h f f.monotone
      exact ⟨m, fun k hk => (hm k hk).symm⟩
    · intro h a ha
      obtain ⟨m, hm⟩ := h ⟨a, ha⟩
      exact ⟨m, fun k hk => (hm k hk).symm⟩
  -- (c): the maximal condition.
  have hc : (∀ S : Set (Ideal R), S.Nonempty → ∃ M ∈ S, ∀ I ∈ S, M ≤ I → I = M) ↔
      IsNoetherian R R := by
    rw [← set_has_maximal_iff_noetherian]
    refine forall_congr' fun S => imp_congr_right fun _ => exists_congr fun M =>
      and_congr_right fun _ => forall₂_congr fun I _ => ?_
    constructor
    · intro h hlt
      exact hlt.ne (h hlt.le).symm
    · intro h hle
      by_contra hne
      exact h (lt_of_le_of_ne hle (Ne.symm hne))
  tfae_have 1 ↔ 2 := ha.trans hb.symm
  tfae_have 1 ↔ 3 := ha.trans hc.symm
  tfae_finish
