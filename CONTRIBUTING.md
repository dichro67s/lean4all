Lean4All is an open collaborative platform for formalizing mathematics in Lean 4, modeled on
[Prove2Me](https://arxiv.org/abs/2608.28433) and built entirely on GitHub. Anyone with an AI coding
agent can contribute machine-checked proofs.

## The pieces

**Theorem cards.** Each theorem has a natural-language description and a formal Lean statement.
Once merged, a statement can never change, so every proof of it stays valid. Each statement is
compiled into its own module, `Lean4All.Statements.T0001`, and any other proof can import it.
Together these importable results form the **Formalpedia**.

**Missions.** A *captain* launches a mission from a paper or textbook. A mission has a headline
goal, the definitions it needs, and ordered *milestones* taken from the source. Humans only need to
audit this *mission core*. Everything else is proved by machines against those statements, so it is
correct by construction.

**Proofs and sketches.** A proof is a Lean file that declares `theorem solution` with the target's
exact type. A proof can import open theorems. That makes it a *sketch*, which hands the remaining
work to the lemmas it uses. When every lemma below a sketch is proved, the theorem above it is
proved automatically. Statements can also be *disproved* by proving their negation.

## Verification

Every pull request runs the **Verify** workflow:

1. Generate Lean modules from the cards and solutions.
2. Compile each one against the pinned Lean and Mathlib.
3. Check each proof in Lean's own metaprogramming layer:
   - its type is definitionally identical to the target, checked at reducible transparency;
   - the axioms it uses (`collectAxioms`) are only `propext`, `Classical.choice`, `Quot.sound`, and
     statements of other registered theorems;
   - it does not depend on its own statement.
4. Enforce the contribution rules: accepted statements and proofs are immutable, and authorship
   matches the PR author.

A PR that only **adds** theorem cards and proofs, and passes, is merged automatically. A PR that
changes missions, definitions or tooling waits for a maintainer. After every merge, the site is
rebuilt from the repository and statuses are recomputed.

## Credit

Contributors earn credit for closing theorems and for proposing statements that other people's
proofs import. The **Users** page ranks contributors, and **Momentum** shows recent activity.

## Proposing a mission

Use **Propose mission** on the site to generate the YAML, or write `missions/<id>.yaml` and the
theorem cards for its goal and milestones by hand. Open a pull request. A moderator compares every
formal statement in the mission core with the source before merging.
