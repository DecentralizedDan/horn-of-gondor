import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import { test } from "node:test";
import {
  buildRtlFmArguments,
  RtlFmSignalSource,
} from "../src/rtl-fm-source.js";
import { rtlFmIqFullScale } from "../src/iq-power.js";

class FakeChild extends EventEmitter {
  constructor(chunks, exitCode = 1) {
    super();
    this.stdout = Readable.from(chunks);
    this.stderr = Readable.from(["simulated process exit\n"]);
    this.exitCode = null;
    this.killed = false;
    this.stdout.once("end", () => {
      if (this.exitCode === null) {
        this.exitCode = exitCode;
        this.emit("close", exitCode, null);
      }
    });
  }

  kill() {
    if (this.exitCode !== null) {
      return false;
    }
    this.killed = true;
    this.exitCode = 0;
    this.emit("close", 0, "SIGTERM");
    return true;
  }
}

function constantIqBuffer(sampleRateHz, windowMs, fraction) {
  const sampleCount = (sampleRateHz * windowMs) / 1_000;
  const amplitude = Math.round(rtlFmIqFullScale(sampleRateHz) * fraction);
  const buffer = Buffer.alloc(sampleCount * 4);
  for (let index = 0; index < sampleCount; index += 1) {
    buffer.writeInt16LE(amplitude, index * 4);
    buffer.writeInt16LE(amplitude, index * 4 + 2);
  }
  return buffer;
}

const quietLogger = {
  info() {},
  warn() {},
  error() {},
};

test("builds a fixed-gain raw-IQ rtl_fm command", () => {
  assert.deepEqual(
    buildRtlFmArguments({
      deviceIndex: 0,
      frequencyHz: 146_550_000,
      gainDb: 28,
      ppmError: 0,
      sampleRateHz: 48_000,
    }),
    [
      "-d",
      "0",
      "-f",
      "146550000",
      "-M",
      "raw",
      "-s",
      "48000",
      "-g",
      "28",
      "-p",
      "0",
      "-l",
      "0",
      "-",
    ],
  );
});

test("decodes samples and recovers after rtl_fm exits", async () => {
  const sampleRateHz = 8_000;
  const sampleIntervalMs = 100;
  const buffer = constantIqBuffer(sampleRateHz, sampleIntervalMs, 0.5);
  const children = [new FakeChild([buffer]), new FakeChild([buffer])];
  let spawnCount = 0;
  const source = new RtlFmSignalSource({
    executable: "rtl_fm",
    sampleRateHz,
    sampleIntervalMs,
    restartDelayMs: 100,
    maximumRestartAttempts: 2,
    radio: {
      deviceIndex: 0,
      frequencyHz: 146_550_000,
      gainDb: 28,
      ppmError: 0,
    },
    spawnProcess() {
      const child = children[spawnCount];
      spawnCount += 1;
      return child;
    },
    wait: async () => {},
    clock: () => 10_000,
    logger: quietLogger,
  });

  const iterator = source.samples();
  const first = await iterator.next();
  const second = await iterator.next();
  await iterator.return();

  assert.equal(spawnCount, 2);
  assert.equal(first.value.timestampMs, 9_900);
  assert.equal(second.value.timestampMs, 10_000);
  assert.ok(Math.abs(first.value.powerDbfs - -6.02) < 0.01);
  assert.ok(Math.abs(second.value.powerDbfs - -6.02) < 0.01);
});

test("stops restarting processes that repeatedly fail after brief output", async () => {
  const sampleRateHz = 8_000;
  const sampleIntervalMs = 100;
  const buffer = constantIqBuffer(sampleRateHz, sampleIntervalMs, 0.5);
  let spawnCount = 0;
  const source = new RtlFmSignalSource({
    executable: "rtl_fm",
    sampleRateHz,
    sampleIntervalMs,
    restartDelayMs: 100,
    maximumRestartAttempts: 2,
    radio: {
      deviceIndex: 0,
      frequencyHz: 146_550_000,
      gainDb: 28,
      ppmError: 0,
    },
    spawnProcess() {
      spawnCount += 1;
      return new FakeChild([buffer]);
    },
    wait: async () => {},
    clock: () => 10_000,
    logger: quietLogger,
  });

  const iterator = source.samples();
  await iterator.next();
  await iterator.next();
  await iterator.next();
  await assert.rejects(
    iterator.next(),
    /exceeded 2 restart attempt/,
  );
  assert.equal(spawnCount, 3);
});
