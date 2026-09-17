---
name: maintain-verification-skill
description: "Explicit-only audit that keeps a project's verification skill and feature map accurate through parallel source review and live verification. Invoke with $maintain-verification-skill."
---

# Maintain a verification skill

A feature map rots as the app changes. This skill is the upkeep loop for a project-local verification skill with a feature map, including one created with `$skill-creator`. The unit of rigor is the feature, not every sentence. Cover every feature file from source and exercise every feature live without turning every bullet into a separate terminal step.

## Outcomes

Pick one, and say which:

- **clean**. Every feature got source and live coverage, and no correction is needed. Do not create a branch or PR.
- **changed**. Proven documentation, harness, or map corrections are ready. Keep them local unless the user authorized branch, commit, push, and PR actions.
- **blocked**. Coverage could not finish or a proven fix could not be completed safely. Say exactly what blocked it.

## Edit scope

Only edit the verification skill's own directory, including its `SKILL.md`, `features/`, and harness scripts. Never edit product code during a run. Behavior that the map describes but the app no longer provides is either documentation drift, which belongs in the map, or a product regression, which belongs in the report.

## Pass

0. **Locate the target.** Find the project-local verification skill whose body has launch and drive sections plus a feature map. In Codex repositories this is usually `.agents/skills/verify-*/`. If several candidates exist, ask which one to maintain. If none exist, stop and suggest creating one with `$skill-creator` instead of inventing a target.

1. **Index hygiene.** Read the feature map README and glob its sibling files. Fix missing, extra, duplicate, or dead entries. Lightweight; no generated inventory.

2. **Source wave.** Assign one read-only subagent to each feature file. Launch them in bounded concurrent waves based on the available agent slots. Each explains how the user-facing feature works from source, flags likely documentation drift with file citations, and returns one concise live-verification recipe. Subagents never drive the app or edit files. Require this return shape: feature summary / source entry points / likely drift or none / one recipe.

3. **Reconcile.** Confirm that every feature file has a returned summary. Merge overlapping recipes into as few app states as practical. Spot-check cited drift and do not re-prove clean claims. Sweep recent churn for user-facing surfaces missing from the map. Require a concrete source path before calling one missing.

4. **Live pass.** Run this even when the source review looks clean. The coordinator owns all driving. Follow the verification skill's launch model: use one long-lived instance driven serially for servers and UIs, or a fresh isolated session per drive for short-lived CLIs. The target skill's Launch section decides.

   Exercise every feature at least once and hold these invariants throughout the pass:

   - Health-check an instance before the first drive, on each fresh session when sessions are the unit, and after any failed drive. If the doctor cannot see a bad UI state on a healthy process, reset to a known state or relaunch.
   - Confirm that captured evidence survives every cleanup at its named location.
   - Clean residue from each drive when it stops being useful, whether the session is stuck, exited, or shared. For a shared instance, clean the residue rather than the instance.

   A doctor failure caused by skill drift is drift. Fix it within the edit scope and retry once. Restart only what the fix invalidated before calling the pass `blocked`. Mark a feature `verified-unreachable` only when the report names the concrete prerequisite, such as authentication, entitlement, operating system, or external state, and the attempted route. If the map omits that prerequisite, treat it as drift. Re-run live verification for any harness fix before reporting it as ready. Perform final teardown after the last drive and any rechecks. Preserve evidence as the target skill requires.

5. **Triage.** Fix wrong or missing user-facing descriptions as documentation drift. Fix working behavior that the harness cannot drive as a harness gap. Keep helper scripts executable and document their invocation in the skill body. Report broken app behavior as a product gap and do not change product code or hide the problem with documentation edits.

6. **Ship or stop.** For `changed`, re-read every changed file first. Open at most one PR of proven corrections only when the user has explicitly authorized the required branch, commit, push, and PR actions. Otherwise leave the changes local and report them. For `clean` or `blocked`, do not create a PR. Report the outcome and coverage.

Keep concise run notes (features covered, unreachable prerequisites, confirmed drift, outcome) in a scratch location; don't commit them.
