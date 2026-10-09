import assert from "node:assert/strict";
import { test } from "node:test";
import { ReceiverService } from "../src/service.js";
import { EventStore } from "../src/store.js";
import { SyntheticSignalSource } from "../src/synthetic-source.js";

test("runs a complete synthetic detection cycle into SQLite", async () => {
  const sampleIntervalMs = 100;
  const segments = [
    { durationMs: 1_000, powerDbfs: -82 },
    { durationMs: 1_500, powerDbfs: -50 },
    { durationMs: 1_000, powerDbfs: -82 },
    { durationMs: 2_000, powerDbfs: -30 },
    { durationMs: 1_000, powerDbfs: -82 },
  ];
  const source = new SyntheticSignalSource({
    sampleIntervalMs,
    segments,
    realtime: false,
    repeat: false,
    startTimeMs: Date.parse("2026-10-09T00:00:00.000Z"),
  });
  const store = new EventStore(":memory:");
  const messages = [];
  const logger = {
    info(message) {
      messages.push(message);
    },
    warn() {},
    error() {},
  };
  const config = {
    source: { sampleIntervalMs },
    radio: {
      frequencyHz: 146_550_000,
      gainDb: 28,
    },
    detection: {
      thresholdDbfs: -62,
      scoreRangeDb: 50,
      minimumDurationMs: 1_000,
      endGraceMs: 300,
    },
    storage: { retentionDays: 180 },
    cloud: {
      uploadIntervalMs: 5_000,
      batchSize: 25,
    },
  };
  const service = new ReceiverService({
    config,
    source,
    store,
    receiverVersion: "0.2.0-test",
    logger,
    now: () => Date.parse("2026-10-09T00:10:00.000Z"),
  });

  try {
    const counts = await service.run();
    assert.deepEqual(counts, {
      pending: 2,
      uploaded: 0,
      rejected: 0,
    });

    const pending = store.pending(10);
    assert.equal(pending.length, 2);
    assert.deepEqual(
      pending.map(({ event }) => ({
        durationMs: event.durationMs,
        peakDbfs: event.peakDbfs,
        score: event.score,
      })),
      [
        { durationMs: 1_500, peakDbfs: -50, score: 24 },
        { durationMs: 2_000, peakDbfs: -30, score: 64 },
      ],
    );
    assert.equal(
      messages.filter((message) => message.startsWith("Detected transmission"))
        .length,
      2,
    );
  } finally {
    store.close();
  }
});

test("continues consuming samples while a cloud upload is pending", async () => {
  let releaseUpload;
  const blockedUpload = new Promise((resolve) => {
    releaseUpload = resolve;
  });
  let uploadCalls = 0;
  let samplesRead = 0;
  const source = {
    async *samples() {
      for (let index = 0; index < 5; index += 1) {
        samplesRead += 1;
        yield {
          timestampMs: Date.parse("2026-10-09T00:00:00.000Z") + index * 100,
          powerDbfs: -80,
        };
      }
    },
  };
  const uploader = {
    async syncRetention() {},
    async uploadPending() {
      uploadCalls += 1;
      if (uploadCalls === 1) {
        await blockedUpload;
      }
      return { attempted: 0, uploaded: 0, rejected: 0, deferred: 0 };
    },
  };
  const store = new EventStore(":memory:");
  const config = {
    source: { sampleIntervalMs: 100 },
    radio: { frequencyHz: 146_550_000, gainDb: 28 },
    detection: {
      thresholdDbfs: -50,
      scoreRangeDb: 50,
      minimumDurationMs: 1_000,
      endGraceMs: 300,
    },
    storage: { retentionDays: 180 },
    cloud: { uploadIntervalMs: 5_000, batchSize: 25 },
  };
  const service = new ReceiverService({
    config,
    source,
    store,
    uploader,
    receiverVersion: "0.2.0-test",
    logger: { info() {}, warn() {}, error() {} },
    now: () => Date.parse("2026-10-09T00:10:00.000Z"),
  });

  try {
    const runPromise = service.run();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(samplesRead, 5);

    releaseUpload();
    await runPromise;
    assert.equal(uploadCalls, 2);
  } finally {
    store.close();
  }
});
