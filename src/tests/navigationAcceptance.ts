import { SlideRenderer } from "../engine/slideRenderer";
import type { SlideRenderResult } from "../engine/marpEngine";
import type { SlideMapEntry } from "../preprocessor/overflowSplitter";

type PresentationBuilder = {
  buildPresentationHTML(
    result: SlideRenderResult,
    slideMap: SlideMapEntry[]
  ): string;
};

/** Build a deterministic shell-only deck for the browser navigation matrix. */
export function buildNavigationFixture(frameCounts: number[]): string {
  const slides: string[] = [];
  const slideMap: SlideMapEntry[] = [];

  frameCounts.forEach((frameCount, logical) => {
    for (let frame = 0; frame < frameCount; frame++) {
      const position = `${logical + 1}-${frame + 1}`;
      const fill = logical % 2 === 0 ? "#ffffff" : "#101827";
      const textFill = logical % 2 === 0 ? "#111111" : "#ffffff";
      slides.push(
        `<svg data-marpit-svg viewBox="0 0 1920 1080" xmlns="http://www.w3.org/2000/svg">
  <rect width="1920" height="1080" fill="${fill}" />
  <text x="80" y="120" fill="${textFill}">${position}</text>
  <foreignObject x="80" y="180" width="520" height="120">
    <button xmlns="http://www.w3.org/1999/xhtml" class="fixture-frame-control" data-position="${position}" aria-label="Frame ${position} control" onclick="window.fixtureActivationCount = (window.fixtureActivationCount || 0) + 1">Frame ${position} control</button>
  </foreignObject>
</svg>`
      );
      slideMap.push({
        logical,
        frame,
        totalFrames: frameCount,
        title: `Section ${logical + 1}`,
      });
    }
  });

  const renderer = Object.create(SlideRenderer.prototype) as PresentationBuilder;
  return renderer.buildPresentationHTML(
    { slides, css: "", comments: slides.map(() => []) },
    slideMap
  );
}
