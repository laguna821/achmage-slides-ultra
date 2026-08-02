## Research and plan

- Research: `R-NNN`
- Plan: `P-NNN`
- Execution: `E-NNN`

## Outcome

Describe the user-visible result and the most important Finding that supports it.

## Verification

List the exact commands, exit status, and relevant artifact or observation.

- [ ] The plan traces every decision to `R-NNN / F-NNN`.
- [ ] Every changed product and operation path has an exact `R/F → P → E` table-row chain.
- [ ] Every plan AC-ID appears exactly once in the E-ID and passes before completion.
- [ ] Deviations were written back to the research and plan before implementation continued.
- [ ] Generated `main.js` was rebuilt and reviewed when runtime source changed, or marked not applicable.
- [ ] Version and compatibility files were checked when release metadata changed.
- [ ] `npm run governance:check` passes.
- [ ] Relevant typecheck, build, and acceptance commands pass or are explicitly recorded as blocked.
- [ ] Governance-core changes are owner-authored or have repository-owner approval on the current head commit.

## Residual risk and rollback

State what remains uncertain and the smallest safe rollback unit.
