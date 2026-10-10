import assert from "node:assert/strict";
import { test } from "node:test";
import {
  IqPowerDecoder,
  rtlFmDownsampleFactor,
  rtlFmIqFullScale,
} from "../src/iq-power.js";
import { createWaveFile } from "../src/fm-audio.js";

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

test("demodulates FM audio alongside each power window", () => {
  const sampleRateHz = 48_000;
  const samples = [];
  let phase = 0;
  for (let index = 0; index < 4_800; index += 1) {
    const modulation = Math.sin(
      (2 * Math.PI * 1_000 * index) / sampleRateHz,
    );
    phase += (2 * Math.PI * 3_000 * modulation) / sampleRateHz;
    samples.push([
      Math.round(2_000 * Math.cos(phase)),
      Math.round(2_000 * Math.sin(phase)),
    ]);
  }
  const decoder = new IqPowerDecoder({
    sampleRateHz,
    windowMs: 100,
    iqFullScale: 2_688,
    audioSampleRateHz: 16_000,
  });

  const [decoded] = decoder.push(iqBuffer(samples));
  assert.equal(decoded.audioPcm.length, 3_200);
  assert.ok(decoded.audioPcm.some((byte) => byte !== 0));

  const wave = createWaveFile(decoded.audioPcm);
  assert.equal(wave.toString("ascii", 0, 4), "RIFF");
  assert.equal(wave.toString("ascii", 8, 12), "WAVE");
  assert.equal(wave.readUInt32LE(40), decoded.audioPcm.length);
});
