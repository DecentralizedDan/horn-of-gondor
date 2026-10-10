export const AUDIO_SAMPLE_RATE_HZ = 16_000;
export const AUDIO_CONTENT_TYPE = "audio/wav";

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

export class FmAudioDemodulator {
  constructor({
    iqSampleRateHz,
    audioSampleRateHz = AUDIO_SAMPLE_RATE_HZ,
    deviationHz = 5_000,
    deEmphasisMicroseconds = 75,
  }) {
    if (
      !Number.isInteger(iqSampleRateHz / audioSampleRateHz) ||
      iqSampleRateHz < audioSampleRateHz
    ) {
      throw new RangeError(
        "IQ sample rate must be an integer multiple of the audio sample rate.",
      );
    }

    this.iqSampleRateHz = iqSampleRateHz;
    this.decimation = iqSampleRateHz / audioSampleRateHz;
    this.phaseScale =
      iqSampleRateHz / (2 * Math.PI * deviationHz);
    const timeConstantSeconds = deEmphasisMicroseconds / 1_000_000;
    this.deEmphasisAlpha =
      1 / (1 + iqSampleRateHz * timeConstantSeconds);
    this.previousInPhase = null;
    this.previousQuadrature = null;
    this.previousDiscriminator = 0;
    this.dcBlocked = 0;
    this.deEmphasized = 0;
    this.decimationSum = 0;
    this.decimationCount = 0;
  }

  push(inPhase, quadrature) {
    let discriminator = 0;
    if (this.previousInPhase !== null) {
      const real =
        inPhase * this.previousInPhase +
        quadrature * this.previousQuadrature;
      const imaginary =
        quadrature * this.previousInPhase -
        inPhase * this.previousQuadrature;
      discriminator =
        Math.atan2(imaginary, real) * this.phaseScale;
    }
    this.previousInPhase = inPhase;
    this.previousQuadrature = quadrature;

    this.dcBlocked =
      discriminator -
      this.previousDiscriminator +
      0.995 * this.dcBlocked;
    this.previousDiscriminator = discriminator;
    this.deEmphasized +=
      this.deEmphasisAlpha * (this.dcBlocked - this.deEmphasized);

    this.decimationSum += this.deEmphasized;
    this.decimationCount += 1;
    if (this.decimationCount < this.decimation) {
      return null;
    }

    const audio = this.decimationSum / this.decimationCount;
    this.decimationSum = 0;
    this.decimationCount = 0;
    return Math.round(clamp(audio, -1, 1) * 32_767);
  }
}

export function createWaveFile(pcm, sampleRateHz = AUDIO_SAMPLE_RATE_HZ) {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRateHz, 24);
  header.writeUInt32LE(sampleRateHz * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}
