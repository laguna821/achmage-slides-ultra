# Tier 3 default background images

Drop per-theme background images here, named by **theme id**:

```
assets/tier3-bg/
  cmds-dark-native-1920-v5.webp
  obsidian-cyan.webp
  cobalt-sand.webp
  deep-navy-ice.webp
  graphite-topaz.webp
  arctic-violet.webp
  hallym-light.webp
```

- Size: **1920×1080**. Format: `.webp` preferred (smallest), `.png`/`.jpg` also accepted.
- Keep each file modest (**≤ ~250 KB**) — they are inlined as base64 into `main.js`
  and into exported HTML, so size adds up across themes.
- Generate the images by clicking **"Copy prompt"** for each theme in
  *Settings → Tier 3*, pasting into an image model (with your note attached).

After adding/replacing images, run:

```
npm run generate:tier3-bg
```

This rewrites `src/assets/tier3Backgrounds.generated.ts` (base64 data URIs).
Only themes that have an image file are included — partial coverage is fine.
