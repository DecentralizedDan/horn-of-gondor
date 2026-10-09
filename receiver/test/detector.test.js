import assert from "node:assert/strict";
import { test } from "node:test";
import { TransmissionDetector } from "../src/detector.js";
import { calculateScore } from "../src/scoring.js";

function detector(overrides = {}) {
  return new TransmissionDetector({
    thresholdDbfs: -70,
    scoreRangeDb: 50,
    minimumDurationMs: 1_000,
    endGraceMs: 300,
    sampleIntervalMs: 100,
    frequencyHz: 146_550_000,
    gainDb: 28,
    receiverVersion: "0.2.0-test",
    createEventId: () => "3157bbbf-7208-4873-9c1c-e99965a0d6c4",
    ...overrides,
  });
}

test("calculates the agreed weighted relative score", () => {
  assert.equal(
    calculateScore({
      peakDbfs: -30,
      averageDbfs: -40,
      thresholdDbfs: -70,
      scoreRangeDb: 50,
    }),
    68,
  );
});

test("detects a qualifying transmission and calculates its measurements", () => {
  const receiver = detector();
  const powers = [
    -80,
    -40,
    -30,
    -40,
    -30,
    -40,
    -30,
    -40,
    -30,
    -40,
    -40,
    -80,
    -80,
    -80,
    -80,
  ];

  let event = null;
  powers.forEach((powerDbfs, index) => {
    event ??= receiver.addSample({
      timestampMs: Date.parse("2026-10-09T00:00:00.000Z") + index * 100,
      powerDbfs,
    });
  });

  assert.deepEqual(event, {
    eventId: "3157bbbf-7208-4873-9c1c-e99965a0d6c4",
    startedAt: "2026-10-09T00:00:00.100Z",
    durationMs: 1_000,
    peakDbfs: -30,
    averageDbfs: -36,
    score: 73,
    frequencyHz: 146_550_000,
    gainDb: 28,
    thresholdDbfs: -70,
    receiverVersion: "0.2.0-test",
  });
});

test("discards a transmission shorter than the minimum duration", () => {
  const receiver = detector();
  const base = Date.parse("2026-10-09T00:00:00.000Z");

  for (let index = 0; index < 5; index += 1) {
    receiver.addSample({
      timestampMs: base + index * 100,
      powerDbfs: -40,
    });
  }
  for (let index = 5; index < 9; index += 1) {
    assert.equal(
      receiver.addSample({
        timestampMs: base + index * 100,
        powerDbfs: -80,
      }),
      null,
    );
  }

  assert.equal(receiver.flush(), null);
});
