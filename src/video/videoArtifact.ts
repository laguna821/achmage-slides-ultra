import type { SlideMapEntry } from "../preprocessor/overflowSplitter";
import {
  VIDEO_ARTIFACT_SCHEMA_VERSION,
  VIDEO_HEIGHT,
  VIDEO_WIDTH,
  type VideoDeckArtifactDraftV1,
} from "./videoTypes";

/**
 * Capture the final decorated Marp output before the interactive HTML shell is
 * assembled. The frame SVG strings are referenced directly (not copied); only
 * the opt-in caller retains this additional object graph and shared CSS string.
 */
export function buildVideoDeckArtifactDraft(
  slides: readonly string[],
  sharedCss: string,
  slideMap: readonly SlideMapEntry[]
): VideoDeckArtifactDraftV1 {
  const frames = slides.map((svg, physicalIndex) => {
    const entry = slideMap[physicalIndex];
    return Object.freeze({
      physicalIndex,
      logicalIndex: entry?.logical ?? physicalIndex,
      frameIndex: entry?.frame ?? 0,
      frameCount: entry?.totalFrames ?? 1,
      title: entry?.title ?? `Slide ${physicalIndex + 1}`,
      svg,
    });
  });

  return Object.freeze({
    schemaVersion: VIDEO_ARTIFACT_SCHEMA_VERSION,
    width: VIDEO_WIDTH,
    height: VIDEO_HEIGHT,
    sharedCss,
    frames: Object.freeze(frames),
  });
}
