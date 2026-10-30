# Blueprint: SHADOWBENCH: Toward Reliable Automatic Evaluation of Semantic Alignment in Autoformalization

arXiv:2608.29270 · Hojae Han, Jongyoon Kim, Sanghyeok Park, Dongwook Cheon, Yeachan Park, Myeong Jae Jeon, Sunjong Choe, Soonho Kong, Wonseok Hur, Seung-won Hwang, Donghoon Hyeon · mission `None`

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
   None` and a description saying which step of which proof they serve.
4. If a statement below is wrong (mis-formalized), do not prove a weaker version: refute it with
   `theorem disproof` or open an issue so a moderator can add a corrected statement.

## Conventions

- Use `Prop` for all theorem statements. The 'intended formal statement' $T$ and 'generated statement' $\widehat T$ are both of type `Prop`.
- A 'shadow theorem' is represented as a pair `(S : Prop) (hS : S)`, where `S` is the statement and `hS` is the proof.
- A 'complete shadow set' is a `List Prop` (or `Finset Prop`) $\mathcal{S}$ such that $\bigwedge_{S \in \mathcal{S}} S \leftrightarrow T$.
- Forward check for a shadow $S$ is the implication $\widehat T \to S$. In Lean, this is a term of type `\widehat T \to S`.
- Backward check is the implication $(\bigwedge_{S \in \mathcal{S}} S) \to \widehat T$. In Lean, this is a term of type `(\forall S \in \mathcal{S}, S) \to \widehat T` or similar conjunction encoding.
- The metric `SA-Pass` is a boolean-valued function (or `Nat` 0/1) depending on the existence of proofs for the forward and backward checks.
- Compilation is assumed to be handled by the environment; the metric focuses on the logical implications between `Prop`s.
- Use `List` for shadow sets to maintain order if necessary for indexing, though the logical content is order-independent.

## Notation

- T ↦ `T : Prop`
- \widehat T ↦ `T_hat : Prop`
- S_i ↦ `S : Prop`
- \mathcal{S} ↦ `shadows : List Prop`
- T \Rightarrow S ↦ `T \to S`
- S_1 \wedge \cdots \wedge S_n \Rightarrow T ↦ `(\forall S \in shadows, S) \to T`
- \text{SA-Pass}(\widehat T, \mathcal{S}) ↦ `sa_pass T_hat shadows`

## Results

| Paper | Theorem | Uses | Lean statement |
|---|---|---|---|

Generated 2026-10-30T07:17:58+00:00 by `scripts/arxiv_blueprint.py` with Qwen3.8-Flash-Next.
