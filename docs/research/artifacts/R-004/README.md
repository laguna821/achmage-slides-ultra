# R-004 benchmark artifact guide

## Decision under test

The benchmark compared the official `1.0.3` release asset with one temporary,
unshipped composite candidate:

1. At engine construction, generate and register only the selected default
   bundled theme. Before render, detect known YAML/Marp comment theme directives
   and register each encountered bundled theme once.
2. Replace the unconditional 64 ms audit delay with a bounded adaptive settle:
   wait for `document.fonts.ready` and pending image decode, capped at 64 ms,
   then wait for two animation frames before probing.

The candidate was built from tag commit
`b061ce8c4aa528cb6b909f64a87a78a342b2f1d9` in an external temporary clone.
No candidate source or executable harness is tracked here because the repository
governance gate classifies those as operational changes before P/E approval.
The candidate bundle identity and exact behavioral description are preserved in
`official-1.0.3-hashes.json` and this file.

## Protocol `r004-live-cdp-v1`

- Isolated synthetic vault; default Obsidian theme; no private vault content;
  only the measured plugin enabled.
- Baseline folder used the downloaded official `1.0.3` assets under benchmark
  ID `asu-r004-baseline`. Candidate used ID `asu-r004-candidate`.
- Obsidian was controlled through a loopback Chrome DevTools Protocol port.
- An enable sample starts immediately before `app.plugins.enablePlugin(id)` and
  ends when its promise resolves. It therefore includes bundle load/evaluation,
  plugin `onload()`, settings migration/load, renderer creation, theme
  registration, local override resolution, and command/view registration.
- A preview sample starts immediately before the plugin's Open Slide Preview
  command. It ends only after the status is no longer `Rendering...`, the iframe
  contains `.achmage-stage`, `iframe.contentDocument.fonts.ready` resolves, and
  two additional animation frames pass.
- The preview leaf is detached before each first/second preview. The plugin is
  disabled and unloaded between enable samples.
- Warm run: one Obsidian process, two unrecorded warm-ups per fixture, then 20
  recorded samples per variant for each of five fixtures. Pair order alternates
  `baseline → candidate` and `candidate → baseline`.
- Cold run: one fresh Obsidian process tree per sample, 20 samples per variant
  for `small.md`, with the same alternating pair order. The plugin remains
  disabled at application startup and is enabled after the vault is ready.
- OS page cache was not forcibly flushed. "Cold" therefore means a fresh
  Obsidian/Electron process and plugin module instance, not a cold storage cache.
- Long-task entries and `performance.memory.usedJSHeapSize` were recorded as
  diagnostic signals. They are not treated as precise heap or CPU attribution.

## Statistics and gate

- Median and MAD use the ordinary sample median. p95 uses linear interpolation.
- The paired 95% interval is a deterministic 10,000-resample bootstrap of the
  median `baseline - candidate` difference.
- A metric passes only when median improvement is at least
  `max(5%, 2 × baseline relative MAD)`, the paired interval lower bound is above
  zero, and candidate p95 does not regress beyond that threshold.
- The composite is adoptable only if both plugin enable and first stable preview
  pass in the cold and warm evidence without a compatibility or memory regression.

## Artifact map

- `environment.json`: machine, storage, runtime, cache and discarded-pilot facts.
- `official-1.0.3-hashes.json`: official release and candidate bundle identity.
- `fixtures/`: five synthetic markdown scenarios and deterministic local SVG.
- `raw/warm-raw.json`: 200 recorded warm results, zero failures.
- `raw/cold-raw.json`: 40 recorded cold-process results, zero failures.
- `benchmark-summary.json`: descriptive statistics, paired bootstrap intervals,
  and gate booleans derived from the raw records.
- `verification.json`: build and compatibility checks run in the temporary clone.

## Reproduction boundary

Reproduction requires the same official asset hashes, candidate behavior,
Obsidian app package, synthetic fixtures, pair order, milestones, and statistics
above. Exact latency is machine-specific. Obsidian automatically updated the
isolated profile from app package 1.12.7 to 1.13.4 before the full run; pilot
records spanning that transition were discarded and are not in tracked raw data.

