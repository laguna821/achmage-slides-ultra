## Compaction Worker

```ts
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

interface CompactJob {
  id: string;
  source: string;
  destination: string;
  ttlSeconds: number;
}

interface CompactResult {
  id: string;
  status: "ok" | "skipped" | "failed";
  bytesIn: number;
  bytesOut: number;
  reason?: string;
}

const HASH_LEN = 12;

function digestOf(content: string): string {
  return createHash("sha256").update(content).digest("hex").slice(0, HASH_LEN);
}

function shouldSkip(input: string, marker: string): boolean {
  return input.startsWith(`/* compact:${marker} */`);
}

export async function compact(
  job: CompactJob,
  workdir: string
): Promise<CompactResult> {
  const sourcePath = join(workdir, job.source);
  const raw = readFileSync(sourcePath, "utf8");
  const marker = digestOf(raw);
  if (shouldSkip(raw, marker)) {
    return {
      id: job.id,
      status: "skipped",
      bytesIn: raw.length,
      bytesOut: raw.length,
      reason: "marker matched",
    };
  }
  const minified = raw
    .replace(/\s+/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .trim();
  const banner = `/* compact:${marker} */\n`;
  const output = banner + minified;
  writeFileSync(join(workdir, job.destination), output, "utf8");
  return { id: job.id, status: "ok", bytesIn: raw.length, bytesOut: output.length };
}
```
