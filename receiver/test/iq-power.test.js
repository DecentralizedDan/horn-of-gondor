import assert from "node:assert/strict";
import { test } from "node:test";
import {
  IqPowerDecoder,
  rtlFmDownsampleFactor,
  rtlFmIqFullScale,
} from "../src/iq-power.js";

function iqBuffer(samples) {
  const buffer = Buffer.alloc(samples.length * 4);
  samples.forEach(([inPhase, quadrature], index) => {
    buffer.writeInt16LE(inPhase, index * 4);
    buffer.writeInt16LE(quadrature, index * 4 + 2);
  });
  return buffer;
}

test("derives RTL-FM scaling from its native downsample behavior", () => {
  assert.equal(rtlFmDownsampleFactor(48_000), 21);
  assert.equal(rtlFmIqFullScale(48_000), 2_688);
});

test("calculates complex IQ power across arbitrary chunk boundaries", () => {
  const decoder = new IqPowerDecoder({
    sampleRateHz: 1_000,
    windowMs: 4,
    iqFullScale: 1_000,
  });
  const buffer = iqBuffer([
    [500, 500],
    [500, 500],
    [500, 500],
    [500, 500],
  ]);

  assert.deepEqual(decoder.push(buffer.subarray(0, 3)), []);
  const powers = decoder.push(buffer.subarray(3));
  assert.equal(powers.length, 1);
  assert.ok(Math.abs(powers[0] - -6.0206) < 0.001);
});

test("reports silence at the measurement floor", () => {
  const decoder = new IqPowerDecoder({
    sampleRateHz: 1_000,
    windowMs: 1,
    iqFullScale: 1_000,
  });

  assert.deepEqual(decoder.push(iqBuffer([[0, 0]])), [-200]);
});
