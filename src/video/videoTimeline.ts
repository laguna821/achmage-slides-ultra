import {
  VIDEO_FPS,
  VIDEO_HOLD_DEFAULT_SECONDS,
  VIDEO_HOLD_MAX_SECONDS,
  VIDEO_HOLD_MIN_SECONDS,
  VIDEO_HOLD_STEP_SECONDS,
  VIDEO_TRANSITION_FRAMES,
  type VideoDeckFrameIdentityV1,
  type VideoTransitionAxis,
  type VideoTransitionDirection,
} from "./videoTypes";

const HOLD_TICKS_PER_SECOND = Math.round(1 / VIDEO_HOLD_STEP_SECONDS);
const HOLD_MIN_TICKS = Math.round(VIDEO_HOLD_MIN_SECONDS * HOLD_TICKS_PER_SECOND);
const HOLD_MAX_TICKS = Math.round(VIDEO_HOLD_MAX_SECONDS * HOLD_TICKS_PER_SECOND);
const HOLD_STEP_EPSILON = 1e-7;

export interface VideoTimelinePlanV1 {
  readonly fps: typeof VIDEO_FPS;
  readonly holdSeconds: number;
  readonly holdFrames: number;
  readonly transitionFrames: typeof VIDEO_TRANSITION_FRAMES;
  readonly totalFrames: number;
  readonly durationSeconds: number;
  /** Frozen ordering snapshot; frame payloads remain owned by the artifact. */
  readonly frames: readonly VideoDeckFrameIdentityV1[];
}

export interface VideoTimelineHoldSampleV1 {
  readonly kind: "hold";
  readonly absoluteFrame: number;
  readonly currentFrameIndex: number;
  readonly currentFrame: VideoDeckFrameIdentityV1;
  readonly holdFrameIndex: number;
}

export interface VideoTimelineTransitionSampleV1 {
  readonly kind: "transition";
  readonly absoluteFrame: number;
  readonly currentFrameIndex: number;
  readonly currentFrame: VideoDeckFrameIdentityV1;
  readonly nextFrameIndex: number;
  readonly nextFrame: VideoDeckFrameIdentityV1;
  /** Zero-based index in the fixed nine-frame transition. */
  readonly transitionFrameIndex: number;
  /** (transitionFrameIndex + 1) / 10, therefore 0.1 through 0.9. */
  readonly linearProgress: number;
  /** smoothstep(linearProgress), computed only from the absolute frame. */
  readonly progress: number;
  readonly axis: VideoTransitionAxis;
  /** Forward vertical motion moves up; forward horizontal motion moves left. */
  readonly direction: VideoTransitionDirection;
}

export type VideoTimelineSampleV1 =
  | VideoTimelineHoldSampleV1
  | VideoTimelineTransitionSampleV1;

/**
 * Validate and normalize the only v1 timing input. Integer decisecond ticks
 * avoid accepting values such as 0.55 because of floating-point rounding.
 */
export function validateVideoHoldSeconds(value: number): number {
  if (!Number.isFinite(value)) {
    throw new RangeError("Slide hold must be a finite number of seconds.");
  }

  const ticks = Math.round(value * HOLD_TICKS_PER_SECOND);
  if (ticks < HOLD_MIN_TICKS || ticks > HOLD_MAX_TICKS) {
    throw new RangeError(
      `Slide hold must be between ${VIDEO_HOLD_MIN_SECONDS} and ${VIDEO_HOLD_MAX_SECONDS} seconds.`
    );
  }
  if (Math.abs(value * HOLD_TICKS_PER_SECOND - ticks) > HOLD_STEP_EPSILON) {
    throw new RangeError(`Slide hold must use ${VIDEO_HOLD_STEP_SECONDS}-second steps.`);
  }

  return ticks / HOLD_TICKS_PER_SECOND;
}

export function framesForHoldSeconds(value: number): number {
  return Math.round(validateVideoHoldSeconds(value) * VIDEO_FPS);
}

export function smoothstep(progress: number): number {
  if (!Number.isFinite(progress) || progress < 0 || progress > 1) {
    throw new RangeError("Smoothstep progress must be between 0 and 1.");
  }
  return progress * progress * (3 - 2 * progress);
}

export function smartTransitionForFrames(
  current: VideoDeckFrameIdentityV1,
  next: VideoDeckFrameIdentityV1
): { readonly axis: VideoTransitionAxis; readonly direction: VideoTransitionDirection } {
  return current.logicalIndex === next.logicalIndex
    ? { axis: "vertical", direction: "up" }
    : { axis: "horizontal", direction: "left" };
}

export function validateVideoFrameSequence(frames: readonly VideoDeckFrameIdentityV1[]): void {
  if (frames.length === 0) {
    throw new RangeError("A video deck must contain at least one physical frame.");
  }

  let previousLogical = -1;
  let expectedFrameIndex = 0;
  let currentFrameCount = 0;

  frames.forEach((frame, index) => {
    for (const [name, value] of [
      ["physicalIndex", frame.physicalIndex],
      ["logicalIndex", frame.logicalIndex],
      ["frameIndex", frame.frameIndex],
      ["frameCount", frame.frameCount],
    ] as const) {
      if (!Number.isInteger(value) || value < 0) {
        throw new RangeError(`${name} must be a non-negative integer at physical frame ${index}.`);
      }
    }

    if (frame.physicalIndex !== index) {
      throw new RangeError(`physicalIndex must equal sequence index ${index}.`);
    }
    if (frame.frameCount < 1) {
      throw new RangeError(`frameCount must be at least one at physical frame ${index}.`);
    }
    if (frame.logicalIndex < previousLogical) {
      throw new RangeError("Logical section order cannot move backwards.");
    }

    if (frame.logicalIndex !== previousLogical) {
      if (previousLogical >= 0 && expectedFrameIndex !== currentFrameCount) {
        throw new RangeError(`Logical section ${previousLogical} ended before its declared frameCount.`);
      }
      if (frame.logicalIndex !== previousLogical + 1) {
        throw new RangeError("Logical section indices must be contiguous from zero.");
      }
      previousLogical = frame.logicalIndex;
      expectedFrameIndex = 0;
      currentFrameCount = frame.frameCount;
    } else if (frame.frameCount !== currentFrameCount) {
      throw new RangeError(`frameCount changed inside logical section ${frame.logicalIndex}.`);
    }

    if (frame.frameIndex !== expectedFrameIndex) {
      throw new RangeError(
        `Expected frameIndex ${expectedFrameIndex} in logical section ${frame.logicalIndex}.`
      );
    }
    expectedFrameIndex += 1;
  });

  if (expectedFrameIndex !== currentFrameCount) {
    throw new RangeError(`Logical section ${previousLogical} ended before its declared frameCount.`);
  }
}

export function createVideoTimeline(
  frames: readonly VideoDeckFrameIdentityV1[],
  holdSeconds: number = VIDEO_HOLD_DEFAULT_SECONDS
): VideoTimelinePlanV1 {
  validateVideoFrameSequence(frames);
  const normalizedHoldSeconds = validateVideoHoldSeconds(holdSeconds);
  const holdFrames = framesForHoldSeconds(normalizedHoldSeconds);
  const totalFrames =
    frames.length * holdFrames + (frames.length - 1) * VIDEO_TRANSITION_FRAMES;

  return Object.freeze({
    fps: VIDEO_FPS,
    holdSeconds: normalizedHoldSeconds,
    holdFrames,
    transitionFrames: VIDEO_TRANSITION_FRAMES,
    totalFrames,
    durationSeconds: totalFrames / VIDEO_FPS,
    frames: Object.freeze(frames.slice()),
  });
}

/** O(1) random access: no per-output-frame timeline array is allocated. */
export function sampleVideoTimeline(
  plan: VideoTimelinePlanV1,
  absoluteFrame: number
): VideoTimelineSampleV1 {
  if (!Number.isInteger(absoluteFrame) || absoluteFrame < 0 || absoluteFrame >= plan.totalFrames) {
    throw new RangeError(`Frame ${absoluteFrame} is outside 0..${plan.totalFrames - 1}.`);
  }

  const nonFinalSegmentFrames = plan.holdFrames + plan.transitionFrames;
  const finalSegmentStart = (plan.frames.length - 1) * nonFinalSegmentFrames;

  if (absoluteFrame >= finalSegmentStart) {
    const currentFrameIndex = plan.frames.length - 1;
    return {
      kind: "hold",
      absoluteFrame,
      currentFrameIndex,
      currentFrame: plan.frames[currentFrameIndex],
      holdFrameIndex: absoluteFrame - finalSegmentStart,
    };
  }

  const currentFrameIndex = Math.floor(absoluteFrame / nonFinalSegmentFrames);
  const segmentFrameIndex = absoluteFrame % nonFinalSegmentFrames;
  const currentFrame = plan.frames[currentFrameIndex];

  if (segmentFrameIndex < plan.holdFrames) {
    return {
      kind: "hold",
      absoluteFrame,
      currentFrameIndex,
      currentFrame,
      holdFrameIndex: segmentFrameIndex,
    };
  }

  const nextFrameIndex = currentFrameIndex + 1;
  const nextFrame = plan.frames[nextFrameIndex];
  const transitionFrameIndex = segmentFrameIndex - plan.holdFrames;
  const linearProgress = (transitionFrameIndex + 1) / (VIDEO_TRANSITION_FRAMES + 1);
  const transition = smartTransitionForFrames(currentFrame, nextFrame);

  return {
    kind: "transition",
    absoluteFrame,
    currentFrameIndex,
    currentFrame,
    nextFrameIndex,
    nextFrame,
    transitionFrameIndex,
    linearProgress,
    progress: smoothstep(linearProgress),
    ...transition,
  };
}
