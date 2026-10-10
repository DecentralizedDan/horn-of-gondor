import assert from "node:assert/strict";
import { test } from "node:test";
import {
  recommendDetectionSettings,
  summarizeNoise,
} from "../src/calibration.js";

test("summarizes idle-channel measurements", () => {
  assert.deepEqual(
    summarizeNoise([-42, -41.5, -41, -40.5, -40]),
    {
      minimumDbfs: -42,
      medianDbfs: -41,
      percentile95Dbfs: -40,
      maximumDbfs: -40,
    },
  );
});

test("recommends a threshold above the measured noise", () => {
  const recommendation = recommendDetectionSettings({
    measurements: [
      -42,
      -41.8,
      -41.6,
      -41.4,
      -41.2,
      -41,
      -40.8,
      -40.6,
      -40.4,
      -40.2,
      -40,
      -39.8,
      -39.6,
      -39.4,
      -39.2,
      -39,
      -38.8,
      -38.6,
      -38.4,
      -38.2,
    ],
    marginDb: 3,
    currentScoreRangeDb: 35,
  });

  assert.equal(recommendation.summary.percentile95Dbfs, -38.4);
  assert.equal(recommendation.thresholdDbfs, -35.4);
  assert.equal(recommendation.scoreRangeDb, 35);
});

test("reduces an incompatible score range", () => {
  const recommendation = recommendDetectionSettings({
    measurements: [-31, -30],
    marginDb: 3,
    currentScoreRangeDb: 35,
  });

  assert.equal(recommendation.thresholdDbfs, -27);
  assert.equal(recommendation.scoreRangeDb, 27);
});
