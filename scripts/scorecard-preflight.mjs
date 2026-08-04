import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const mainPath = resolve(root, "main.js");
const stylesPath = resolve(root, "styles.css");
const metafilePath = resolve(root, "build/scorecard/esbuild-meta.json");
const packagePath = resolve(root, "package.json");
const packageLockPath = resolve(root, "package-lock.json");
const noticesPath = resolve(root, "THIRD_PARTY_NOTICES.md");
const mplPath = resolve(root, "licenses/MPL-2.0.txt");
const tsconfigPath = resolve(root, "tsconfig.json");
const nodeRuntimeDeclarationPath = resolve(root, "src/types/node-runtime.d.ts");
const nodeBoundaryProductPaths = [
  resolve(root, "src/video/videoEncoder.ts"),
  resolve(root, "src/video/videoOutputPath.ts"),
];
const nodeBoundaryProbePath = resolve(root, ".scorecard-node-runtime-probe.ts");
const expectedNodeImportInventory = [
  "src/video/videoEncoder.ts|node:crypto|value|createHash",
  "src/video/videoOutputPath.ts|node:crypto|value|createHash",
  "src/video/videoOutputPath.ts|node:crypto|value|randomUUID",
  "src/video/videoOutputPath.ts|node:fs/promises|type|FileHandle",
  "src/video/videoOutputPath.ts|node:fs/promises|value|link",
  "src/video/videoOutputPath.ts|node:fs/promises|value|lstat",
  "src/video/videoOutputPath.ts|node:fs/promises|value|open",
  "src/video/videoOutputPath.ts|node:fs/promises|value|unlink",
  "src/video/videoOutputPath.ts|node:path|value|basename",
  "src/video/videoOutputPath.ts|node:path|value|dirname",
  "src/video/videoOutputPath.ts|node:path|value|extname",
  "src/video/videoOutputPath.ts|node:path|value|isAbsolute",
  "src/video/videoOutputPath.ts|node:path|value|join",
].sort();
const nodeBoundaryProbeSource = `
import { createHash, randomUUID } from "node:crypto";
import { link, lstat, open, unlink, type FileHandle } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join } from "node:path";

async function probeNodeRuntimeDeclarations(
  path: string,
  data: Uint8Array
): Promise<void> {
  const hash = createHash("sha256");
  hash.update("value");
  hash.update(data);
  hash.update(new Uint8ClampedArray(1));
  const digest: string = hash.digest("hex");
  const id: string = randomUUID();

  const handle: FileHandle = await open(path, "wx+", 0o600);
  const stats = await handle.stat({ bigint: true });
  const size: bigint = stats.size;
  const device: bigint = stats.dev;
  const inode: bigint = stats.ino;
  const links: bigint = stats.nlink;
  const file: boolean = stats.isFile();
  const symlink: boolean = stats.isSymbolicLink();
  const written: number = (
    await handle.write(data, 0, data.byteLength, 0)
  ).bytesWritten;
  const read: number = (
    await handle.read(data, 0, data.byteLength, 0)
  ).bytesRead;
  await handle.sync();
  await handle.close();

  const pathStats = await lstat(path, { bigint: true });
  const absolute: boolean = isAbsolute(path);
  const extension: string = extname(path);
  const linkedPath: string = join(
    dirname(path),
    \`\${basename(path)}-\${id}\${extension}\`
  );
  await link(path, linkedPath);
  await unlink(linkedPath);

  void [
    digest,
    size,
    device,
    inode,
    links,
    file,
    symlink,
    written,
    read,
    pathStats,
    absolute,
  ];
}

void probeNodeRuntimeDeclarations;
`;

function formatTypeScriptDiagnostic(diagnostic) {
  const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n");
  if (!diagnostic.file || diagnostic.start === undefined) {
    return `TS${diagnostic.code}: ${message}`;
  }
  const position = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start);
  const relativePath = diagnostic.file.fileName
    .replaceAll("\\", "/")
    .replace(`${root.replaceAll("\\", "/")}/`, "");
  return `${relativePath}:${position.line + 1}:${position.character + 1} TS${diagnostic.code}: ${message}`;
}

function repositoryRelativePath(path) {
  return path
    .replaceAll("\\", "/")
    .replace(`${root.replaceAll("\\", "/")}/`, "");
}

function collectNodeImportInventory() {
  const inventory = [];

  for (const path of nodeBoundaryProductPaths) {
    const relativePath = repositoryRelativePath(path);
    const sourceFile = ts.createSourceFile(
      path,
      readFileSync(path, "utf8"),
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS
    );
    const record = (moduleName, kind, name) => {
      if (moduleName.startsWith("node:")) {
        inventory.push(`${relativePath}|${moduleName}|${kind}|${name}`);
      }
    };

    for (const statement of sourceFile.statements) {
      if (
        ts.isImportDeclaration(statement) &&
        ts.isStringLiteral(statement.moduleSpecifier)
      ) {
        const moduleName = statement.moduleSpecifier.text;
        const clause = statement.importClause;
        if (!clause) {
          record(moduleName, "side-effect", "*");
          continue;
        }
        if (clause.name) record(moduleName, "default", clause.name.text);
        const bindings = clause.namedBindings;
        if (bindings && ts.isNamespaceImport(bindings)) {
          record(moduleName, "namespace", bindings.name.text);
        } else if (bindings && ts.isNamedImports(bindings)) {
          for (const element of bindings.elements) {
            const importedName = element.propertyName?.text ?? element.name.text;
            const localName = element.name.text;
            const name = importedName === localName
              ? importedName
              : `${importedName}->${localName}`;
            record(
              moduleName,
              clause.isTypeOnly || element.isTypeOnly ? "type" : "value",
              name
            );
          }
        }
      } else if (
        ts.isExportDeclaration(statement) &&
        statement.moduleSpecifier &&
        ts.isStringLiteral(statement.moduleSpecifier)
      ) {
        record(statement.moduleSpecifier.text, "export", "*");
      } else if (
        ts.isImportEqualsDeclaration(statement) &&
        ts.isExternalModuleReference(statement.moduleReference) &&
        statement.moduleReference.expression &&
        ts.isStringLiteral(statement.moduleReference.expression)
      ) {
        record(
          statement.moduleReference.expression.text,
          "import-equals",
          statement.name.text
        );
      }
    }

    const visit = (node) => {
      if (
        ts.isCallExpression(node) &&
        node.arguments.length === 1 &&
        ts.isStringLiteral(node.arguments[0])
      ) {
        const moduleName = node.arguments[0].text;
        if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
          record(moduleName, "dynamic-import", "*");
        } else if (ts.isIdentifier(node.expression) && node.expression.text === "require") {
          record(moduleName, "require", "*");
        }
      }
      ts.forEachChild(node, visit);
    };
    ts.forEachChild(sourceFile, visit);
  }

  return inventory.sort();
}

function runNodeTypeBoundaryCheck() {
  const actualImportInventory = collectNodeImportInventory();
  const importInventoryExact =
    JSON.stringify(actualImportInventory) === JSON.stringify(expectedNodeImportInventory);
  const config = ts.readConfigFile(tsconfigPath, ts.sys.readFile);
  if (config.error) {
    return {
      passed: false,
      automaticNodeTypesExcluded: false,
      importInventoryExact,
      diagnostics: [formatTypeScriptDiagnostic(config.error)],
      expectedImportInventory: expectedNodeImportInventory,
      actualImportInventory,
      roots: [nodeRuntimeDeclarationPath, nodeBoundaryProbePath].map(repositoryRelativePath),
    };
  }

  const parsed = ts.parseJsonConfigFileContent(
    config.config,
    ts.sys,
    root,
    { allowJs: false, noEmit: true, skipLibCheck: false, types: [] },
    tsconfigPath
  );
  const host = ts.createCompilerHost(parsed.options, true);
  const originalFileExists = host.fileExists.bind(host);
  const originalReadFile = host.readFile.bind(host);
  const originalGetSourceFile = host.getSourceFile.bind(host);
  const normalizedProbePath = nodeBoundaryProbePath.replaceAll("\\", "/");
  const isProbePath = (path) => path.replaceAll("\\", "/") === normalizedProbePath;
  host.fileExists = (path) => isProbePath(path) || originalFileExists(path);
  host.readFile = (path) => isProbePath(path) ? nodeBoundaryProbeSource : originalReadFile(path);
  host.getSourceFile = (
    path,
    languageVersion,
    onError,
    shouldCreateNewSourceFile
  ) => isProbePath(path)
    ? ts.createSourceFile(
      path,
      nodeBoundaryProbeSource,
      languageVersion,
      true,
      ts.ScriptKind.TS
    )
    : originalGetSourceFile(path, languageVersion, onError, shouldCreateNewSourceFile);
  const program = ts.createProgram({
    rootNames: [nodeBoundaryProbePath, nodeRuntimeDeclarationPath],
    options: parsed.options,
    host,
  });
  const automaticNodeTypeFiles = program
    .getSourceFiles()
    .map((file) => file.fileName.replaceAll("\\", "/"))
    .filter((path) => path.includes("/node_modules/@types/node/"));
  const diagnostics = [
    ...parsed.errors.map(formatTypeScriptDiagnostic),
    ...ts.getPreEmitDiagnostics(program).map(formatTypeScriptDiagnostic),
  ];
  if (!importInventoryExact) {
    diagnostics.push(
      `Node import inventory changed: expected ${JSON.stringify(expectedNodeImportInventory)}, ` +
      `received ${JSON.stringify(actualImportInventory)}`
    );
  }
  if (automaticNodeTypeFiles.length > 0) {
    diagnostics.push(
      `Automatic @types/node files were loaded: ${automaticNodeTypeFiles.join(", ")}`
    );
  }

  return {
    passed: diagnostics.length === 0,
    automaticNodeTypesExcluded: automaticNodeTypeFiles.length === 0,
    importInventoryExact,
    diagnostics,
    expectedImportInventory: expectedNodeImportInventory,
    actualImportInventory,
    roots: [nodeRuntimeDeclarationPath, nodeBoundaryProbePath].map(repositoryRelativePath),
  };
}

const main = readFileSync(mainPath);
const source = new TextDecoder("utf-8", { fatal: true }).decode(main);
const styles = readFileSync(stylesPath, "utf8");
const metafile = JSON.parse(readFileSync(metafilePath, "utf8"));
const packageJson = JSON.parse(readFileSync(packagePath, "utf8"));
const packageLock = JSON.parse(readFileSync(packageLockPath, "utf8"));
const notices = readFileSync(noticesPath, "utf8");
const mplLicense = readFileSync(mplPath, "utf8");
const mediabunnyLock = packageLock.packages?.["node_modules/mediabunny"];
const expectedMediabunnyIntegrity =
  "sha512-rMGwH5fykDCSA55LG9aWkE433wwHrycq3J5mRf+djBnHBZzmJGvIwg6Qfcfr4rRkzkmrdmewxQozLkOM1H1C6Q==";
const expectedMplSha256 =
  "3f3d9e0024b1921b067d6f7f88deb4a60cbe7a78e76c64e3f1d7fc3b779b9d04";
const nodeTypeBoundary = runNodeTypeBoundaryCheck();
const normalizedOutput = Object.entries(metafile.outputs).find(
  ([name]) =>
    name.replaceAll("\\", "/").endsWith("/main.js") || name === "main.js"
);

if (!normalizedOutput) {
  throw new Error("Scorecard preflight could not find main.js in the esbuild metafile.");
}

const [, output] = normalizedOutput;
const count = (pattern, value = source) => value.match(pattern)?.length ?? 0;
const cssWithoutComments = styles.replace(/\/\*[\s\S]*?\*\//g, "");
const inputGroups = {};

for (const [input, detail] of Object.entries(output.inputs ?? {})) {
  const normalized = input.replaceAll("\\", "/");
  const group = normalized.includes("/mathjax-full/")
    ? "mathjax"
    : normalized.includes("/mediabunny/")
      ? "mediabunny"
      : normalized.includes("/highlight.js/")
        ? "highlight.js"
        : normalized.includes("/katex/")
          ? "katex"
          : normalized.includes("/@marp-team/")
            ? "marp"
            : normalized.startsWith("src/")
              ? "project-src"
              : "other";
  inputGroups[group] = (inputGroups[group] ?? 0) + detail.bytesInOutput;
}

const result = {
  note: "Local preflight only; this is not equivalent to the Obsidian Developer Dashboard Scorecard.",
  main: {
    bytes: main.byteLength,
    sha256: createHash("sha256").update(main).digest("hex"),
    // esbuild records bytes before the production build's deterministic 1280x720 to
    // 1920x1080 text rewrite. Preserve both values instead of claiming equality.
    esbuildPrePostprocessBytes: output.bytes,
    postprocessByteDelta: main.byteLength - output.bytes,
    validUtf8: true,
    hasBom:
      main.byteLength >= 3 && main[0] === 0xef && main[1] === 0xbb && main[2] === 0xbf,
    replacementCharacters: count(/\uFFFD/g),
    under5150000: main.byteLength < 5_150_000,
    under5MiB: main.byteLength < 5 * 1024 * 1024,
    underApproved5600000: main.byteLength < 5_600_000,
    underOptional4900000Target: main.byteLength < 4_900_000,
    inputGroups,
  },
  css: {
    importantDeclarations: count(/!important\b/g, cssWithoutComments),
    importantMaximum: 0,
    mozRangeSelectors: count(/::-moz-range-/g, cssWithoutComments),
    mozRangeMaximum: 0,
    browserRangeSelectors: count(
      /::-(?:moz-range-[\w-]+|webkit-slider-(?:runnable-track|thumb))/g,
      cssWithoutComments
    ),
    browserRangeMaximum: 0,
  },
  bundleTokens: {
    evalCalls: count(/\.eval\s*\(/g),
    newFunction: count(/new Function/g),
    requireFs: count(/require\(["'](?:node:)?fs(?:\/promises)?["']\)/g),
    base64Calls: count(/\b(?:atob|btoa)\s*\(/g),
  },
  videoDependency: {
    exactMediabunny: packageJson.dependencies?.mediabunny === "1.52.3",
    exactMediabunnyLock:
      mediabunnyLock?.version === "1.52.3" &&
      mediabunnyLock?.integrity === expectedMediabunnyIntegrity &&
      mediabunnyLock?.license === "MPL-2.0",
    remotionPackageCount: Object.keys({
      ...(packageJson.dependencies ?? {}),
      ...(packageJson.devDependencies ?? {}),
    }).filter((name) => name === "remotion" || name.startsWith("@remotion/")).length,
    remotionLockCount: Object.keys(packageLock.packages ?? {}).filter((name) =>
      /(?:^|node_modules\/)(?:@remotion\/|remotion$)/i.test(name)
    ).length,
    remotionMetafileInputCount: Object.keys(output.inputs ?? {}).filter((name) =>
      /(?:^|[/\\])(?:@remotion|remotion)(?:[/\\]|$)/i.test(name)
    ).length,
    preservedMplBanner:
      source.includes("Third-party: Mediabunny 1.52.3 (MPL-2.0)") &&
      source.includes("THIRD_PARTY_NOTICES.md"),
    noticeNamesExactVersion:
      notices.includes("Mediabunny 1.52.3") && notices.includes("MPL-2.0"),
    mplSha256: createHash("sha256").update(mplLicense).digest("hex"),
    remotionTelemetryTokenCount: count(
      /(?:remotion\.dev|remotion\.cloud|@remotion\/licensing|web-renderer\/telemetry)/gi
    ),
  },
  nodeTypeBoundary,
};

const failures = [];
if (result.main.hasBom) failures.push("main.js contains a UTF-8 BOM");
if (result.main.replacementCharacters > 0) {
  failures.push("main.js contains a Unicode replacement character");
}
// 1.2.0 does not reuse the obsolete 1.1.3 size gate. The approved ceiling only
// catches unreviewed bundle growth; R-004 measures loading/first-preview performance.
if (!result.main.underApproved5600000) {
  failures.push("main.js exceeds the approved 1.2.0 5,600,000-byte bundle safety ceiling");
}
if (result.css.importantDeclarations > result.css.importantMaximum) {
  failures.push(
    `styles.css !important declarations increased to ${result.css.importantDeclarations}`
  );
}
if (result.css.mozRangeSelectors > result.css.mozRangeMaximum) {
  failures.push(`styles.css contains ${result.css.mozRangeSelectors} ::-moz-range selectors`);
}
if (result.css.browserRangeSelectors > result.css.browserRangeMaximum) {
  failures.push(
    `styles.css contains ${result.css.browserRangeSelectors} browser-specific range selectors`
  );
}
if (result.bundleTokens.evalCalls !== 1) failures.push("expected exactly one eval call");
if (result.bundleTokens.newFunction !== 1) failures.push("expected exactly one new Function");
if (result.bundleTokens.requireFs !== 2) failures.push("expected exactly two audited fs/fs-promises requires");
if (result.bundleTokens.base64Calls !== 6) {
  failures.push("expected exactly six audited base64 encode/decode calls");
}
if (!result.videoDependency.exactMediabunny || !result.videoDependency.exactMediabunnyLock) {
  failures.push("expected exact production dependency and lock integrity for mediabunny@1.52.3");
}
if (
  result.videoDependency.remotionPackageCount !== 0 ||
  result.videoDependency.remotionLockCount !== 0 ||
  result.videoDependency.remotionMetafileInputCount !== 0
) {
  failures.push("Remotion must not be a package or production bundle input");
}
if (!result.videoDependency.preservedMplBanner) {
  failures.push("Mediabunny MPL banner/source-notice pointer is missing from main.js");
}
if (
  !result.videoDependency.noticeNamesExactVersion ||
  result.videoDependency.mplSha256 !== expectedMplSha256
) {
  failures.push("Mediabunny third-party notice or canonical MPL-2.0 text is incomplete");
}
if (result.videoDependency.remotionTelemetryTokenCount !== 0) {
  failures.push("unexpected Remotion telemetry endpoint/token found in main.js");
}
if (!result.nodeTypeBoundary.passed) {
  const detail = result.nodeTypeBoundary.diagnostics.length > 0
    ? result.nodeTypeBoundary.diagnostics.join(" | ")
    : "@types/node was loaded despite the synthetic exclusion";
  failures.push(`Node builtin synthetic type boundary failed: ${detail}`);
}

console.log(JSON.stringify(result, null, 2));
if (failures.length > 0) {
  console.error(`Scorecard preflight failed:\n- ${failures.join("\n- ")}`);
  process.exitCode = 1;
}
