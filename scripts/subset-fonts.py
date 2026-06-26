#!/usr/bin/env python3
"""
Regenerate the bundled font subsets in src/assets/.

Reproducible recipe for the woff2 subsets that themes/fontFace.ts inlines
(via assets/fonts.generated.ts). Subsets keep the variable wght axis and the
KS X 1001 common-Hangul (2,350) + Latin + slide-symbol coverage.

Prereqs:
  pip install "fonttools[woff]"     # brotli/zopfli for woff2 read+write

Source fonts (download once, both OFL 1.1):
  Pretendard Variable:
    https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/packages/pretendard/dist/web/variable/woff2/PretendardVariable.woff2
  JetBrains Mono (variable, latin):
    https://cdn.jsdelivr.net/npm/@fontsource-variable/jetbrains-mono@5/files/jetbrains-mono-latin-wght-normal.woff2

Usage:
  1) place the two source woff2 next to this script (or edit SRC_* paths)
  2) python scripts/subset-fonts.py
  3) node scripts/generate-fonts.mjs        # -> src/assets/fonts.generated.ts

The JetBrains Mono advance is exactly 0.6em, matching
measurement/codeMetrics.ts MONO_CHAR_ADVANCE_RATIO, so code-block measurement
stays in parity with the render.
"""
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ASSETS = os.path.join(HERE, "..", "src", "assets")
SRC_PRETENDARD = os.environ.get("SRC_PRETENDARD", os.path.join(HERE, "PretendardVariable.woff2"))
SRC_JBMONO = os.environ.get("SRC_JBMONO", os.path.join(HERE, "JetBrainsMono.woff2"))


def codepoints():
    cps = set()
    # Latin Basic + Latin-1 Supplement
    cps |= set(range(0x20, 0x7F))
    cps |= set(range(0xA0, 0x100))
    # KS X 1001 common Hangul (2,350) via the euc-kr (Wansung) codec.
    for lead in range(0xB0, 0xC9):
        for trail in range(0xA1, 0xFF):
            try:
                ch = bytes([lead, trail]).decode("euc-kr")
            except UnicodeDecodeError:
                continue
            if 0xAC00 <= ord(ch) <= 0xD7A3:
                cps.add(ord(ch))
    # Hangul Compatibility Jamo (standalone ㄱ ㅏ ...)
    cps |= set(range(0x3130, 0x3190))
    # CJK symbols & punctuation (「」 ㆍ 、。 …)
    cps |= set(range(0x3000, 0x3040))
    # General punctuation: dashes, curly quotes, ellipsis, bullet, primes
    cps |= {0x2010, 0x2011, 0x2012, 0x2013, 0x2014, 0x2015, 0x2018, 0x2019,
            0x201C, 0x201D, 0x2022, 0x2026, 0x2032, 0x2033, 0x203B, 0x2039,
            0x203A, 0x00B7}
    # Arrows + math/misc commonly used in slides
    cps |= {0x2190, 0x2191, 0x2192, 0x2193, 0x2194, 0x21D2, 0x21D4,
            0x00D7, 0x00F7, 0x2212, 0x00B1, 0x2260, 0x2264, 0x2265, 0x221E,
            0x2248, 0x2211, 0x220F, 0x221A, 0x2208, 0x2218,
            0x2713, 0x2714, 0x2717, 0x2718, 0x25A0, 0x25A1, 0x25CF, 0x25CB,
            0x25B6, 0x25C0, 0x25BC, 0x25B2, 0x2605, 0x2606,
            0x00A9, 0x00AE, 0x2122, 0x00B0, 0x20A9, 0x20AC, 0x00A3, 0x00A5}
    # Fullwidth ASCII + won/yen signs
    cps |= set(range(0xFF01, 0xFF5F))
    cps |= {0xFFE0, 0xFFE1, 0xFFE5, 0xFFE6}
    return cps


def subset(src, out, unicodes):
    subprocess.run(
        [sys.executable, "-m", "fontTools.subset", src,
         "--unicodes=" + unicodes, "--flavor=woff2", "--layout-features=*",
         "--notdef-outline", "--recommended-glyphs", "--output-file=" + out],
        check=True,
    )
    from fontTools.ttLib import TTFont
    f = TTFont(out)
    axes = [(a.axisTag, a.minValue, a.maxValue) for a in f["fvar"].axes] if "fvar" in f else "STATIC"
    print(f"{os.path.basename(out)}: {os.path.getsize(out)} bytes | axes {axes} | glyphs {len(f.getGlyphOrder())}")


def main():
    cps = codepoints()
    uni = ",".join("U+%04X" % c for c in sorted(cps))
    subset(SRC_PRETENDARD, os.path.join(ASSETS, "pretendard-subset.woff2"), uni)
    jb = set(range(0x20, 0x7F)) | set(range(0xA0, 0x100)) | {
        0x2192, 0x2190, 0x2191, 0x2193, 0x2713, 0x2717, 0x2022, 0x2026,
        0x2013, 0x2014, 0x2018, 0x2019, 0x201C, 0x201D}
    jbuni = ",".join("U+%04X" % c for c in sorted(jb))
    subset(SRC_JBMONO, os.path.join(ASSETS, "jbmono-subset.woff2"), jbuni)
    print("Done. Now run: node scripts/generate-fonts.mjs")


if __name__ == "__main__":
    main()
