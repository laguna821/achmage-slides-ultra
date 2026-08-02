#!/usr/bin/env node

import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const ROOT = process.env.GOVERNANCE_ROOT
  ? resolve(process.env.GOVERNANCE_ROOT)
  : SCRIPT_ROOT;
const DOCS_DIR = join(ROOT, "docs");
const RESEARCH_DIR = join(DOCS_DIR, "research");
const REPORTS_DIR = join(RESEARCH_DIR, "reports");
const PLANS_DIR = join(DOCS_DIR, "plans");
const EXECUTION_DIR = join(DOCS_DIR, "execution");
const REGISTER_PATH = join(RESEARCH_DIR, "REGISTER.md");
const LOCK_PATH = join(DOCS_DIR, ".governance.lock");
const REGISTER_START = "<!-- research-register:start -->";
const REGISTER_END = "<!-- research-register:end -->";

const REPORT_STATUSES = new Set([
  "draft",
  "in-progress",
  "complete",
  "needs-refresh",
  "superseded",
]);
const PLAN_STATUSES = new Set([
  "draft",
  "approved",
  "in-progress",
  "complete",
  "superseded",
]);
const EXECUTION_STATUSES = new Set([
  "in-progress",
  "blocked",
  "complete",
  "superseded",
]);

const REPORT_HEADINGS = [
  "Executive summary",
  "Research brief",
  "Scope",
  "Baseline and method",
  "Current-state evidence",
  "Findings",
  "Alternatives considered",
  "Impact analysis",
  "Contradictions, uncertainties, and open questions",
  "Recommendations",
  "Planning handoff",
  "Source register",
  "Revision log",
];
const PLAN_HEADINGS = [
  "Outcome",
  "Research inputs and freshness",
  "Requirements and non-goals",
  "Research traceability",
  "Change map",
  "Implementation sequence",
  "Verification strategy",
  "Risks and rollback",
  "Documentation and release impact",
  "Approval checklist",
  "Revision log",
];
const EXECUTION_HEADINGS = [
  "Execution summary",
  "Inputs",
  "Actual changes",
  "Deviations from plan",
  "Verification evidence",
  "Acceptance traceability",
  "Residual risks and follow-ups",
  "Release and rollback notes",
  "Execution log",
];
const PLAN_APPROVAL_ITEMS = [
  "모든 관련 R-ID와 Finding을 읽었다.",
  "오래되거나 충돌하는 근거를 확인했다.",
  "비범위와 롤백을 명시했다.",
  "검증 명령과 인수 조건이 구체적이다.",
  "명시적인 실행 요청 또는 승인이 있다.",
];

const REQUIRED_REPORT_META = [
  "id",
  "title",
  "topic",
  "status",
  "created",
  "updated",
  "review_by",
  "baseline_commit",
];
const REQUIRED_PLAN_META = [
  "id",
  "title",
  "status",
  "created",
  "updated",
  "baseline_commit",
  "research",
];
const REQUIRED_EXECUTION_META = [
  "id",
  "title",
  "status",
  "created",
  "updated",
  "baseline_commit",
  "plan",
  "research",
];

function normalizeNewlines(value) {
  return value.replace(/\r\n?/g, "\n");
}

function readText(path) {
  return normalizeNewlines(readFileSync(path, "utf8"));
}

function toRepoPath(path) {
  return relative(ROOT, path).replaceAll("\\", "/");
}

function yamlQuote(value) {
  return JSON.stringify(String(value));
}

function parseScalar(raw) {
  const value = raw.trim();
  if (value === "[]") return [];
  if (value.startsWith("[") && value.endsWith("]")) {
    const inner = value.slice(1, -1).trim();
    if (!inner) return [];
    return inner.split(",").map((item) => parseScalar(item));
  }
  if (value.startsWith('"') && value.endsWith('"')) {
    try {
      return JSON.parse(value);
    } catch {
      return value.slice(1, -1);
    }
  }
  if (value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1).replaceAll("''", "'");
  }
  return value;
}

function parseDocumentText(path, input) {
  const text = normalizeNewlines(input);
  const match = text.match(/^---\n([\s\S]*?)\n---(?:\n|$)/);
  if (!match) {
    throw new Error("missing YAML frontmatter");
  }

  const data = {};
  let listKey = null;
  for (const line of match[1].split("\n")) {
    const field = line.match(/^([A-Za-z][A-Za-z0-9_-]*):(?:\s*(.*))?$/);
    if (field) {
      const [, key, raw = ""] = field;
      if (raw.trim() === "") {
        data[key] = [];
        listKey = key;
      } else {
        data[key] = parseScalar(raw);
        listKey = null;
      }
      continue;
    }

    const item = listKey ? line.match(/^\s+-\s+(.+?)\s*$/) : null;
    if (item) {
      data[listKey].push(parseScalar(item[1]));
      continue;
    }

    if (line.trim() && !line.trimStart().startsWith("#")) {
      throw new Error(`unsupported frontmatter syntax: ${line}`);
    }
  }

  return {
    path,
    fileName: path.split(/[\\/]/).at(-1),
    repoPath: toRepoPath(path),
    text,
    body: text.slice(match[0].length),
    data,
  };
}

function parseDocument(path) {
  return parseDocumentText(path, readText(path));
}

function listRecordFiles(dir, prefix) {
  if (!existsSync(dir)) return [];
  const pattern = new RegExp(`^${prefix}-\\d{3,}\\.md$`);
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && pattern.test(entry.name))
    .map((entry) => join(dir, entry.name))
    .sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
}

function loadRecords(dir, prefix, errors = null) {
  const records = [];
  for (const path of listRecordFiles(dir, prefix)) {
    try {
      records.push(parseDocument(path));
    } catch (error) {
      const message = `${toRepoPath(path)}: ${error.message}`;
      if (errors) errors.push(message);
      else throw new Error(message);
    }
  }
  return records;
}

function validateRecordDirectory(dir, prefix, allowedNames, errors) {
  if (!existsSync(dir)) {
    errors.push(`${toRepoPath(dir)}: missing directory`);
    return;
  }
  const pattern = new RegExp(`^${prefix}-\\d{3,}\\.md$`);
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (
      entry.isFile() &&
      entry.name.endsWith(".md") &&
      !pattern.test(entry.name) &&
      !allowedNames.has(entry.name)
    ) {
      errors.push(
        `${toRepoPath(join(dir, entry.name))}: unexpected Markdown filename; use ${prefix}-NNN.md`,
      );
    }
  }
}

function parseOptions(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      throw new Error(`unexpected argument: ${token}`);
    }

    const equals = token.indexOf("=");
    const key = token.slice(2, equals === -1 ? undefined : equals);
    let value = true;
    if (equals !== -1) {
      value = token.slice(equals + 1);
    } else if (argv[index + 1] && !argv[index + 1].startsWith("--")) {
      value = argv[index + 1];
      index += 1;
    }

    if (Object.hasOwn(options, key)) {
      options[key] = Array.isArray(options[key])
        ? [...options[key], value]
        : [options[key], value];
    } else {
      options[key] = value;
    }
  }
  return options;
}

function optionList(value) {
  if (value === undefined || value === true) return [];
  return (Array.isArray(value) ? value : [value])
    .flatMap((item) => String(item).split(","))
    .map((item) => item.trim())
    .filter(Boolean);
}

function requireOption(options, name) {
  const value = options[name];
  if (value === undefined || value === true || String(value).trim() === "") {
    throw new Error(`missing required option --${name}`);
  }
  return String(value).trim();
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function addDays(dateString, days) {
  const date = new Date(`${dateString}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function gitHead() {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "unknown";
  }
}

function idNumber(id) {
  const match = String(id).match(/^[RPE]-(\d{3,})$/);
  return match ? Number.parseInt(match[1], 10) : Number.NaN;
}

function nextId(records, prefix) {
  const highest = records.reduce((max, record) => {
    const value = idNumber(record.data.id);
    return Number.isFinite(value) ? Math.max(max, value) : max;
  }, 0);
  return `${prefix}-${String(highest + 1).padStart(3, "0")}`;
}

function writeNewFile(path, content) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, normalizeNewlines(content), { encoding: "utf8", flag: "wx" });
}

function writeAtomic(path, content) {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
  try {
    writeFileSync(temporary, normalizeNewlines(content), "utf8");
    renameSync(temporary, path);
  } finally {
    if (existsSync(temporary)) rmSync(temporary, { force: true });
  }
}

function withLock(action) {
  mkdirSync(DOCS_DIR, { recursive: true });
  let descriptor;
  try {
    descriptor = openSync(LOCK_PATH, "wx");
    writeFileSync(
      descriptor,
      `${JSON.stringify({ pid: process.pid, created: new Date().toISOString() })}\n`,
      "utf8",
    );
  } catch (error) {
    if (error.code === "EEXIST") {
      throw new Error(
        `governance lock already exists at ${toRepoPath(LOCK_PATH)}; verify no generator is running before removing it`,
      );
    }
    throw error;
  }

  try {
    return action();
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
    rmSync(LOCK_PATH, { force: true });
  }
}

function escapeTableCell(value) {
  return String(value).replaceAll("|", "\\|").replaceAll("\n", " ").trim();
}

function sortById(records) {
  return [...records].sort((a, b) => idNumber(a.data.id) - idNumber(b.data.id));
}

function renderRegisterBlock(records) {
  const lines = [
    REGISTER_START,
    "| ID | Topic | Title | Status | Updated | Review by | Report |",
    "|---|---|---|---|---|---|---|",
  ];
  for (const record of sortById(records)) {
    const { id, topic, title, status, updated, review_by: reviewBy } = record.data;
    lines.push(
      `| ${escapeTableCell(id)} | \`${escapeTableCell(topic)}\` | ${escapeTableCell(title)} | ${escapeTableCell(status)} | ${escapeTableCell(updated)} | ${escapeTableCell(reviewBy)} | [open](reports/${escapeTableCell(id)}.md) |`,
    );
  }
  lines.push(REGISTER_END);
  return lines.join("\n");
}

function replaceRegisterBlock(register, block) {
  const start = register.indexOf(REGISTER_START);
  const end = register.indexOf(REGISTER_END);
  if (start === -1 || end === -1 || end < start) {
    throw new Error("REGISTER.md is missing the generated block markers");
  }
  return `${register.slice(0, start)}${block}${register.slice(end + REGISTER_END.length)}`;
}

function syncRegister({ quiet = false } = {}) {
  const reports = loadRecords(REPORTS_DIR, "R");
  const current = readText(REGISTER_PATH);
  const next = replaceRegisterBlock(current, renderRegisterBlock(reports));
  if (next !== current) writeAtomic(REGISTER_PATH, next);
  if (!quiet) {
    console.log(
      `[governance] research register ${next === current ? "already current" : "updated"} (${reports.length} report(s))`,
    );
  }
  return reports;
}

function renderList(values) {
  return values.length ? values.map((value) => `  - ${value}`).join("\n") : "";
}

function renderReport({
  id,
  title,
  topic,
  date,
  reviewBy,
  baseline,
  related,
  supersedes,
}) {
  let template = readText(join(RESEARCH_DIR, "TEMPLATE.md"));
  template = template.replace('id: R-NNN', `id: ${id}`);
  template = template.replace('title: "조사 제목"', `title: ${yamlQuote(title)}`);
  template = template.replace('topic: "decision-topic-key"', `topic: ${yamlQuote(topic)}`);
  template = template.replace('created: YYYY-MM-DD', `created: ${date}`);
  template = template.replace('updated: YYYY-MM-DD', `updated: ${date}`);
  template = template.replace('review_by: YYYY-MM-DD', `review_by: ${reviewBy}`);
  template = template.replace(
    'baseline_commit: "git commit SHA"',
    `baseline_commit: ${yamlQuote(baseline)}`,
  );
  template = template.replace(
    "related:\nsupersedes:",
    `related:\n${renderList(related)}${related.length ? "\n" : ""}supersedes:\n${renderList(supersedes)}`,
  );
  template = template.replaceAll("R-NNN", id);
  template = template.replaceAll("조사 제목", title);
  template = template.replaceAll("YYYY-MM-DD", date);
  return template;
}

function renderPlan({ id, title, date, baseline, research }) {
  let template = readText(join(PLANS_DIR, "TEMPLATE.md"));
  template = template.replace('id: P-NNN', `id: ${id}`);
  template = template.replace('title: "계획 제목"', `title: ${yamlQuote(title)}`);
  template = template.replace('created: YYYY-MM-DD', `created: ${date}`);
  template = template.replace('updated: YYYY-MM-DD', `updated: ${date}`);
  template = template.replace(
    'baseline_commit: "git commit SHA"',
    `baseline_commit: ${yamlQuote(baseline)}`,
  );
  template = template.replace("research:\n  - R-NNN", `research:\n${renderList(research)}`);
  template = template.replace(
    "| R-NNN | F-001 |  |  |",
    research.map((reportId) => `| ${reportId} | F-001 |  |  |`).join("\n"),
  );
  template = template.replace(
    "| R-NNN / F-001 |  |  |  |",
    research.map((reportId) => `| ${reportId} / F-001 |  |  |  |`).join("\n"),
  );
  template = template.replaceAll("P-NNN", id);
  template = template.replaceAll("R-NNN", research[0]);
  template = template.replaceAll("계획 제목", title);
  template = template.replaceAll("YYYY-MM-DD", date);
  return template;
}

function renderExecution({ id, title, date, baseline, plan, research }) {
  let template = readText(join(EXECUTION_DIR, "TEMPLATE.md"));
  template = template.replace('id: E-NNN', `id: ${id}`);
  template = template.replace('title: "실행 제목"', `title: ${yamlQuote(title)}`);
  template = template.replace('created: YYYY-MM-DD', `created: ${date}`);
  template = template.replace('updated: YYYY-MM-DD', `updated: ${date}`);
  template = template.replace(
    'baseline_commit: "git commit SHA"',
    `baseline_commit: ${yamlQuote(baseline)}`,
  );
  template = template.replace('plan: P-NNN', `plan: ${plan}`);
  template = template.replace("research:\n  - R-NNN", `research:\n${renderList(research)}`);
  template = template.replaceAll("E-NNN", id);
  template = template.replaceAll("P-NNN", plan);
  template = template.replaceAll("R-NNN", research[0]);
  template = template.replaceAll("실행 제목", title);
  template = template.replaceAll("YYYY-MM-DD", date);
  return template;
}

function validateIdList(ids, prefix, label) {
  if (!Array.isArray(ids) || ids.length === 0) {
    throw new Error(`${label} must contain at least one ${prefix}-ID`);
  }
  for (const id of ids) {
    if (!new RegExp(`^${prefix}-\\d{3,}$`).test(String(id))) {
      throw new Error(`invalid ${label} ID: ${id}`);
    }
  }
}

function createResearch(options) {
  const title = requireOption(options, "title");
  const topic = requireOption(options, "topic");
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(topic)) {
    throw new Error("--topic must be a lowercase kebab-case key");
  }
  const validDays = Number.parseInt(String(options["valid-days"] ?? "90"), 10);
  if (!Number.isInteger(validDays) || validDays < 1 || validDays > 3650) {
    throw new Error("--valid-days must be an integer between 1 and 3650");
  }
  const related = optionList(options.related);
  const supersedes = optionList(options.supersedes);
  if ([...related, ...supersedes].some((id) => !/^R-\d{3,}$/.test(id))) {
    throw new Error("--related and --supersedes values must be R-IDs");
  }

  return withLock(() => {
    const reports = loadRecords(REPORTS_DIR, "R");
    const reportMap = new Map(reports.map((report) => [report.data.id, report]));
    for (const id of [...related, ...supersedes]) {
      if (!reportMap.has(id)) throw new Error(`unknown related report: ${id}`);
    }
    for (const id of supersedes) {
      if (reportMap.get(id).data.status !== "superseded") {
        throw new Error(
          `${id} must be marked superseded before a replacement report is created`,
        );
      }
    }
    const duplicate = reports.find(
      (report) =>
        report.data.topic === topic &&
        report.data.status !== "superseded",
    );
    if (duplicate) {
      throw new Error(
        `topic ${yamlQuote(topic)} is already owned by ${duplicate.data.id}; update that report or choose a genuinely different decision key`,
      );
    }

    const id = nextId(reports, "R");
    const date = today();
    const path = join(REPORTS_DIR, `${id}.md`);
    const content = renderReport({
      id,
      title,
      topic,
      date,
      reviewBy: addDays(date, validDays),
      baseline: gitHead(),
      related,
      supersedes,
    });

    const preview = parseDocumentText(path, content);
    const previewErrors = [];
    validateReports([...reports, preview], previewErrors, []);
    if (previewErrors.length > 0) {
      throw new Error(`generated report is invalid: ${previewErrors.join("; ")}`);
    }

    if (options["dry-run"] === true) {
      console.log(`[governance] dry run: would create ${toRepoPath(path)}`);
      return;
    }

    writeNewFile(path, content);
    syncRegister({ quiet: true });
    console.log(`[governance] created ${id}: ${toRepoPath(path)}`);
  });
}

function createPlan(options) {
  const title = requireOption(options, "title");
  const research = optionList(options.research);
  validateIdList(research, "R", "--research");

  return withLock(() => {
    const reports = loadRecords(REPORTS_DIR, "R");
    const reportMap = new Map(reports.map((record) => [record.data.id, record]));
    for (const id of research) {
      const report = reportMap.get(id);
      if (!report) throw new Error(`unknown research report: ${id}`);
      if (report.data.status !== "complete") {
        throw new Error(`${id} is ${report.data.status}; plans require complete research`);
      }
      if (report.data.review_by < today()) {
        throw new Error(`${id} passed review_by ${report.data.review_by}; refresh it first`);
      }
    }

    const plans = loadRecords(PLANS_DIR, "P");
    const id = nextId(plans, "P");
    const date = today();
    const path = join(PLANS_DIR, `${id}.md`);
    const content = renderPlan({ id, title, date, baseline: gitHead(), research });

    const preview = parseDocumentText(path, content);
    const previewErrors = [];
    validatePlans([...plans, preview], reportMap, previewErrors);
    if (previewErrors.length > 0) {
      throw new Error(`generated plan is invalid: ${previewErrors.join("; ")}`);
    }

    if (options["dry-run"] === true) {
      console.log(`[governance] dry run: would create ${toRepoPath(path)}`);
      return;
    }

    writeNewFile(path, content);
    console.log(`[governance] created ${id}: ${toRepoPath(path)}`);
  });
}

function createExecution(options) {
  const title = requireOption(options, "title");
  const planId = requireOption(options, "plan");
  if (!/^P-\d{3,}$/.test(planId)) throw new Error("--plan must be a P-ID");

  return withLock(() => {
    const plans = loadRecords(PLANS_DIR, "P");
    const plan = plans.find((record) => record.data.id === planId);
    if (!plan) throw new Error(`unknown plan: ${planId}`);
    if (!new Set(["approved", "in-progress"]).has(plan.data.status)) {
      throw new Error(`${planId} is ${plan.data.status}; approve the plan before execution`);
    }
    validateIdList(plan.data.research, "R", `${planId} research`);

    const executions = loadRecords(EXECUTION_DIR, "E");
    const id = nextId(executions, "E");
    const date = today();
    const path = join(EXECUTION_DIR, `${id}.md`);
    const content = renderExecution({
      id,
      title,
      date,
      baseline: gitHead(),
      plan: planId,
      research: plan.data.research,
    });

    const preview = parseDocumentText(path, content);
    const previewErrors = [];
    const reportMap = new Map(
      loadRecords(REPORTS_DIR, "R").map((record) => [record.data.id, record]),
    );
    const planMap = new Map(plans.map((record) => [record.data.id, record]));
    validateExecutions([...executions, preview], reportMap, planMap, previewErrors);
    if (previewErrors.length > 0) {
      throw new Error(`generated execution is invalid: ${previewErrors.join("; ")}`);
    }

    if (options["dry-run"] === true) {
      console.log(`[governance] dry run: would create ${toRepoPath(path)}`);
      return;
    }

    writeNewFile(path, content);
    console.log(`[governance] created ${id}: ${toRepoPath(path)}`);
  });
}

function hasValue(value) {
  return Array.isArray(value) ? value.length > 0 : String(value ?? "").trim() !== "";
}

function validateRequiredMetadata(record, names, errors) {
  for (const name of names) {
    if (!hasValue(record.data[name])) {
      errors.push(`${record.repoPath}: missing or empty frontmatter field ${name}`);
    }
  }
}

const baselineCommitCache = new Map();

function validateBaselineCommit(record, errors) {
  const sha = String(record.data.baseline_commit ?? "");
  if (!/^[0-9a-f]{40}$/.test(sha)) {
    errors.push(
      `${record.repoPath}: baseline_commit must be a full lowercase 40-character Git commit SHA`,
    );
    return;
  }

  if (!baselineCommitCache.has(sha)) {
    try {
      execFileSync("git", ["cat-file", "-e", `${sha}^{commit}`], {
        cwd: ROOT,
        stdio: ["ignore", "ignore", "ignore"],
      });
      baselineCommitCache.set(sha, true);
    } catch {
      baselineCommitCache.set(sha, false);
    }
  }
  if (!baselineCommitCache.get(sha)) {
    errors.push(
      `${record.repoPath}: baseline_commit ${sha} is not an available commit object; fetch full history or correct the record`,
    );
  }
}

function validateDates(record, names, errors) {
  for (const name of names) {
    const value = record.data[name];
    if (value !== undefined && !isCanonicalDate(value)) {
      errors.push(`${record.repoPath}: ${name} must be a real calendar date in YYYY-MM-DD form`);
    }
  }
}

function isCanonicalDate(value) {
  const text = String(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  const parsed = new Date(`${text}T00:00:00.000Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === text;
}

function validateHeadings(record, headings, errors) {
  for (const heading of headings) {
    if (!record.body.includes(`## ${heading}`)) {
      errors.push(`${record.repoPath}: missing section "## ${heading}"`);
    }
  }
}

function sectionText(record, heading) {
  const marker = `## ${heading}`;
  const start = record.body.indexOf(marker);
  if (start === -1) return "";
  const contentStart = start + marker.length;
  const next = record.body.slice(contentStart).search(/\n## /);
  return next === -1
    ? record.body.slice(contentStart)
    : record.body.slice(contentStart, contentStart + next);
}

function markdownTableRows(section) {
  return section
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("|") && line.endsWith("|"))
    .map((line) => line.slice(1, -1).split("|").map((cell) => cell.trim()))
    .filter(
      (cells) =>
        cells.length > 0 &&
        !cells.every((cell) => /^:?-{3,}:?$/.test(cell.replaceAll(" ", ""))),
    );
}

function dataRows(record, heading, idPattern) {
  return markdownTableRows(sectionText(record, heading)).filter((cells) =>
    idPattern.test(cells[0] ?? ""),
  );
}

function referencedIds(value, prefix) {
  const pattern = new RegExp(`\\b${prefix}-\\d{3,}\\b`, "g");
  return [...String(value ?? "").matchAll(pattern)].map((match) => match[0]);
}

function codeSpanValues(value) {
  return [...String(value ?? "").matchAll(/`([^`\n]+)`/g)].map((match) => match[1]);
}

function exactPathRows(record, heading) {
  return markdownTableRows(sectionText(record, heading))
    .map((row) => {
      const match = String(row[0] ?? "").match(/^`([^`]+)`$/);
      return match ? { path: match[1], row } : null;
    })
    .filter(Boolean);
}

function planAcceptanceRows(plan) {
  return dataRows(plan, "Verification strategy", /^AC-\d{3,}$/);
}

function planTraceabilityRows(plan) {
  return dataRows(plan, "Research traceability", /^R-\d{3,}\s*\/\s*F-/);
}

function hasPathTraceabilityChain(path, execution, plan, reportMap) {
  const planResearch = Array.isArray(plan?.data.research) ? plan.data.research : [];
  const executionResearch = Array.isArray(execution.data.research)
    ? execution.data.research
    : [];
  const changeMapped = exactPathRows(plan, "Change map").some(
    (entry) => entry.path === path,
  );
  if (!changeMapped) return false;

  const traceRows = planTraceabilityRows(plan).filter((row) =>
    codeSpanValues(row[2]).includes(path),
  );
  if (traceRows.length === 0) return false;

  const actualRows = exactPathRows(execution, "Actual changes")
    .filter((entry) => entry.path === path)
    .map((entry) => entry.row);

  return actualRows.some((actualRow) => {
    const planIds = [...new Set(referencedIds(actualRow[2], "P"))];
    const researchIds = [...new Set(referencedIds(actualRow[2], "R"))];
    const findingIds = [...new Set(referencedIds(actualRow[2], "F"))];
    if (
      planIds.length !== 1 ||
      planIds[0] !== execution.data.plan ||
      researchIds.length === 0 ||
      findingIds.length === 0 ||
      researchIds.some(
        (id) => !planResearch.includes(id) || !executionResearch.includes(id),
      ) ||
      findingIds.some((findingId) =>
        !researchIds.some((researchId) => {
          const report = reportMap.get(researchId);
          return report && reportFindingIds(report).has(findingId);
        }),
      )
    ) {
      return false;
    }

    return traceRows.some((traceRow) => {
      const traceResearch = [...new Set(referencedIds(traceRow[0], "R"))];
      const traceFindings = [...new Set(referencedIds(traceRow[0], "F"))];
      return (
        traceResearch.length === 1 &&
        researchIds.includes(traceResearch[0]) &&
        traceFindings.some((findingId) => findingIds.includes(findingId))
      );
    });
  });
}

function subsectionEntries(section, pattern) {
  const matches = [...section.matchAll(pattern)];
  return matches.map((match, index) => ({
    id: match[1],
    title: match[2]?.trim() ?? "",
    text: section.slice(
      match.index,
      index + 1 < matches.length ? matches[index + 1].index : section.length,
    ),
  }));
}

function reportFindingIds(report) {
  return new Set(
    subsectionEntries(
      sectionText(report, "Findings"),
      /^### (F-\d{3,})\s+—\s+(.+)$/gm,
    ).map((entry) => entry.id),
  );
}

function validateRecordIds(records, prefix, errors) {
  const seen = new Map();
  for (const record of records) {
    const id = record.data.id;
    const expectedName = `${id}.md`;
    if (!new RegExp(`^${prefix}-\\d{3,}$`).test(String(id))) {
      errors.push(`${record.repoPath}: invalid ${prefix}-ID ${String(id)}`);
    }
    if (record.fileName !== expectedName) {
      errors.push(`${record.repoPath}: filename must be ${expectedName}`);
    }
    if (seen.has(id)) {
      errors.push(`${record.repoPath}: duplicate ID ${id} also used by ${seen.get(id)}`);
    } else {
      seen.set(id, record.repoPath);
    }
  }

  const numbers = records
    .map((record) => idNumber(record.data.id))
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
  for (let index = 0; index < numbers.length; index += 1) {
    const expected = index + 1;
    if (numbers[index] !== expected) {
      errors.push(`${prefix}-ID sequence has a gap: expected ${prefix}-${String(expected).padStart(3, "0")}`);
      break;
    }
  }
}

function validateReports(reports, errors, warnings) {
  validateRecordIds(reports, "R", errors);
  const reportMap = new Map(reports.map((report) => [report.data.id, report]));
  const activeTopics = new Map();
  for (const report of reports) {
    validateRequiredMetadata(report, REQUIRED_REPORT_META, errors);
    validateDates(report, ["created", "updated", "review_by"], errors);
    validateBaselineCommit(report, errors);
    validateHeadings(report, REPORT_HEADINGS, errors);

    if (!REPORT_STATUSES.has(report.data.status)) {
      errors.push(`${report.repoPath}: unsupported report status ${report.data.status}`);
    }
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(String(report.data.topic))) {
      errors.push(`${report.repoPath}: topic must be lowercase kebab-case`);
    }
    if (report.data.updated < report.data.created) {
      errors.push(`${report.repoPath}: updated cannot be earlier than created`);
    }

    for (const field of ["related", "supersedes"]) {
      const references = report.data[field] ?? [];
      if (!Array.isArray(references)) {
        errors.push(`${report.repoPath}: ${field} must be a YAML list`);
        continue;
      }
      for (const id of references) {
        if (!/^R-\d{3,}$/.test(String(id))) {
          errors.push(`${report.repoPath}: invalid ${field} reference ${id}`);
        } else if (id === report.data.id) {
          errors.push(`${report.repoPath}: ${field} cannot reference itself`);
        } else if (!reportMap.has(id)) {
          errors.push(`${report.repoPath}: missing ${field} report ${id}`);
        } else if (
          field === "supersedes" &&
          reportMap.get(id).data.status !== "superseded"
        ) {
          errors.push(
            `${report.repoPath}: supersedes target ${id} must already have status superseded`,
          );
        }
      }
    }

    if (report.data.status !== "superseded") {
      const owner = activeTopics.get(report.data.topic);
      if (owner) {
        errors.push(
          `${report.repoPath}: active topic duplicates ${owner}; confirm the decision scopes are genuinely different`,
        );
      } else {
        activeTopics.set(report.data.topic, report.data.id);
      }
    }

    if (report.data.status === "complete") {
      const sourceRows = dataRows(report, "Source register", /^SRC-\d{3,}$/);
      const sourceIds = new Set(sourceRows.map((row) => row[0]));
      if (sourceRows.length === 0) {
        errors.push(`${report.repoPath}: complete report has no populated Source register rows`);
      }
      if (sourceIds.size !== sourceRows.length) {
        errors.push(`${report.repoPath}: Source register contains duplicate Source IDs`);
      }
      for (const row of sourceRows) {
        if (row.length < 8 || row.slice(0, 8).some((cell) => !cell)) {
          errors.push(`${report.repoPath}: Source register row ${row[0]} is incomplete`);
        }
      }

      const findings = subsectionEntries(
        sectionText(report, "Findings"),
        /^### (F-\d{3,})\s+—\s+(.+)$/gm,
      );
      const findingIds = new Set(findings.map((finding) => finding.id));
      if (findings.length === 0) {
        errors.push(`${report.repoPath}: complete report has no Finding subsections`);
      }
      if (findingIds.size !== findings.length) {
        errors.push(`${report.repoPath}: Findings contain duplicate Finding IDs`);
      }
      for (const finding of findings) {
        const evidence = finding.text.match(/\*\*근거:\*\*\s*([^\n]+)/)?.[1] ?? "";
        const evidenceIds = [...evidence.matchAll(/\bSRC-\d{3,}\b/g)].map(
          (match) => match[0],
        );
        if (!finding.title || finding.title === "Finding 제목") {
          errors.push(`${report.repoPath}: ${finding.id} has a placeholder title`);
        }
        if (evidenceIds.length === 0) {
          errors.push(`${report.repoPath}: ${finding.id} does not cite a Source ID`);
        }
        for (const sourceId of evidenceIds) {
          if (!sourceIds.has(sourceId)) {
            errors.push(`${report.repoPath}: ${finding.id} cites missing ${sourceId}`);
          }
        }
        for (const label of ["내용", "신뢰도", "반례·제약", "결정 영향"]) {
          if (!new RegExp(`\\*\\*${label}:\\*\\*\\s*\\S+`).test(finding.text)) {
            errors.push(`${report.repoPath}: ${finding.id} has no substantive ${label}`);
          }
        }
      }

      const recommendations = subsectionEntries(
        sectionText(report, "Recommendations"),
        /^### (REC-\d{3,})\s+—\s+(.+)$/gm,
      );
      if (recommendations.length === 0) {
        errors.push(`${report.repoPath}: complete report has no Recommendation subsections`);
      }
      if (new Set(recommendations.map((entry) => entry.id)).size !== recommendations.length) {
        errors.push(`${report.repoPath}: Recommendations contain duplicate Recommendation IDs`);
      }
      for (const recommendation of recommendations) {
        const evidence = recommendation.text.match(
          /\*\*근거 Finding:\*\*\s*([^\n]+)/,
        )?.[1] ?? "";
        const referenced = [...evidence.matchAll(/\bF-\d{3,}\b/g)].map(
          (match) => match[0],
        );
        if (!recommendation.title || recommendation.title === "권고 제목") {
          errors.push(`${report.repoPath}: ${recommendation.id} has a placeholder title`);
        }
        if (referenced.length === 0) {
          errors.push(`${report.repoPath}: ${recommendation.id} does not cite a Finding ID`);
        }
        for (const findingId of referenced) {
          if (!findingIds.has(findingId)) {
            errors.push(`${report.repoPath}: ${recommendation.id} cites missing ${findingId}`);
          }
        }
        for (const label of ["권고", "채택 조건", "기각/롤백 조건"]) {
          if (!new RegExp(`\\*\\*${label}:\\*\\*\\s*\\S+`).test(recommendation.text)) {
            errors.push(`${report.repoPath}: ${recommendation.id} has no substantive ${label}`);
          }
        }
      }

      const handoffRows = dataRows(report, "Planning handoff", /^R-\d{3,}\s*\/\s*F-\d{3,}/);
      if (
        handoffRows.length === 0 ||
        handoffRows.some(
          (row) => row.length < 5 || row.slice(0, 5).some((cell) => !cell),
        )
      ) {
        errors.push(`${report.repoPath}: complete report needs a populated Planning handoff row`);
      }
      for (const row of handoffRows) {
        const handoffReports = [...new Set(referencedIds(row[0], "R"))];
        if (
          handoffReports.length !== 1 ||
          handoffReports[0] !== report.data.id
        ) {
          errors.push(
            `${report.repoPath}: Planning handoff must cite its own ${report.data.id}, not ${handoffReports.join(", ") || "a missing R-ID"}`,
          );
        }
        for (const findingId of referencedIds(row[0], "F")) {
          if (!findingIds.has(findingId)) {
            errors.push(`${report.repoPath}: Planning handoff cites missing ${findingId}`);
          }
        }
      }
      if (report.data.review_by < today()) {
        warnings.push(
          `${report.repoPath}: complete report passed review_by ${report.data.review_by}; mark needs-refresh or update it before new planning`,
        );
      }
      if (
        /\b(?:R-NNN|SRC-NNN|F-NNN|REC-NNN|YYYY-MM-DD)\b|Finding 제목|권고 제목/.test(
          report.body,
        )
      ) {
        errors.push(`${report.repoPath}: complete report still contains template placeholders`);
      }
    }
  }

  for (const report of reports) {
    if (report.data.status !== "superseded") continue;
    const replacement = reports.find(
      (candidate) =>
        Array.isArray(candidate.data.supersedes) &&
        candidate.data.supersedes.includes(report.data.id),
    );
    if (!replacement) {
      errors.push(
        `${report.repoPath}: superseded report is not referenced by a replacement's supersedes list`,
      );
    }
  }
}

function validatePlans(plans, reportMap, errors) {
  validateRecordIds(plans, "P", errors);
  for (const plan of plans) {
    validateRequiredMetadata(plan, REQUIRED_PLAN_META, errors);
    validateDates(plan, ["created", "updated"], errors);
    validateBaselineCommit(plan, errors);
    validateHeadings(plan, PLAN_HEADINGS, errors);

    if (!PLAN_STATUSES.has(plan.data.status)) {
      errors.push(`${plan.repoPath}: unsupported plan status ${plan.data.status}`);
    }
    const research = plan.data.research;
    if (!Array.isArray(research) || research.length === 0) {
      errors.push(`${plan.repoPath}: research must contain at least one R-ID`);
      continue;
    }
    if (new Set(research).size !== research.length) {
      errors.push(`${plan.repoPath}: research contains duplicate R-IDs`);
    }
    const freshnessRows = dataRows(plan, "Research inputs and freshness", /^R-\d{3,}$/);
    const traceRows = planTraceabilityRows(plan);
    const strategyRows = markdownTableRows(
      sectionText(plan, "Verification strategy"),
    ).slice(1);
    const acceptanceRows = planAcceptanceRows(plan);
    const decisionReady = new Set(["approved", "in-progress", "complete"]).has(
      plan.data.status,
    );
    if (plan.data.status !== "draft" && !/\bF-\d{3,}\b/.test(plan.body)) {
      errors.push(`${plan.repoPath}: non-draft plan must trace at least one Finding ID`);
    }
    if (decisionReady) {
      const checklistLines = sectionText(plan, "Approval checklist")
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => /^- \[[ xX]\]\s+/.test(line));
      const expectedChecklist = PLAN_APPROVAL_ITEMS.map((item) => `- [x] ${item}`);
      if (
        checklistLines.length !== expectedChecklist.length ||
        expectedChecklist.some((line) => !checklistLines.includes(line))
      ) {
        errors.push(
          `${plan.repoPath}: ${plan.data.status} plan must contain the complete checked approval checklist`,
        );
      }
      if (
        acceptanceRows.length === 0 ||
        strategyRows.length !== acceptanceRows.length ||
        acceptanceRows.some(
          (row) => row.length < 4 || row.slice(0, 4).some((cell) => !cell),
        )
      ) {
        errors.push(
          `${plan.repoPath}: ${plan.data.status} plan needs only populated AC-ID verification rows`,
        );
      }
      const acceptanceIds = acceptanceRows.map((row) => row[0]);
      if (new Set(acceptanceIds).size !== acceptanceIds.length) {
        errors.push(`${plan.repoPath}: Verification strategy contains duplicate AC-IDs`);
      }
      const acceptanceNumbers = acceptanceIds
        .map((id) => Number.parseInt(id.slice(3), 10))
        .sort((a, b) => a - b);
      for (let index = 0; index < acceptanceNumbers.length; index += 1) {
        if (acceptanceNumbers[index] !== index + 1) {
          errors.push(
            `${plan.repoPath}: AC-ID sequence has a gap; expected AC-${String(index + 1).padStart(3, "0")}`,
          );
          break;
        }
      }
    }
    if (plan.data.status === "complete") {
      if (/\b(?:P-NNN|R-NNN|F-NNN|YYYY-MM-DD)\b/.test(plan.body)) {
        errors.push(`${plan.repoPath}: complete plan still contains template placeholders`);
      }
    }

    for (const id of research) {
      if (!/^R-\d{3,}$/.test(String(id))) {
        errors.push(`${plan.repoPath}: invalid research reference ${id}`);
        continue;
      }
      const report = reportMap.get(id);
      if (!report) {
        errors.push(`${plan.repoPath}: missing research report ${id}`);
        continue;
      }
      if (new Set(["approved", "in-progress"]).has(plan.data.status)) {
        if (report.data.status !== "complete") {
          errors.push(
            `${plan.repoPath}: active plan references ${id} with status ${report.data.status}`,
          );
        }
        if (report.data.review_by < today()) {
          errors.push(
            `${plan.repoPath}: active plan references stale ${id} (review_by ${report.data.review_by})`,
          );
        }
      }
      if (
        plan.data.status !== "draft" &&
        !freshnessRows.some(
          (row) =>
            row[0] === id && row.length >= 4 && row.slice(1, 4).every((cell) => cell),
        )
      ) {
        errors.push(
          `${plan.repoPath}: ${id} has no populated freshness row`,
        );
      }
      if (plan.data.status !== "draft") {
        const findingIds = reportFindingIds(report);
        const rows = traceRows.filter((row) => row[0].startsWith(`${id} /`));
        let valid = rows.length > 0;
        for (const row of rows) {
          const referenced = [...row[0].matchAll(/\bF-\d{3,}\b/g)].map(
            (match) => match[0],
          );
          const rowValid =
            referenced.length > 0 &&
            referenced.every((findingId) => findingIds.has(findingId)) &&
            row.length >= 4 &&
            row.slice(1, 4).every((cell) => cell && cell !== "path");
          if (!rowValid) valid = false;
        }
        if (!valid) {
          errors.push(
            `${plan.repoPath}: ${id} needs a populated traceability row with Finding IDs that exist in that report`,
          );
        }
      }
    }
  }
}

function validateExecutions(executions, reportMap, planMap, errors) {
  validateRecordIds(executions, "E", errors);
  for (const execution of executions) {
    validateRequiredMetadata(execution, REQUIRED_EXECUTION_META, errors);
    validateDates(execution, ["created", "updated"], errors);
    validateBaselineCommit(execution, errors);
    validateHeadings(execution, EXECUTION_HEADINGS, errors);

    if (!EXECUTION_STATUSES.has(execution.data.status)) {
      errors.push(`${execution.repoPath}: unsupported execution status ${execution.data.status}`);
    }
    const plan = planMap.get(execution.data.plan);
    if (!plan) {
      errors.push(`${execution.repoPath}: missing plan ${execution.data.plan}`);
    }

    const research = execution.data.research;
    if (!Array.isArray(research) || research.length === 0) {
      errors.push(`${execution.repoPath}: research must contain at least one R-ID`);
      continue;
    }
    for (const id of research) {
      if (!reportMap.has(id)) errors.push(`${execution.repoPath}: missing research report ${id}`);
    }

    if (plan) {
      const planResearch = Array.isArray(plan.data.research) ? plan.data.research : [];
      const executionSet = [...new Set(research)].sort();
      const planSet = [...new Set(planResearch)].sort();
      if (
        executionSet.length !== research.length ||
        executionSet.join("\n") !== planSet.join("\n")
      ) {
        errors.push(
          `${execution.repoPath}: execution research must exactly equal ${plan.data.id} research`,
        );
      }
      if (
        new Set(["in-progress", "blocked"]).has(execution.data.status) &&
        !new Set(["approved", "in-progress"]).has(plan.data.status)
      ) {
        errors.push(
          `${execution.repoPath}: active execution requires approved/in-progress plan, found ${plan.data.status}`,
        );
      }
      if (execution.data.status === "complete" && plan.data.status !== "complete") {
        errors.push(
          `${execution.repoPath}: complete execution requires complete plan, found ${plan.data.status}`,
        );
      }
    }

    if (execution.data.status === "in-progress") {
      for (const id of research) {
        const report = reportMap.get(id);
        if (report && report.data.status !== "complete") {
          errors.push(
            `${execution.repoPath}: in-progress execution references ${id} with status ${report.data.status}`,
          );
        }
      }
    }
    if (execution.data.status === "complete") {
      const actualRows = markdownTableRows(
        sectionText(execution, "Actual changes"),
      ).slice(1);
      if (
        actualRows.length === 0 ||
        actualRows.some(
          (row) =>
            !/^`[^`]+`$/.test(row[0] ?? "") ||
            row[0] === "`path`" ||
            row.length < 4 ||
            row.slice(0, 4).some((cell) => !cell),
        )
      ) {
        errors.push(`${execution.repoPath}: complete execution needs populated Actual changes rows`);
      }
      if (plan) {
        for (const { path } of exactPathRows(execution, "Actual changes")) {
          if (
            !isEvidencePath(path) &&
            !hasPathTraceabilityChain(path, execution, plan, reportMap)
          ) {
            errors.push(
              `${execution.repoPath}: ${path} lacks an exact R/F -> ${plan.data.id} -> ${execution.data.id} traceability chain`,
            );
          }
        }
      }
      const verificationRows = markdownTableRows(
        sectionText(execution, "Verification evidence"),
      ).slice(1);
      const acceptanceRows = markdownTableRows(
        sectionText(execution, "Acceptance traceability"),
      ).slice(1);
      const substantivePass = verificationRows.some(
        (row) =>
          row[1] === "PASS" &&
          /^`[^`]+`$/.test(row[0]) &&
          row[0] !== "`command`" &&
          row.length >= 4 &&
          row[2] &&
          row[3],
      );
      if (!substantivePass) {
        errors.push(`${execution.repoPath}: complete execution needs a populated PASS command row`);
      }
      if (
        verificationRows.length === 0 ||
        verificationRows.some(
          (row) =>
            row.length < 4 ||
            row[1] !== "PASS" ||
            row.slice(0, 4).some((cell) => !cell),
        )
      ) {
        errors.push(
          `${execution.repoPath}: every verification row in a complete execution must be a populated PASS`,
        );
      }
      const acceptanceIds = acceptanceRows.map((row) => row[0]);
      const expectedAcceptanceIds = plan
        ? planAcceptanceRows(plan).map((row) => row[0])
        : [];
      if (
        acceptanceRows.length === 0 ||
        new Set(acceptanceIds).size !== acceptanceIds.length ||
        [...acceptanceIds].sort().join("\n") !==
          [...expectedAcceptanceIds].sort().join("\n")
      ) {
        errors.push(
          `${execution.repoPath}: Acceptance traceability must contain every ${execution.data.plan} AC-ID exactly once`,
        );
      }
      if (
        acceptanceRows.some(
          (row) =>
            row.length < 4 ||
            row[1] !== "PASS" ||
            row.slice(0, 4).some((cell) => !cell),
        )
      ) {
        errors.push(`${execution.repoPath}: every plan acceptance result must be a populated PASS`);
      }
      if (/\b(?:E-NNN|P-NNN|R-NNN|YYYY-MM-DD)\b/.test(execution.body)) {
        errors.push(`${execution.repoPath}: complete execution still contains template placeholders`);
      }
    }
  }
}

function validatePlanExecutionLifecycle(plans, executions, errors) {
  for (const plan of plans) {
    if (plan.data.status !== "complete") continue;
    const completedExecution = executions.find(
      (execution) =>
        execution.data.plan === plan.data.id && execution.data.status === "complete",
    );
    if (!completedExecution) {
      errors.push(`${plan.repoPath}: complete plan has no complete execution record`);
    }
  }
}

function walkMarkdown(dir) {
  if (!existsSync(dir)) return [];
  const results = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) results.push(...walkMarkdown(path));
    else if (entry.isFile() && entry.name.endsWith(".md")) results.push(path);
  }
  return results;
}

function validateMarkdownLinks(errors) {
  const files = [join(ROOT, "AGENTS.md"), join(ROOT, "README.md"), ...walkMarkdown(DOCS_DIR)]
    .filter((path) => existsSync(path));
  const linkPattern = /\[[^\]]*\]\(([^)]+)\)/g;

  for (const path of files) {
    const text = readText(path);
    for (const match of text.matchAll(linkPattern)) {
      let target = match[1].trim();
      if (/^(?:https?:|mailto:|#)/i.test(target)) continue;
      if (target.startsWith("<") && target.endsWith(">")) {
        target = target.slice(1, -1);
      }
      target = target.split("#", 1)[0];
      try {
        target = decodeURIComponent(target);
      } catch {
        errors.push(`${toRepoPath(path)}: invalid URL encoding in link ${match[1]}`);
        continue;
      }
      const resolved = resolve(dirname(path), target);
      if (!existsSync(resolved)) {
        errors.push(`${toRepoPath(path)}: broken local link ${match[1]}`);
      }
    }
  }
}

function nulSeparatedPaths(buffer) {
  return buffer
    .toString("utf8")
    .split("\0")
    .filter((path) => path !== "")
    .map((path) => path.replaceAll("\\", "/"));
}

function emptyTreeSha() {
  return execFileSync("git", ["hash-object", "-t", "tree", "--stdin"], {
    cwd: ROOT,
    input: Buffer.alloc(0),
  })
    .toString("utf8")
    .trim();
}

function resolveBase(base, errors, warnings) {
  if (!base) return undefined;
  if (/^0+$/.test(base)) {
    warnings.push("base SHA is all zeros; comparing against Git's empty tree");
    return emptyTreeSha();
  }
  try {
    execFileSync("git", ["rev-parse", "--verify", `${base}^{tree}`], {
      cwd: ROOT,
      stdio: ["ignore", "ignore", "pipe"],
    });
    return base;
  } catch (error) {
    errors.push(`invalid governance base ${base}: ${error.message}`);
    return undefined;
  }
}

function changedFiles(base, errors) {
  if (!base) return [];

  try {
    const tracked = execFileSync(
      "git",
      ["diff", "--name-only", "-z", "--diff-filter=ACDMRT", base, "--"],
      { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] },
    );
    const untracked = execFileSync(
      "git",
      ["ls-files", "-z", "--others", "--exclude-standard"],
      { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] },
    );
    return [...new Set([...nulSeparatedPaths(tracked), ...nulSeparatedPaths(untracked)])];
  } catch (error) {
    errors.push(`cannot calculate changed files from base ${base}: ${error.message}`);
    return [];
  }
}

function isEvidencePath(path) {
  return (
    path === "docs/research/REGISTER.md" ||
    /^docs\/research\/reports\/R-\d{3,}\.md$/.test(path) ||
    /^docs\/plans\/P-\d{3,}\.md$/.test(path) ||
    /^docs\/execution\/E-\d{3,}\.md$/.test(path)
  );
}

function baseRecordPaths(base) {
  if (!base) return [];
  const output = execFileSync(
    "git",
    [
      "ls-tree",
      "-r",
      "--name-only",
      "-z",
      base,
      "--",
      "docs/research/reports",
      "docs/plans",
      "docs/execution",
    ],
    { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] },
  );
  return nulSeparatedPaths(output).filter((path) =>
    /^(?:docs\/research\/reports\/R-\d{3,}|docs\/plans\/P-\d{3,}|docs\/execution\/E-\d{3,})\.md$/.test(
      path,
    ),
  );
}

function validateBaseRecordIntegrity(base, errors) {
  const priorRecords = new Map();
  if (!base) return priorRecords;
  let priorPaths;
  try {
    priorPaths = baseRecordPaths(base);
  } catch (error) {
    errors.push(`cannot inspect governance records at base ${base}: ${error.message}`);
    return priorRecords;
  }

  for (const repoPath of priorPaths) {
    const currentPath = join(ROOT, repoPath);
    if (!existsSync(currentPath)) {
      errors.push(`${repoPath}: registered R/P/E records are append-only and cannot be deleted`);
      continue;
    }
    try {
      const priorText = execFileSync("git", ["show", `${base}:${repoPath}`], {
        cwd: ROOT,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
      const prior = parseDocumentText(currentPath, priorText);
      priorRecords.set(repoPath, prior);
      const current = parseDocument(currentPath);
      const immutable = ["id", "created"];
      if (repoPath.startsWith("docs/research/reports/")) immutable.push("topic");
      if (repoPath.startsWith("docs/execution/")) immutable.push("plan");
      for (const field of immutable) {
        if (String(prior.data[field]) !== String(current.data[field])) {
          errors.push(`${repoPath}: immutable field ${field} changed from its base value`);
        }
      }

      const isPlan = repoPath.startsWith("docs/plans/");
      const isExecution = repoPath.startsWith("docs/execution/");
      const finalized = new Set(["complete", "superseded"]);
      if ((isPlan || isExecution) && finalized.has(prior.data.status)) {
        const allowedStatuses = prior.data.status === "complete"
          ? new Set(["complete", "superseded"])
          : new Set(["superseded"]);
        if (!allowedStatuses.has(current.data.status)) {
          errors.push(
            `${repoPath}: finalized ${prior.data.status} record cannot return to ${current.data.status}`,
          );
        }

        for (const field of ["title", "baseline_commit", "research"]) {
          if (JSON.stringify(prior.data[field]) !== JSON.stringify(current.data[field])) {
            errors.push(`${repoPath}: finalized record field ${field} cannot change`);
          }
        }

        const mutableLog = isPlan ? "Revision log" : "Execution log";
        const headings = (isPlan ? PLAN_HEADINGS : EXECUTION_HEADINGS).filter(
          (heading) => heading !== mutableLog,
        );
        for (const heading of headings) {
          if (sectionText(prior, heading) !== sectionText(current, heading)) {
            errors.push(
              `${repoPath}: finalized record section "${heading}" cannot change; create a new P/E-ID`,
            );
          }
        }
      }
    } catch (error) {
      errors.push(`${repoPath}: cannot compare immutable metadata: ${error.message}`);
    }
  }
  return priorRecords;
}

function validateChangedFiles(
  base,
  requireComplete,
  priorRecords,
  reportMap,
  planMap,
  errors,
) {
  const changed = changedFiles(base, errors);
  if (changed.length === 0) return;

  const governed = changed.filter((path) => !isEvidencePath(path));
  if (governed.length === 0) return;

  const changedExecutions = changed.filter(
    (path) => /^docs\/execution\/E-\d{3,}\.md$/.test(path) && existsSync(join(ROOT, path)),
  );
  if (changedExecutions.length === 0) {
    errors.push(
      `product/operation files changed from ${base}, but no E-ID execution record changed`,
    );
    return;
  }

  const eligibleExecutions = changedExecutions
    .map((path) => parseDocument(join(ROOT, path)))
    .filter((execution) => {
      const plan = planMap.get(execution.data.plan);
      const priorExecution = priorRecords.get(execution.repoPath);
      const priorPlan = plan ? priorRecords.get(plan.repoPath) : undefined;
      const finalizedAtBase = [priorExecution, priorPlan].some((record) =>
        new Set(["complete", "superseded"]).has(record?.data.status),
      );
      const statusAllowed = requireComplete
        ? execution.data.status === "complete"
        : new Set(["in-progress", "complete"]).has(execution.data.status);
      const planAllowed = execution.data.status === "complete"
        ? plan?.data.status === "complete"
        : new Set(["approved", "in-progress"]).has(plan?.data.status);
      return statusAllowed && planAllowed && !finalizedAtBase;
    });
  if (eligibleExecutions.length === 0) {
    errors.push(
      requireComplete
        ? "changed product/operation paths require a complete E-ID execution record"
        : "changed product/operation paths require an in-progress or complete E-ID execution record",
    );
    return;
  }

  for (const path of governed) {
    const covered = eligibleExecutions.some((execution) => {
      const plan = planMap.get(execution.data.plan);
      return plan && hasPathTraceabilityChain(path, execution, plan, reportMap);
    });
    if (!covered) {
      errors.push(
        `${path}: changed path needs an exact R/F -> P-ID -> eligible E-ID traceability chain`,
      );
    }
  }
}

function validateRegister(reports, errors) {
  if (!existsSync(REGISTER_PATH)) {
    errors.push("docs/research/REGISTER.md: missing register");
    return;
  }
  const register = readText(REGISTER_PATH);
  const start = register.indexOf(REGISTER_START);
  const end = register.indexOf(REGISTER_END);
  if (start === -1 || end === -1 || end < start) {
    errors.push("docs/research/REGISTER.md: missing generated block markers");
    return;
  }
  const actual = register.slice(start, end + REGISTER_END.length);
  const expected = renderRegisterBlock(reports);
  if (actual !== expected) {
    errors.push("docs/research/REGISTER.md: out of sync; run npm run research:sync");
  }
}

function validateGovernanceLock(errors) {
  let tracked = false;
  try {
    execFileSync(
      "git",
      ["ls-files", "--error-unmatch", "--", "docs/.governance.lock"],
      { cwd: ROOT, stdio: ["ignore", "ignore", "ignore"] },
    );
    tracked = true;
  } catch {
    tracked = false;
  }

  if (tracked || existsSync(LOCK_PATH)) {
    errors.push(
      "docs/.governance.lock: lock files are transient and must be untracked and absent before validation",
    );
  }
}

function checkGovernance(options) {
  const errors = [];
  const warnings = [];
  const reports = loadRecords(REPORTS_DIR, "R", errors);
  const plans = loadRecords(PLANS_DIR, "P", errors);
  const executions = loadRecords(EXECUTION_DIR, "E", errors);
  const reportMap = new Map(reports.map((record) => [record.data.id, record]));
  const planMap = new Map(plans.map((record) => [record.data.id, record]));

  validateRecordDirectory(REPORTS_DIR, "R", new Set(), errors);
  validateRecordDirectory(
    PLANS_DIR,
    "P",
    new Set(["README.md", "TEMPLATE.md"]),
    errors,
  );
  validateRecordDirectory(
    EXECUTION_DIR,
    "E",
    new Set(["README.md", "TEMPLATE.md"]),
    errors,
  );
  validateReports(reports, errors, warnings);
  validatePlans(plans, reportMap, errors);
  validateExecutions(executions, reportMap, planMap, errors);
  validatePlanExecutionLifecycle(plans, executions, errors);
  validateRegister(reports, errors);
  validateGovernanceLock(errors);
  validateMarkdownLinks(errors);
  const requireComplete =
    options["require-complete-execution"] === true ||
    process.env.GOVERNANCE_REQUIRE_COMPLETE_EXECUTION === "true";
  const baseOption = options.base;
  const invalidBaseOption =
    baseOption === true ||
    Array.isArray(baseOption) ||
    (baseOption !== undefined && String(baseOption).trim() === "");
  if (invalidBaseOption) {
    errors.push("--base requires exactly one non-empty Git revision");
  }
  const configuredBase = invalidBaseOption
    ? undefined
    : baseOption ?? process.env.GOVERNANCE_BASE_SHA;
  const requestedBase = String(configuredBase ?? "").trim() || "HEAD";
  const base = resolveBase(requestedBase, errors, warnings);
  const priorRecords = validateBaseRecordIntegrity(base, errors);
  validateChangedFiles(
    base,
    requireComplete,
    priorRecords,
    reportMap,
    planMap,
    errors,
  );

  for (const warning of warnings) console.warn(`[governance] warning: ${warning}`);
  if (errors.length > 0) {
    for (const error of errors) console.error(`[governance] error: ${error}`);
    console.error(
      `[governance] FAILED (${errors.length} error(s), ${warnings.length} warning(s))`,
    );
    process.exitCode = 1;
    return;
  }

  console.log(
    `[governance] OK (${reports.length} report(s), ${plans.length} plan(s), ${executions.length} execution record(s), ${warnings.length} warning(s))`,
  );
}

function printHelp() {
  console.log(`Usage: node scripts/governance.mjs <command> [options]

Commands:
  check [--base SHA]  Validate metadata, IDs, links, references, register, and diff (default: HEAD)
  research-new        Create the next R-ID report and sync the register
  research-sync       Rebuild the generated register table
  plan-new            Create the next P-ID from complete research
  execution-new       Create the next E-ID from an approved plan

Examples:
  npm run research:new -- --title "Export failure policy" --topic "export-failure-policy"
  npm run plan:new -- --title "Implement export policy" --research R-002,R-003
  npm run execution:new -- --title "Execute export policy" --plan P-002
  npm run governance:check -- --base HEAD

All creation commands accept --dry-run. research-new also accepts --valid-days N and
repeatable/comma-separated --related or --supersedes R-NNN values.`);
}

function main() {
  const [, , command = "check", ...argv] = process.argv;
  const options = parseOptions(argv);
  switch (command) {
    case "check":
      checkGovernance(options);
      break;
    case "research-new":
      createResearch(options);
      break;
    case "research-sync":
      if (options["dry-run"] === true) {
        const reports = loadRecords(REPORTS_DIR, "R");
        console.log(renderRegisterBlock(reports));
      } else {
        withLock(() => syncRegister());
      }
      break;
    case "plan-new":
      createPlan(options);
      break;
    case "execution-new":
      createExecution(options);
      break;
    case "help":
    case "--help":
    case "-h":
      printHelp();
      break;
    default:
      throw new Error(`unknown command: ${command}`);
  }
}

try {
  main();
} catch (error) {
  console.error(`[governance] ${error.message}`);
  process.exitCode = 1;
}
