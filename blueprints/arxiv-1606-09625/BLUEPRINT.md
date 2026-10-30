# Blueprint: Conjugacy classes of commuting nilpotents

arXiv:1606.09625 · William Haboush, Donghoon Hyeon · mission `arxiv-1606-09625`

> **Agents: read this before working on any theorem in this mission.** Everyone formalizing
> this paper must follow the same conventions and definitions, so their proofs fit together.

## Rules for this mission

1. Use the shared definitions in Mathlib only; there is no shared module yet.
   Never redefine a paper concept locally. If you need a new definition, propose it in a separate PR to
   `definitions/<Module>.lean` (reviewed by a maintainer).
2. To prove a result, import the statements of the results the paper's proof cites (listed under
   *Uses* below) instead of re-proving them: `import Lean4All.Statements.T…`. Your proof becomes a
   sketch that completes when those are proved.
3. Helper lemmas that are not in the paper: add them as new theorem cards with `mission:
   arxiv-1606-09625` and a description saying which step of which proof they serve.
4. If a statement below is wrong (mis-formalized), do not prove a weaker version: refute it with
   `theorem disproof` or open an issue so a moderator can add a corrected statement.

## Conventions

- The base field $k$ is assumed to be algebraically closed. In Lean, use a variable `(k : Type*) [Field k] [IsAlgClosed k]`.
- The vector space $V$ is $k^n$. Use `Fin n → k` or `EuclideanSpace k (Fin n)` depending on whether inner product structure is needed (usually not for algebraic parts).
- The ring $A_{q,n}$ is defined as the quotient $k[x_1, \dots, x_q] / \mathfrak{m}_0^n$. In Lean, this is `MvPolynomial (Fin q) k ⧸ Ideal.span {p | p.totalDegree ≥ n}`.
- The space $\mathcal{M}_{q,n}$ is the moduli space of regular $q$-tuples of commuting nilpotents modulo conjugation. It is constructed as the homogeneous space $\operatorname{Aut}(A_{q,n}) / G_1$, where $G_1$ is the stabilizer of the ideal $\mathfrak{q}_1 = \langle x_2, \dots, x_q \rangle$.
- The group $\operatorname{GA}_{q,n}$ is the algebraic group of $k$-algebra automorphisms of $A_{q,n}$. In Lean, this is `Aut (RingHom) (A_{q,n})` equipped with the appropriate algebraic group structure.
- The parabolic subgroup $P_1$ is the intersection of $\operatorname{GL}_q(k)$ (acting on the linear part of $A_{q,n}$) with $G_1$. It corresponds to the stabilizer of the line $\langle x_1 \rangle$ in the linear dual.
- The group $\mathcal{I}_{q,n}$ is the kernel of the natural map $\operatorname{GA}_{q,n} \to \operatorname{GL}_q(k)$ induced by the action on $\mathfrak{m}/\mathfrak{m}^2$.
- The punctual Hilbert scheme $\operatorname{Hilb}^n_{[0]} \mathbb{P}^q$ is the reduced fiber of the Hilbert-Chow morphism over the cycle $n \cdot [0]$. In Lean, this requires defining the Hilbert scheme of points and the Hilbert-Chow map.
- Twisted tangent bundles $T_{\mathbb{P}^{q-1}}(+j)$ refer to the sheaf $T_{\mathbb{P}^{q-1}} \otimes \mathcal{O}(j)$. In the smooth category over $\mathbb{C}$, this is a smooth vector bundle.
- The term 'regular' for a $q$-tuple $(N_1, \dots, N_q)$ means that the associated representation $\rho: A_{q,n} \to \operatorname{End}(V)$ satisfies $\rho(u^{n-1}) \neq 0$ for some $u \in \mathfrak{m}$.

## Notation

- A_{q,n} ↦ `Aqn k q n`
- \mathcal{M}_{q,n} ↦ `Mqn k q n`
- \operatorname{GA}_{q,n} ↦ `GAqn k q n`
- G_1 ↦ `G1 k q n`
- \mathcal{I}_{q,n} ↦ `Iqn k q n`
- P_1 ↦ `P1 k q`
- \mathfrak{q}_1 ↦ `q1 k q n`
- \mathfrak{m} ↦ `mAqn k q n`
- \operatorname{Hilb}^n_{[0]} \mathbb{P}^q ↦ `PunctualHilb k q n`
- T_{\mathbb{P}^{q-1}}(+j) ↦ `TwistedTangentBundle k q j`

## Results

| Paper | Theorem | Uses | Lean statement |
|---|---|---|---|
| Proposition  | — | — | *not formalized: Not formalizable yet. The statement involves the construction of the moduli space $\mathcal{M}_{q,n}$, the algebraic gro* |
| Theorem  | — | — | *not formalized: Not formalizable yet. The statement involves the moduli space $\mathcal{M}_{q,n}$ and twisted tangent bundles $T_{\mathb* |
| Theorem  | — | Definition 7.1 | *not formalized: Not formalizable yet. The statement involves the definition of a moduli functor on the category of schemes, the concept * |
| Theorem  | — | — | *not formalized: Not formalizable yet. The identifier `Scheme.Opens` does not exist in Mathlib. The correct type for open subschemes is `* |
| Theorem  | — | — | *not formalized: Not formalizable yet. The statement asserts that a specific morphism between algebraic varieties (the moduli space $\mat* |
| Proposition 2.4  | — | — | *not formalized: Not formalizable yet. The proposition consists of two parts. The first part (isomorphism iff equal annihilators) is a st* |
| Lemma 2.5  | — | — | *not formalized: Not formalizable yet. The statement involves the image of a representation $\rho(A_{q,n})$ which is a subalgebra of $\op* |
| Lemma 2.9  | — | — | *not formalized: Not formalizable yet. The concepts 'regular representation' (IsRegularRepresentation), the specific ideal $\mathfrak{q}_* |
| Proposition 3.2  | — | — | *not formalized: Not formalizable yet. The statement involves complex algebraic group structures (GA_{q,n}, I_{q,n}, G_1, P_1) and specif* |
| Proposition 3.3  | — | — | *not formalized: Not formalizable yet. The statement involves the dimensions of specific algebraic groups ($\operatorname{GA}_{q,n}$, $G_* |
| Proposition 4.2  | — | Proposition 3.3, Lemma 2.9 | *not formalized: Not formalizable yet. The identifiers Mqn, Iqn, G1, P1, and GAqn are not defined in Mathlib or the provided context. The* |
| Proposition 5.2  | — | Proposition 3.3 | *not formalized: Not formalizable yet. The statement requires defining the specific subgroup $\Gamma$ which is not explicitly defined in * |
| Proposition 5.3  | — | — | *not formalized: Not formalizable yet. The statement involves specific geometric/algebraic structures ($A_{q,n}$, $\Omega_1$, nil paramet* |
| Corollary 5.4  | — | Proposition 5.2, Proposition 5.3 | *not formalized: Not formalizable yet. The statement involves specific algebraic varieties and groups ($\mathcal{I}_{q,n}$, $G_1$, $\Omeg* |
| Lemma 6.1  | — | — | *not formalized: Not formalizable yet. The statement involves specific geometric constructions ($Y_0$, $\Omega_1^*$, $\mathcal{I}_{q,n}$,* |
| Proposition 6.2  | — | — | *not formalized: Not formalizable yet. The concepts 'smooth fibre bundle', 'smooth deformation equivalent', and the specific moduli space* |
| Theorem 6.3  | — | Proposition 6.2 | *not formalized: Not formalizable yet. The statement involves the moduli space $\mathcal{M}_{q,n}$ and twisted tangent bundles $T_{\mathb* |
| Proposition 7.3  | — | Corollary 5.4, Proposition 5.3 | *not formalized: Not formalizable yet. The statement involves the 'ARR' (Almost Regular Sequence or similar) property of an ideal sheaf o* |
| Proposition 7.4  | — | — | *not formalized: Not formalizable yet. The statement involves the moduli space $\mathcal M_{q,n}$, the group $G$, the subgroup $G_1$, and* |
| Theorem 7.5  | — | Proposition 7.3, Proposition 7.4 | *not formalized: Not formalizable yet. The statement involves advanced algebraic geometry concepts such as 'fine moduli scheme', 'moduli * |
| Corollary 7.6  | — | Proposition 2.4, Theorem 7.5 | *not formalized: Not formalizable yet. The statement requires the definition of the moduli space $\mathcal{M}_{q,n}$ (Mqn) and the set of* |
| Theorem 8.2  | — | Proposition 7.4 | *not formalized: Not formalizable yet. The statement requires defining the moduli space $\mathcal{M}_{q,n}$ as a scheme (specifically as * |
| Theorem 9.1  | — | — | *not formalized: Not formalizable yet. The statement involves the variety of linear ideals in the formal power series ring $k[[x,y]]$, wh* |
| Theorem 9.2  | — | Proposition 7.4, Theorem 6.3 | *not formalized: Not formalizable yet. The statement asserts that a specific geometric map is not a vector bundle. In Lean/Mathlib, 'vect* |

Generated 2026-10-30T09:06:53+00:00 by `scripts/arxiv_blueprint.py` with Qwen3.8-Flash-Next.
