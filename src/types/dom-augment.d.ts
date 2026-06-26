// TypeScript's lib.dom.d.ts models FontFaceSet with only `forEach`/`size`, but
// the spec (and every browser) also exposes the Set-like mutators. main.ts's
// injectBundledFonts registers the bundled faces via these, so declare them.
export {};

declare global {
  interface FontFaceSet {
    add(font: FontFace): FontFaceSet;
    delete(font: FontFace): boolean;
  }
}
