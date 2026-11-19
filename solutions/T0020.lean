import Mathlib
import Lean4All.Statements.T0019

/-! Generators of the maximal ideal and the cotangent space
(Milne, Algebraic Geometry, Corollary 1.4). As in the book, the hard direction is Nakayama's lemma
(Proposition 1.3, `T0019`) applied to the finitely generated module `𝔪`. -/

theorem solution (R : Type*) [CommRing R] [IsLocalRing R] [IsNoetherianRing R] (n : ℕ)
    (a : Fin n → R) (ha : ∀ i, a i ∈ IsLocalRing.maximalIdeal R) :
    Ideal.span (Set.range a) = IsLocalRing.maximalIdeal R ↔
      Submodule.span (IsLocalRing.ResidueField R)
        (Set.range fun i => (IsLocalRing.maximalIdeal R).toCotangent ⟨a i, ha i⟩) = ⊤ := by
  set m := IsLocalRing.maximalIdeal R
  set s : Set m := Set.range fun i => (⟨a i, ha i⟩ : m)
  -- A submodule `N ⊆ 𝔪` maps onto `𝔪/𝔪²` iff `𝔪 = N + 𝔪²`, iff (Nakayama) `N = 𝔪`.
  -- `𝔪` is finitely generated because `R` is Noetherian.
  have key : ∀ N : Submodule R m, N.map m.toCotangent = ⊤ ↔ N = ⊤ := by
    intro N
    refine ⟨fun H => (Lean4All.Statements.T0019 R m).2 N ?_,
      fun H => by rw [H, Submodule.map_top, m.toCotangent_range]⟩
    have hker : LinearMap.ker m.toCotangent = m • (⊤ : Submodule R m) := Submodule.ker_mkQ _
    rw [← hker, ← Submodule.comap_map_eq, H, Submodule.comap_top]
  -- Spanning over `k = R/𝔪` is the same as spanning over `R`.
  have hspan : Submodule.span (IsLocalRing.ResidueField R) (m.toCotangent '' s) = ⊤ ↔
      Submodule.span R s = ⊤ := by
    rw [← key, ← (Submodule.restrictScalars_injective R ..).eq_iff,
      Submodule.restrictScalars_span]
    · simp
    · exact Ideal.Quotient.mk_surjective
  have himg : m.toCotangent '' s = Set.range fun i => m.toCotangent ⟨a i, ha i⟩ := by
    rw [← Set.range_comp]; rfl
  -- Generating `𝔪` as a module over `R` is generating it as an ideal.
  have hsub : Submodule.span R s = ⊤ ↔ Ideal.span (Set.range a) = m := by
    rw [← (Submodule.map_injective_of_injective m.injective_subtype).eq_iff, Submodule.map_span,
      Submodule.map_top, Submodule.range_subtype, ← Set.range_comp]
    rfl
  rw [← himg, hspan, hsub]
