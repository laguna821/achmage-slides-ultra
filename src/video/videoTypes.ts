/** Deterministic output contract for the first MP4 export format. */
export const VIDEO_ARTIFACT_SCHEMA_VERSION = 1 as const;
export const VIDEO_WIDTH = 1920 as const;
export const VIDEO_HEIGHT = 1080 as const;
export const VIDEO_FPS = 30 as const;
export const VIDEO_TRANSITION_FRAMES = 9 as const;
export const VIDEO_HOLD_MIN_SECONDS = 0.5 as const;
export const VIDEO_HOLD_MAX_SECONDS = 60 as const;
export const VIDEO_HOLD_STEP_SECONDS = 0.1 as const;
export const VIDEO_HOLD_DEFAULT_SECONDS = 3 as const;

/**
 * The v1 export intentionally has one interoperable format. It has no audio
 * track; "silent" does not mean an encoded silent audio stream.
 */
export const VIDEO_OUTPUT_CONTRACT_V1 = Object.freeze({
  container: "mp4",
  videoCodec: "avc",
  audioTrackCount: 0,
  width: VIDEO_WIDTH,
  height: VIDEO_HEIGHT,
  fps: VIDEO_FPS,
  transitionFrames: VIDEO_TRANSITION_FRAMES,
} as const);

export type VideoTransitionAxis = "vertical" | "horizontal";
export type VideoTransitionDirection = "up" | "left";

/** Stable topology shared by renderer artifacts and the pure timeline. */
export interface VideoDeckFrameIdentityV1 {
  /** Zero-based order in the rendered physical SVG sequence. */
  readonly physicalIndex: number;
  /** Zero-based logical section/group index. */
  readonly logicalIndex: number;
  /** Zero-based physical frame index within the logical section. */
  readonly frameIndex: number;
  /** Total physical frames in the logical section. */
  readonly frameCount: number;
  readonly title: string;
}

/** Renderer-owned, opt-in artifact before asset normalization and hashing. */
export interface VideoDeckArtifactDraftFrameV1 extends VideoDeckFrameIdentityV1 {
  /** Canonical physical Marp SVG. Assets may still reference source URLs. */
  readonly svg: string;
}

export interface VideoDeckArtifactDraftV1 {
  readonly schemaVersion: typeof VIDEO_ARTIFACT_SCHEMA_VERSION;
  readonly width: typeof VIDEO_WIDTH;
  readonly height: typeof VIDEO_HEIGHT;
  /** Canonical renderer CSS shared by every draft SVG. */
  readonly sharedCss: string;
  readonly frames: readonly VideoDeckArtifactDraftFrameV1[];
}

/** Self-contained frame produced after strict asset/readiness normalization. */
export interface VideoDeckArtifactFrameV1 extends VideoDeckFrameIdentityV1 {
  /** Standalone SVG with normalized assets and the required shared CSS. */
  readonly standaloneSvg: string;
  /** Lowercase hexadecimal SHA-256 of standaloneSvg UTF-8 bytes. */
  readonly contentHash: string;
}

/** Immutable, audited snapshot consumed by the compositor and encoder. */
export interface VideoDeckArtifactV1 {
  readonly schemaVersion: typeof VIDEO_ARTIFACT_SCHEMA_VERSION;
  readonly width: typeof VIDEO_WIDTH;
  readonly height: typeof VIDEO_HEIGHT;
  /** Lowercase hexadecimal SHA-256 over the normalized artifact manifest. */
  readonly artifactHash: string;
  readonly frames: readonly VideoDeckArtifactFrameV1[];
}
