import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { AudioRecorder } from "../src/audio-recorder.js";
import { EventStore } from "../src/store.js";

function event() {
  return {
    eventId: "3157bbbf-7208-4873-9c1c-e99965a0d6c4",
    startedAt: "2026-10-10T12:00:00.000Z",
    durationMs: 2_000,
    peakDbfs: -20,
    averageDbfs: -25,
    score: 80,
    frequencyHz: 146_550_000,
    gainDb: 28,
    thresholdDbfs: -35,
    receiverVersion: "0.2.0-test",
  };
}

function sinePcm(durationMs, sampleRateHz = 16_000) {
  const sampleCount = Math.round((durationMs * sampleRateHz) / 1_000);
  const pcm = Buffer.alloc(sampleCount * 2);
  for (let index = 0; index < sampleCount; index += 1) {
    pcm.writeInt16LE(
      Math.round(1_000 * Math.sin((2 * Math.PI * 440 * index) / sampleRateHz)),
      index * 2,
    );
  }
  return pcm;
}

test("writes a bounded WAV clip and unblocks its queued event", async () => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "horn-of-gondor-audio-"),
  );
  const store = new EventStore(":memory:");
  const recorder = new AudioRecorder({
    directory,
    maximumDurationSeconds: 1,
    store,
    logger: { info() {}, warn() {}, error() {} },
  });

  try {
    recorder.start(event().eventId);
    recorder.append(Buffer.alloc(16_000 * 2 * 2, 1));
    assert.equal(recorder.finish(event()), true);
    assert.equal(store.pending(10).length, 0);

    await recorder.waitForPendingWrites();
    const [queued] = store.pending(10);
    assert.equal(queued.audio.state, "ready");
    assert.equal(queued.audio.durationMs, 1_000);
    assert.equal(queued.audio.sizeBytes, 32_044);

    const wave = await readFile(queued.audio.path);
    assert.equal(wave.toString("ascii", 0, 4), "RIFF");
    assert.equal(wave.length, 32_044);
  } finally {
    store.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("trims, fades, and normalizes a complete recording", async () => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "horn-of-gondor-audio-"),
  );
  const store = new EventStore(":memory:");
  const recorder = new AudioRecorder({
    directory,
    maximumDurationSeconds: 10,
    store,
    logger: { info() {}, warn() {}, error() {} },
  });

  try {
    const pcm = sinePcm(2_000);
    for (let offset = pcm.length - 8_000; offset < pcm.length; offset += 2) {
      pcm.writeInt16LE(32_767, offset);
    }
    recorder.start(event().eventId);
    recorder.append(pcm);
    assert.equal(recorder.finish(event()), true);

    await recorder.waitForPendingWrites();
    const [queued] = store.pending(10);
    assert.equal(queued.audio.durationMs, 1_750);
    assert.equal(queued.audio.sizeBytes, 56_044);

    const wave = await readFile(queued.audio.path);
    const samples = new Int16Array(
      wave.buffer,
      wave.byteOffset + 44,
      (wave.length - 44) / 2,
    );
    assert.equal(samples[0], 0);
    assert.equal(samples[samples.length - 1], 0);

    let sumOfSquares = 0;
    let peak = 0;
    for (const sample of samples) {
      sumOfSquares += sample * sample;
      peak = Math.max(peak, Math.abs(sample));
    }
    const rms = Math.sqrt(sumOfSquares / samples.length);
    const rmsDbfs = 20 * Math.log10(rms / 32_767);
    assert.ok(Math.abs(rmsDbfs - -18) < 0.1);
    assert.ok(peak <= Math.round(32_767 * 10 ** (-1 / 20)));
  } finally {
    store.close();
    await rm(directory, { recursive: true, force: true });
  }
});
