#!/usr/bin/env node

import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SOURCE_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

function run(command, args, cwd, expectedStatus = 0) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, GOVERNANCE_ROOT: cwd },
  });
  if (result.error) throw result.error;
  if (result.status !== expectedStatus) {
    throw new Error(
      `${command} ${args.join(" ")} returned ${result.status}, expected ${expectedStatus}\n${result.stdout}\n${result.stderr}`,
    );
  }
  return result;
}

function copyFixture() {
  const root = mkdtempSync(join(tmpdir(), "asu-governance-"));
  cpSync(join(SOURCE_ROOT, "docs"), join(root, "docs"), { recursive: true });
  mkdirSync(join(root, "scripts"), { recursive: true });
  cpSync(
    join(SOURCE_ROOT, "scripts", "governance.mjs"),
    join(root, "scripts", "governance.mjs"),
  );
  for (const name of [
    ".gitignore",
    "AGENTS.md",
    "README.md",
    "CONTRIBUTING.md",
    "LICENSE",
  ]) {
    cpSync(join(SOURCE_ROOT, name), join(root, name));
  }

  run("git", ["init", "-q"], root);
  run("git", ["config", "user.name", "Governance Smoke"], root);
  run("git", ["config", "user.email", "governance-smoke@example.invalid"], root);
  run("git", ["add", "."], root);
  run("git", ["commit", "-qm", "fixture seed"], root);

  const seed = run("git", ["rev-parse", "HEAD"], root).stdout.trim();
  for (const directory of [
    join(root, "docs", "research", "reports"),
    join(root, "docs", "plans"),
    join(root, "docs", "execution"),
  ]) {
    for (const name of readdirSync(directory)) {
      if (!/^[RPE]-\d{3,}\.md$/.test(name)) continue;
      const path = join(directory, name);
      const record = readFileSync(path, "utf8").replace(
        /baseline_commit: "[0-9a-f]{40}"/,
        `baseline_commit: "${seed}"`,
      );
      writeFileSync(path, record, "utf8");
    }
  }
  run("git", ["add", "docs"], root);
  run("git", ["commit", "-qm", "fixture baseline"], root);
  return root;
}

function withFixture(test) {
  const root = copyFixture();
  try {
    test(root);
  } finally {
    const resolvedRoot = resolve(root);
    const resolvedTemp = resolve(tmpdir());
    if (
      dirname(resolvedRoot) !== resolvedTemp ||
      !basename(resolvedRoot).startsWith("asu-governance-")
    ) {
      throw new Error(`refusing to remove unexpected smoke path: ${root}`);
    }
    rmSync(resolvedRoot, { recursive: true, force: true });
  }
}

function expectFailure(result, fragment) {
  const output = `${result.stdout}\n${result.stderr}`;
  if (!output.includes(fragment)) {
    throw new Error(`expected failure fragment ${JSON.stringify(fragment)}\n${output}`);
  }
}

function createResearchFixture(root, title, topic) {
  const reportsDir = join(root, "docs", "research", "reports");
  const before = new Set(readdirSync(reportsDir));
  run(
    process.execPath,
    [
      "scripts/governance.mjs",
      "research-new",
      "--title",
      title,
      "--topic",
      topic,
    ],
    root,
  );
  const created = readdirSync(reportsDir).filter(
    (name) => /^R-\d{3,}\.md$/.test(name) && !before.has(name),
  );
  if (created.length !== 1) {
    throw new Error(
      `research-new created ${created.length} reports, expected exactly one`,
    );
  }
  return {
    id: created[0].slice(0, -3),
    path: join(reportsDir, created[0]),
  };
}

withFixture((root) => {
  run(process.execPath, ["scripts/governance.mjs", "check", "--base", "HEAD"], root);
  const created = createResearchFixture(root, "Smoke report", "smoke-report");
  if (!existsSync(created.path)) throw new Error(`research-new did not create ${created.id}.md`);
  const register = readFileSync(join(root, "docs", "research", "REGISTER.md"), "utf8");
  if (!register.includes(`| ${created.id} |`)) {
    throw new Error(`research-new did not sync ${created.id} to REGISTER.md`);
  }
  run(process.execPath, ["scripts/governance.mjs", "check"], root);
});

withFixture((root) => {
  rmSync(join(root, "docs", "research", "reports", "R-001.md"));
  const result = run(
    process.execPath,
    ["scripts/governance.mjs", "check"],
    root,
    1,
  );
  expectFailure(result, "append-only and cannot be deleted");
});

withFixture((root) => {
  const reportPath = join(root, "docs", "research", "reports", "R-001.md");
  const report = readFileSync(reportPath, "utf8").replace(
    'topic: "research-governance-system"',
    'topic: "reused-topic"',
  );
  writeFileSync(reportPath, report, "utf8");
  const result = run(
    process.execPath,
    ["scripts/governance.mjs", "check", "--base", "HEAD"],
    root,
    1,
  );
  expectFailure(result, "immutable field topic changed");
});

withFixture((root) => {
  writeFileSync(join(root, "docs", ".governance.lock"), "stale lock\n", "utf8");
  const result = run(process.execPath, ["scripts/governance.mjs", "check"], root, 1);
  expectFailure(result, "lock files are transient and must be untracked and absent");
});

withFixture((root) => {
  const reportPath = join(root, "docs", "research", "reports", "R-001.md");
  const report = readFileSync(reportPath, "utf8").replace(
    "- **근거:** SRC-001, SRC-002, SRC-003",
    "- **근거:** SRC-999",
  );
  writeFileSync(reportPath, report, "utf8");
  const result = run(process.execPath, ["scripts/governance.mjs", "check"], root, 1);
  expectFailure(result, "F-001 cites missing SRC-999");
});

withFixture((root) => {
  const reportPath = join(root, "docs", "research", "reports", "R-001.md");
  const report = readFileSync(reportPath, "utf8").replace(
    "review_by: 2026-11-02",
    "review_by: 2026-99-99",
  );
  writeFileSync(reportPath, report, "utf8");
  const result = run(process.execPath, ["scripts/governance.mjs", "check"], root, 1);
  expectFailure(result, "must be a real calendar date");
});

withFixture((root) => {
  const reportPath = join(root, "docs", "research", "reports", "R-001.md");
  const report = readFileSync(reportPath, "utf8").replace(
    "| R-001 / F-001,F-002 | 저장소 내 Markdown R/P/E 계층",
    "| R-999 / F-001,F-002 | 저장소 내 Markdown R/P/E 계층",
  );
  writeFileSync(reportPath, report, "utf8");
  const result = run(process.execPath, ["scripts/governance.mjs", "check"], root, 1);
  expectFailure(result, "Planning handoff must cite its own R-001");
});

withFixture((root) => {
  const planPath = join(root, "docs", "plans", "P-001.md");
  const plan = readFileSync(planPath, "utf8").replace(
    "R-001 / F-001,F-002",
    "R-001 / F-999",
  );
  writeFileSync(planPath, plan, "utf8");
  const result = run(process.execPath, ["scripts/governance.mjs", "check"], root, 1);
  expectFailure(result, "Finding IDs that exist in that report");
});

withFixture((root) => {
  const planPath = join(root, "docs", "plans", "P-001.md");
  const plan = readFileSync(planPath, "utf8").replace("- [x] 모든 관련", "- [ ] 모든 관련");
  writeFileSync(planPath, plan, "utf8");
  const result = run(process.execPath, ["scripts/governance.mjs", "check"], root, 1);
  expectFailure(result, "plan must contain the complete checked approval checklist");
});

withFixture((root) => {
  const planPath = join(root, "docs", "plans", "P-001.md");
  const executionPath = join(root, "docs", "execution", "E-001.md");
  const remapAcceptanceIds = (source) =>
    source.replace(/AC-00([1-7])/g, (_, digit) => `AC-20${digit}`);

  writeFileSync(
    planPath,
    remapAcceptanceIds(readFileSync(planPath, "utf8")),
    "utf8",
  );
  writeFileSync(
    executionPath,
    remapAcceptanceIds(readFileSync(executionPath, "utf8")),
    "utf8",
  );
  run("git", ["add", "docs/plans/P-001.md", "docs/execution/E-001.md"], root);
  run("git", ["commit", "-qm", "fixture non-001 AC range"], root);
  run(process.execPath, ["scripts/governance.mjs", "check", "--base", "HEAD"], root);

  const rangedPlan = readFileSync(planPath, "utf8");
  const planWithGap = rangedPlan.replaceAll("AC-203", "AC-208");
  writeFileSync(planPath, planWithGap, "utf8");
  const result = run(
    process.execPath,
    ["scripts/governance.mjs", "check", "--base", "HEAD"],
    root,
    1,
  );
  expectFailure(result, "AC-ID sequence has a gap; expected AC-203");

  writeFileSync(
    planPath,
    rangedPlan.replaceAll("AC-201", "AC-000"),
    "utf8",
  );
  const zeroResult = run(
    process.execPath,
    ["scripts/governance.mjs", "check", "--base", "HEAD"],
    root,
    1,
  );
  expectFailure(zeroResult, "AC-ID sequence must start with a positive number");
});

withFixture((root) => {
  const reportPath = join(root, "docs", "research", "reports", "R-001.md");
  const report = readFileSync(reportPath, "utf8").replace(
    /baseline_commit: "[0-9a-f]{40}"/,
    'baseline_commit: "0000000000000000000000000000000000000000"',
  );
  writeFileSync(reportPath, report, "utf8");
  const result = run(process.execPath, ["scripts/governance.mjs", "check"], root, 1);
  expectFailure(result, "is not an available commit object");
});

withFixture((root) => {
  const { path: reportPath } = createResearchFixture(
    root,
    "Duplicate topic",
    "duplicate-topic",
  );
  const report = readFileSync(reportPath, "utf8").replace(
    'topic: "duplicate-topic"',
    'topic: "research-governance-system"',
  );
  writeFileSync(reportPath, report, "utf8");
  const result = run(process.execPath, ["scripts/governance.mjs", "check"], root, 1);
  expectFailure(result, "active topic duplicates R-001");
});

withFixture((root) => {
  const { path: reportPath } = createResearchFixture(
    root,
    "Invalid replacement",
    "invalid-replacement",
  );
  const report = readFileSync(reportPath, "utf8").replace(
    "supersedes:\n\n---",
    "supersedes:\n  - R-001\n\n---",
  );
  writeFileSync(reportPath, report, "utf8");
  const result = run(process.execPath, ["scripts/governance.mjs", "check"], root, 1);
  expectFailure(result, "supersedes target R-001 must already have status superseded");
});

withFixture((root) => {
  const executionPath = join(root, "docs", "execution", "E-001.md");
  const execution = readFileSync(executionPath, "utf8").replace(
    "| `npm.cmd ci` | PASS |",
    "| `npm.cmd ci` | FAILED |",
  );
  writeFileSync(executionPath, execution, "utf8");
  const result = run(process.execPath, ["scripts/governance.mjs", "check"], root, 1);
  expectFailure(result, "every verification row in a complete execution must be a populated PASS");
});

withFixture((root) => {
  const executionPath = join(root, "docs", "execution", "E-001.md");
  const execution = readFileSync(executionPath, "utf8").replace(
    "| AC-001 | PASS |",
    "| AC-001 | BLOCKED |",
  );
  writeFileSync(executionPath, execution, "utf8");
  const result = run(process.execPath, ["scripts/governance.mjs", "check"], root, 1);
  expectFailure(result, "every plan acceptance result must be a populated PASS");
});

withFixture((root) => {
  const executionPath = join(root, "docs", "execution", "E-001.md");
  const execution = readFileSync(executionPath, "utf8").replace(
    /(\| `AGENTS\.md`[^\n]*\| )아니요( \|)/,
    "$1$2",
  );
  writeFileSync(executionPath, execution, "utf8");
  const result = run(process.execPath, ["scripts/governance.mjs", "check"], root, 1);
  expectFailure(result, "complete execution needs populated Actual changes rows");
});

withFixture((root) => {
  const planPath = join(root, "docs", "plans", "P-001.md");
  const plan = readFileSync(planPath, "utf8").replace(
    "저장소 전역 필수 게이트와 조사 분리 규칙",
    "완료 후 범위를 다시 확장",
  );
  writeFileSync(planPath, plan, "utf8");
  const result = run(process.execPath, ["scripts/governance.mjs", "check"], root, 1);
  expectFailure(result, 'finalized record section "Change map" cannot change');
});

withFixture((root) => {
  const readmePath = join(root, "README.md");
  writeFileSync(readmePath, `${readFileSync(readmePath, "utf8")}\n`, "utf8");
  const executionPath = join(root, "docs", "execution", "E-001.md");
  writeFileSync(
    executionPath,
    `${readFileSync(executionPath, "utf8")}| 2026-08-02 | finalized reuse attempt | rejected | smoke |\n`,
    "utf8",
  );
  const result = run(process.execPath, ["scripts/governance.mjs", "check"], root, 1);
  expectFailure(
    result,
    "changed product/operation paths require an in-progress or complete E-ID execution record",
  );
});

withFixture((root) => {
  const readmePath = join(root, "README.md");
  writeFileSync(readmePath, `${readFileSync(readmePath, "utf8")}\n`, "utf8");

  const executionPath = join(root, "docs", "execution", "E-001.md");
  const execution = readFileSync(executionPath, "utf8").replace(
    /(\| `README\.md`[^\n]*P-001 \/ R-001 \/ )F-001( \|)/,
    "$1F-999$2",
  );
  writeFileSync(executionPath, execution, "utf8");

  const result = run(
    process.execPath,
    ["scripts/governance.mjs", "check", "--base", "HEAD"],
    root,
    1,
  );
  expectFailure(result, "lacks an exact R/F -> P-001 -> E-001 traceability chain");
});

withFixture((root) => {
  const readmePath = join(root, "README.md");
  writeFileSync(readmePath, `${readFileSync(readmePath, "utf8")}\n`, "utf8");
  const result = run(
    process.execPath,
    ["scripts/governance.mjs", "check"],
    root,
    1,
  );
  expectFailure(result, "no E-ID execution record changed");
});

withFixture((root) => {
  const result = run(
    process.execPath,
    [
      "scripts/governance.mjs",
      "check",
      "--base",
      "0000000000000000000000000000000000000000",
    ],
    root,
    1,
  );
  expectFailure(result, "comparing against Git's empty tree");
});

console.log("[governance-smoke] OK (generation, sync, semantic traceability, dates, approvals, transient locks, finalized-record immutability/reuse, complete evidence, diff and empty-tree gates)");
