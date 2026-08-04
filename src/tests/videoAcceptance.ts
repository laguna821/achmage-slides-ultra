import assert from "node:assert/strict";
import {
  VIDEO_ARTIFACT_SCHEMA_VERSION,
  VIDEO_FPS,
  VIDEO_HEIGHT,
  VIDEO_HOLD_DEFAULT_SECONDS,
  VIDEO_HOLD_MAX_SECONDS,
  VIDEO_HOLD_MIN_SECONDS,
  VIDEO_OUTPUT_CONTRACT_V1,
  VIDEO_TRANSITION_FRAMES,
  VIDEO_WIDTH,
  type VideoDeckArtifactDraftV1,
  type VideoDeckArtifactV1,
  type VideoDeckFrameIdentityV1,
} from "../video/videoTypes";
import {
  createVideoTimeline,
  framesForHoldSeconds,
  sampleVideoTimeline,
  smoothstep,
  validateVideoFrameSequence,
  validateVideoHoldSeconds,
  type VideoTimelineTransitionSampleV1,
} from "../video/videoTimeline";

let assertions = 0;

function check(value: unknown, message: string): asserts value {
  assertions += 1;
  assert.ok(value, message);
}

function equal<T>(actual: T, expected: T, message: string): void {
  assertions += 1;
  assert.equal(actual, expected, message);
}

function near(actual: number, expected: number, message: string): void {
  assertions += 1;
  assert.ok(Math.abs(actual - expected) < 1e-12, `${message}: ${actual} !== ${expected}`);
}

function rejects(action: () => unknown, pattern: RegExp, message: string): void {
  assertions += 1;
  assert.throws(action, pattern, message);
}

function framesForTopology(topology: readonly number[]): readonly VideoDeckFrameIdentityV1[] {
  const frames: VideoDeckFrameIdentityV1[] = [];
  topology.forEach((frameCount, logicalIndex) => {
    for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
      frames.push({
        physicalIndex: frames.length,
        logicalIndex,
        frameIndex,
        frameCount,
        title: `Section ${logicalIndex + 1}`,
      });
    }
  });
  return frames;
}

function testContracts(): void {
  equal(VIDEO_WIDTH, 1920, "video width");
  equal(VIDEO_HEIGHT, 1080, "video height");
  equal(VIDEO_FPS, 30, "video frame rate");
  equal(VIDEO_TRANSITION_FRAMES, 9, "transition frame count");
  equal(VIDEO_OUTPUT_CONTRACT_V1.container, "mp4", "container contract");
  equal(VIDEO_OUTPUT_CONTRACT_V1.videoCodec, "avc", "codec contract");
  equal(VIDEO_OUTPUT_CONTRACT_V1.audioTrackCount, 0, "silent export has no audio track");
  check(Object.isFrozen(VIDEO_OUTPUT_CONTRACT_V1), "output contract must be frozen");

  const draft: VideoDeckArtifactDraftV1 = {
    schemaVersion: VIDEO_ARTIFACT_SCHEMA_VERSION,
    width: VIDEO_WIDTH,
    height: VIDEO_HEIGHT,
    sharedCss: "svg { color: black; }",
    frames: [{ ...framesForTopology([1])[0], svg: "<svg />" }],
  };
  const normalized: VideoDeckArtifactV1 = {
    schemaVersion: VIDEO_ARTIFACT_SCHEMA_VERSION,
    width: VIDEO_WIDTH,
    height: VIDEO_HEIGHT,
    artifactHash: "a".repeat(64),
    frames: [
      {
        ...framesForTopology([1])[0],
        standaloneSvg: "<svg xmlns=\"http://www.w3.org/2000/svg\" />",
        contentHash: "b".repeat(64),
      },
    ],
  };
  equal(draft.frames[0].physicalIndex, 0, "draft contract preserves topology");
  equal(normalized.frames[0].contentHash.length, 64, "normalized contract exposes hash");
}

function testHoldValidation(): void {
  const accepted = [0.5, 0.6, 1, 3, 17.3, 59.9, 60];
  for (const seconds of accepted) {
    equal(validateVideoHoldSeconds(seconds), seconds, `accepted hold ${seconds}`);
    equal(framesForHoldSeconds(seconds), Math.round(seconds * 30), `hold frames ${seconds}`);
  }

  for (const seconds of [NaN, Infinity, -Infinity, 0.4, 60.1, 0.55, 1.01, 59.95]) {
    rejects(() => validateVideoHoldSeconds(seconds), /finite|between|steps/, `reject hold ${seconds}`);
  }
  equal(framesForHoldSeconds(VIDEO_HOLD_MIN_SECONDS), 15, "minimum hold is 15 frames");
  equal(framesForHoldSeconds(VIDEO_HOLD_DEFAULT_SECONDS), 90, "default hold is 90 frames");
  equal(framesForHoldSeconds(VIDEO_HOLD_MAX_SECONDS), 1800, "maximum hold is 1800 frames");
}

function testTopology(topology: readonly number[], holdSeconds: number): void {
  const topologyLabel = `[${topology.join(",")}]`;
  const frames = framesForTopology(topology);
  const plan = createVideoTimeline(frames, holdSeconds);
  const holdFrames = Math.round(holdSeconds * VIDEO_FPS);
  const expectedTotal = frames.length * holdFrames + (frames.length - 1) * 9;

  equal(plan.totalFrames, expectedTotal, `${topologyLabel} total frame arithmetic`);
  near(plan.durationSeconds, expectedTotal / VIDEO_FPS, `${topologyLabel} duration arithmetic`);
  equal(plan.frames.length, frames.length, `${topologyLabel} frame count`);
  check(Object.isFrozen(plan), `${topologyLabel} timeline plan is frozen`);
  check(Object.isFrozen(plan.frames), `${topologyLabel} frame ordering snapshot is frozen`);

  const absoluteFrames = new Set<number>();
  const holdCounts = new Array(frames.length).fill(0) as number[];
  const transitionCounts = new Map<string, number>();
  const transitionSamples = new Map<string, VideoTimelineTransitionSampleV1[]>();

  for (let absoluteFrame = 0; absoluteFrame < plan.totalFrames; absoluteFrame += 1) {
    const sample = sampleVideoTimeline(plan, absoluteFrame);
    equal(sample.absoluteFrame, absoluteFrame, `${topologyLabel} random access frame identity`);
    check(!absoluteFrames.has(sample.absoluteFrame), `${topologyLabel} absolute frame not duplicated`);
    absoluteFrames.add(sample.absoluteFrame);

    if (sample.kind === "hold") {
      holdCounts[sample.currentFrameIndex] += 1;
      check(sample.holdFrameIndex >= 0 && sample.holdFrameIndex < holdFrames, "hold offset bounds");
      equal(sample.currentFrame.physicalIndex, sample.currentFrameIndex, "hold physical order");
      continue;
    }

    const edge = `${sample.currentFrameIndex}->${sample.nextFrameIndex}`;
    transitionCounts.set(edge, (transitionCounts.get(edge) ?? 0) + 1);
    const edgeSamples = transitionSamples.get(edge) ?? [];
    edgeSamples.push(sample);
    transitionSamples.set(edge, edgeSamples);
    equal(sample.nextFrameIndex, sample.currentFrameIndex + 1, "transition cannot skip a frame");
    equal(sample.transitionFrameIndex, (transitionCounts.get(edge) ?? 1) - 1, "transition index order");
    near(sample.linearProgress, (sample.transitionFrameIndex + 1) / 10, "linear progress rule");
    near(sample.progress, smoothstep(sample.linearProgress), "smoothstep progress rule");

    const sameLogical = sample.currentFrame.logicalIndex === sample.nextFrame.logicalIndex;
    equal(sample.axis, sameLogical ? "vertical" : "horizontal", "Smart transition axis");
    equal(sample.direction, sameLogical ? "up" : "left", "Smart transition direction");
  }

  equal(absoluteFrames.size, expectedTotal, `${topologyLabel} has no absolute frame gaps`);
  holdCounts.forEach((count, index) => equal(count, holdFrames, `physical ${index} exact hold count`));
  equal(transitionCounts.size, Math.max(0, frames.length - 1), `${topologyLabel} exact transition edges`);

  for (let edgeIndex = 0; edgeIndex < frames.length - 1; edgeIndex += 1) {
    const edge = `${edgeIndex}->${edgeIndex + 1}`;
    equal(transitionCounts.get(edge), VIDEO_TRANSITION_FRAMES, `${edge} exact transition count`);
    const samples = transitionSamples.get(edge) ?? [];
    near(samples[0].linearProgress, 0.1, `${edge} begins after source hold without duplicate`);
    near(samples[8].linearProgress, 0.9, `${edge} ends before destination hold without duplicate`);

    const segmentStart = edgeIndex * (holdFrames + VIDEO_TRANSITION_FRAMES);
    const lastHold = sampleVideoTimeline(plan, segmentStart + holdFrames - 1);
    const firstTransition = sampleVideoTimeline(plan, segmentStart + holdFrames);
    const lastTransition = sampleVideoTimeline(
      plan,
      segmentStart + holdFrames + VIDEO_TRANSITION_FRAMES - 1
    );
    const nextHold = sampleVideoTimeline(
      plan,
      segmentStart + holdFrames + VIDEO_TRANSITION_FRAMES
    );
    equal(lastHold.kind, "hold", `${edge} last source boundary`);
    equal(firstTransition.kind, "transition", `${edge} first transition boundary`);
    equal(lastTransition.kind, "transition", `${edge} last transition boundary`);
    equal(nextHold.kind, "hold", `${edge} first destination boundary`);
    if (nextHold.kind === "hold") {
      equal(nextHold.currentFrameIndex, edgeIndex + 1, `${edge} destination is next physical frame`);
      equal(nextHold.holdFrameIndex, 0, `${edge} destination begins at hold index zero`);
    }
  }

  const first = sampleVideoTimeline(plan, 0);
  const last = sampleVideoTimeline(plan, plan.totalFrames - 1);
  equal(first.kind, "hold", `${topologyLabel} starts on a hold`);
  equal(first.currentFrameIndex, 0, `${topologyLabel} starts at physical frame zero`);
  equal(last.kind, "hold", `${topologyLabel} ends on a hold`);
  equal(last.currentFrameIndex, frames.length - 1, `${topologyLabel} ends at final physical frame`);
  if (last.kind === "hold") {
    equal(last.holdFrameIndex, holdFrames - 1, `${topologyLabel} ends at final hold tick`);
  }

  rejects(() => sampleVideoTimeline(plan, -1), /outside/, `${topologyLabel} rejects negative frame`);
  rejects(() => sampleVideoTimeline(plan, plan.totalFrames), /outside/, `${topologyLabel} rejects end frame`);
  rejects(() => sampleVideoTimeline(plan, 0.5), /outside/, `${topologyLabel} rejects fractional frame`);

  const midpoint = Math.floor(plan.totalFrames / 2);
  assert.deepEqual(
    sampleVideoTimeline(plan, midpoint),
    sampleVideoTimeline(plan, midpoint),
    `${topologyLabel} random access is deterministic`
  );
  assertions += 1;
}

function testTopologies(): void {
  const topologies = [[1], [3], [1, 1], [1, 3, 2], [3, 1]] as const;
  topologies.forEach((topology) => testTopology(topology, VIDEO_HOLD_DEFAULT_SECONDS));

  // Duration extrema exercise the full accepted timing range without building
  // an O(totalFrames) structure in production.
  for (const seconds of [VIDEO_HOLD_MIN_SECONDS, VIDEO_HOLD_MAX_SECONDS]) {
    const frames = framesForTopology([1, 3, 2]);
    const plan = createVideoTimeline(frames, seconds);
    const expected = frames.length * Math.round(seconds * 30) + (frames.length - 1) * 9;
    equal(plan.totalFrames, expected, `${seconds}s duration boundary total`);
    near(plan.durationSeconds, expected / 30, `${seconds}s duration boundary seconds`);
  }
}

function testSequenceValidation(): void {
  rejects(() => validateVideoFrameSequence([]), /at least one/, "empty deck rejected");

  const valid = framesForTopology([1, 3, 2]);
  validateVideoFrameSequence(valid);
  assertions += 1;

  const mutate = (index: number, patch: Partial<VideoDeckFrameIdentityV1>) =>
    valid.map((frame, frameIndex) => (frameIndex === index ? { ...frame, ...patch } : frame));
  rejects(() => validateVideoFrameSequence(mutate(0, { physicalIndex: 1 })), /sequence index/, "physical gap");
  rejects(() => validateVideoFrameSequence(mutate(1, { logicalIndex: 2 })), /contiguous/, "logical gap");
  rejects(() => validateVideoFrameSequence(mutate(2, { logicalIndex: 0 })), /backwards/, "logical reverse");
  rejects(() => validateVideoFrameSequence(mutate(2, { frameIndex: 0 })), /Expected frameIndex/, "frame duplicate");
  rejects(() => validateVideoFrameSequence(mutate(1, { frameCount: 4 })), /frameCount changed/, "count drift");
  rejects(() => validateVideoFrameSequence(mutate(1, { frameCount: 1 })), /frameCount changed/, "count shrink");
  rejects(
    () =>
      validateVideoFrameSequence(
        valid.map((frame) =>
          frame.logicalIndex === 2 ? { ...frame, frameCount: 3 } : frame
        )
      ),
    /ended before/,
    "incomplete final section"
  );
  rejects(() => validateVideoFrameSequence(mutate(0, { logicalIndex: -1 })), /non-negative/, "negative logical");
  rejects(() => validateVideoFrameSequence(mutate(0, { frameCount: 0 })), /at least one/, "zero frame count");
}

function testSmoothstep(): void {
  near(smoothstep(0), 0, "smoothstep lower endpoint");
  near(smoothstep(0.5), 0.5, "smoothstep midpoint");
  near(smoothstep(1), 1, "smoothstep upper endpoint");
  rejects(() => smoothstep(-0.01), /between/, "smoothstep rejects below zero");
  rejects(() => smoothstep(1.01), /between/, "smoothstep rejects above one");
  rejects(() => smoothstep(NaN), /between/, "smoothstep rejects NaN");
}

testContracts();
testHoldValidation();
testTopologies();
testSequenceValidation();
testSmoothstep();

console.log(`Video timeline acceptance PASS (${assertions} assertions)`);
