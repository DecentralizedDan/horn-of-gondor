const RTL_FM_MINIMUM_CAPTURE_RATE_HZ = 1_000_000;
const RTL_ADC_FULL_SCALE = 128;

export function rtlFmDownsampleFactor(sampleRateHz) {
  return Math.floor(RTL_FM_MINIMUM_CAPTURE_RATE_HZ / sampleRateHz) + 1;
}

export function rtlFmIqFullScale(sampleRateHz) {
  return RTL_ADC_FULL_SCALE * rtlFmDownsampleFactor(sampleRateHz);
}

export class IqPowerDecoder {
  constructor({
    sampleRateHz,
    windowMs,
    iqFullScale = rtlFmIqFullScale(sampleRateHz),
  }) {
    const samplesPerWindow = (sampleRateHz * windowMs) / 1_000;
    if (!Number.isInteger(samplesPerWindow) || samplesPerWindow < 1) {
      throw new RangeError(
        "sampleRateHz and windowMs must produce a whole number of samples.",
      );
    }
    if (!Number.isFinite(iqFullScale) || iqFullScale <= 0) {
      throw new RangeError("iqFullScale must be a positive number.");
    }

    this.samplesPerWindow = samplesPerWindow;
    this.iqFullScaleSquared = iqFullScale ** 2;
    this.remainder = Buffer.alloc(0);
    this.powerSum = 0;
    this.sampleCount = 0;
  }

  push(chunk) {
    const incoming = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    const buffer =
      this.remainder.length > 0
        ? Buffer.concat([this.remainder, incoming])
        : incoming;
    const completeLength = buffer.length - (buffer.length % 4);
    const powersDbfs = [];

    for (let offset = 0; offset < completeLength; offset += 4) {
      const inPhase = buffer.readInt16LE(offset);
      const quadrature = buffer.readInt16LE(offset + 2);
      this.powerSum += inPhase ** 2 + quadrature ** 2;
      this.sampleCount += 1;

      if (this.sampleCount === this.samplesPerWindow) {
        const meanPower =
          this.powerSum /
          (this.samplesPerWindow * 2 * this.iqFullScaleSquared);
        const powerDbfs =
          meanPower > 0 ? 10 * Math.log10(meanPower) : -200;
        powersDbfs.push(Math.max(-200, Math.min(0, powerDbfs)));
        this.powerSum = 0;
        this.sampleCount = 0;
      }
    }

    this.remainder = buffer.subarray(completeLength);
    return powersDbfs;
  }
}
