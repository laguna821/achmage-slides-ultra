# Contributing to Achmage Slides Ultra

Thank you for helping improve Achmage Slides Ultra. This repository treats research, implementation, generated artifacts, and release evidence as one traceable change. Please keep pull requests focused and preserve the deterministic parser, Pretext measurement, and overflow behavior unless an approved plan explicitly changes them.

## Development setup

Use Node.js 24 and npm. Start every clean verification run from the lockfile:

```bash
npm ci
```

On Windows PowerShell, use `npm.cmd` in place of `npm` if the script execution policy blocks `npm.ps1`.

## Research before implementation

Repository changes follow the rules in [`AGENTS.md`](AGENTS.md):

1. Find the relevant topic in [`docs/research/REGISTER.md`](docs/research/REGISTER.md) and read only the linked reports that govern your change.
2. If the decision is new or the evidence is stale, update the existing `R-NNN` or create a new one before planning. Do not reuse or delete IDs.
3. Make implementation decisions traceable from `R-NNN / F-NNN` findings in an approved `docs/plans/P-NNN.md`.
4. Create the matching `docs/execution/E-NNN.md` before changing product or operational files.
5. Record the real commands, results, changed paths, deviations, generated-artifact review, residual risks, and one final PASS for every AC-ID.

Useful governance commands are:

```bash
npm run research:sync
npm run governance:smoke
npm run governance:check -- --base <merge-base>
```

The repository READMEs under `docs/research`, `docs/plans`, and `docs/execution` explain ID creation and status transitions. Changes to governance core files require repository-owner authorship or approval on the current PR head.

## Build and acceptance checks

Run the checks relevant to your change, and record their exit status in the execution record and pull request. The normal product suite is:

```bash
npm run typecheck
npm run build
npm run acceptance:navigation
npm run acceptance:overflow
npm run acceptance:all
```

`acceptance:navigation` exercises the shared Live Preview/export navigation shell in a browser, including reading-order traversal, keyboard ownership, accessibility state, and responsive geometry. `acceptance:overflow` protects deterministic pagination. `acceptance:all` is the consolidated gate; running the focused command first usually gives faster feedback.

For dependency or Community Scorecard work, also run both audit scopes:

```bash
npm run lint
npm run scorecard:preflight
npm audit --omit=dev
npm audit
```

Run the preflight after a production build so its esbuild metadata and bundle checks describe the candidate artifact. Do not claim that a local lint or preflight result is equivalent to Obsidian's Developer Dashboard or public Community Scorecard scan.

## Generated `main.js`

`main.js` is a committed release artifact. Never edit it by hand.

- If runtime source, runtime dependencies, or build configuration changes, run a clean production build and include the resulting `main.js` in the same pull request. A release plan may consolidate it in a final artifact commit after preserving each tranche's comparison evidence.
- Review the generated diff and record its size/hash or other material characteristics in the execution record.
- If a source-only cleanup is expected to be runtime-erased, compare clean builds before and after instead of assuming byte parity.
- Documentation-only changes do not require rebuilding `main.js`; state that it was not applicable.

## Pull requests

- Use a focused branch and small, reversible commits. Keep navigation, dependency, CSS, generated-artifact, and release-workflow tranches separable when their rollback conditions differ.
- Fill in the PR template with the governing R/P/E IDs, the user-visible outcome, exact verification commands, residual risks, and the smallest rollback unit.
- Keep unrelated working-tree changes out of the PR. Never silently work around research evidence; revise the report and plan first if implementation discovers a conflict.
- Do not hand-edit generated demo `.slides.html` files. Regenerate them from the Markdown source with the final renderer when the plan requires exported demos.
- Ensure `npm run governance:smoke` and `npm run governance:check -- --base <merge-base>` pass before requesting final review.

## Release changes

A release PR must keep `package.json`, both the top-level and root package versions in `package-lock.json`, `manifest.json`, `versions.json`, and the cleanly generated `main.js` on the same version. The release tag must identify the exact reviewed commit.

Release automation creates a draft for human review. Verify the exact tag checkout, clean-build parity, the three distributable assets (`main.js`, `manifest.json`, and `styles.css`), hashes/provenance attestations, governance and quality checks, and the candidate Community Scorecard result before publishing. Do not replace an already published tag or asset; issue a forward-fix version instead.

Protect release-tag patterns such as `*.*.*` from force updates and deletion in the repository rules. The workflow checks the annotated tag and `main` immediately before and after draft creation, but the owner must repeat that identity check before manual publication because draft releases are still mutable.
