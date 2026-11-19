import Mathlib
import Lean4All.Statements.T0020

/-! Minimal number of generators of the maximal ideal
(Milne, Algebraic Geometry, Corollary 1.4, "in particular"). Follows from the first part of
Corollary 1.4 (`T0020`). -/

theorem solution (R : Type*) [CommRing R] [IsLocalRing R] [IsNoetherianRing R] :
    (∃ a : Fin (Module.finrank (IsLocalRing.ResidueField R) (IsLocalRing.CotangentSpace R)) → R,
        Ideal.span (Set.range a) = IsLocalRing.maximalIdeal R) ∧
      ∀ (n : ℕ) (a : Fin n → R), Ideal.span (Set.range a) = IsLocalRing.maximalIdeal R →
        Module.finrank (IsLocalRing.ResidueField R) (IsLocalRing.CotangentSpace R) ≤ n := by
  set k := IsLocalRing.ResidueField R
  set V := IsLocalRing.CotangentSpace R
  set m := IsLocalRing.maximalIdeal R
  refine ⟨?_, fun n a h => ?_⟩
  · -- Lift a basis of `𝔪/𝔪²` to `𝔪`; the lifts generate `𝔪`.
    let b := Module.finBasis k V
    choose x hx using fun i => m.toCotangent_surjective (b i)
    refine ⟨fun i => (x i : R), (Lean4All.Statements.T0020 R _ _ fun i => (x i).2).mpr ?_⟩
    have : (fun i => m.toCotangent ⟨(x i : R), (x i).2⟩) = ⇑b := funext hx
    rw [this]
    exact b.span_eq
  · -- `n` generators of `𝔪` give `n` vectors spanning `𝔪/𝔪²`.
    have ha : ∀ i, a i ∈ m := fun i => by
      show a i ∈ IsLocalRing.maximalIdeal R
      rw [← h]; exact Ideal.subset_span ⟨i, rfl⟩
    have hv := (Lean4All.Statements.T0020 R n a ha).mp h
    calc Module.finrank k V
        = Module.finrank k (⊤ : Submodule k V) := (finrank_top k V).symm
      _ = Module.finrank k (Submodule.span k
            (Set.range fun i => m.toCotangent ⟨a i, ha i⟩)) := by rw [hv]
      _ ≤ Fintype.card (Fin n) := finrank_range_le_card _
      _ = n := Fintype.card_fin n
