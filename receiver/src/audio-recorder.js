import {
  access,
  mkdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import {
  AUDIO_CONTENT_TYPE,
  AUDIO_SAMPLE_RATE_HZ,
  createWaveFile,
} from "./fm-audio.js";

const COMPLETE_RECORDING_TAIL_TRIM_MS = 250;
const EDGE_FADE_MS = 20;
const TARGET_RMS_DBFS = -18;
const LIMITER_KNEE_DBFS = -3;
const LIMITER_CEILING_DBFS = -1;
const MAXIMUM_GAIN = 8;

function amplitudeForDbfs(dbfs) {
  return 32_767 * 10 ** (dbfs / 20);
}

function applyEdgeFades(pcm, sampleRateHz) {
  const sampleCount = pcm.length / 2;
  const fadeSamples = Math.min(
    Math.round((EDGE_FADE_MS * sampleRateHz) / 1_000),
    Math.floor(sampleCount / 2),
  );
  for (let index = 0; index < fadeSamples; index += 1) {
    const gain = fadeSamples === 1 ? 0 : index / (fadeSamples - 1);
    const startOffset = index * 2;
    const endOffset = (sampleCount - 1 - index) * 2;
    pcm.writeInt16LE(
      Math.round(pcm.readInt16LE(startOffset) * gain),
      startOffset,
    );
    pcm.writeInt16LE(
      Math.round(pcm.readInt16LE(endOffset) * gain),
      endOffset,
    );
  }
}

function normalizePcm(pcm) {
  let sumOfSquares = 0;
  for (let offset = 0; offset < pcm.length; offset += 2) {
    const sample = pcm.readInt16LE(offset);
    sumOfSquares += sample * sample;
  }
  const rms = Math.sqrt(sumOfSquares / (pcm.length / 2));
  if (rms < 1) {
    return pcm;
  }

  const gain = Math.min(
    MAXIMUM_GAIN,
    amplitudeForDbfs(TARGET_RMS_DBFS) / rms,
  );
  const limiterKnee = amplitudeForDbfs(LIMITER_KNEE_DBFS);
  const limiterCeiling = amplitudeForDbfs(LIMITER_CEILING_DBFS);
  const limiterRange = limiterCeiling - limiterKnee;
  const normalized = Buffer.alloc(pcm.length);
  for (let offset = 0; offset < pcm.length; offset += 2) {
    const amplified = pcm.readInt16LE(offset) * gain;
    const magnitude = Math.abs(amplified);
    const limited =
      magnitude <= limiterKnee
        ? magnitude
        : limiterKnee +
          limiterRange *
            (1 - Math.exp(-(magnitude - limiterKnee) / limiterRange));
    normalized.writeInt16LE(
      Math.round(Math.sign(amplified) * limited),
      offset,
    );
  }
  return normalized;
}

export class AudioRecorder {
  constructor({
    directory,
    maximumDurationSeconds,
    store,
    sampleRateHz = AUDIO_SAMPLE_RATE_HZ,
    logger = console,
  }) {
    this.directory = directory;
    this.maximumDurationMs = maximumDurationSeconds * 1_000;
    this.maximumBytes =
      maximumDurationSeconds * sampleRateHz * 2;
    this.sampleRateHz = sampleRateHz;
    this.store = store;
    this.logger = logger;
    this.active = null;
    this.pendingWrites = new Set();
  }

  start(eventId) {
    this.active = {
      eventId,
      buffers: [],
      byteLength: 0,
    };
  }

  append(pcm) {
    if (!this.active || !Buffer.isBuffer(pcm)) {
      return;
    }
    const remaining = this.maximumBytes - this.active.byteLength;
    if (remaining <= 0) {
      return;
    }
    const accepted = pcm.subarray(0, remaining);
    this.active.buffers.push(Buffer.from(accepted));
    this.active.byteLength += accepted.length;
  }

  cancel() {
    this.active = null;
  }

  finish(event) {
    const capture = this.active;
    this.active = null;
    if (
      !capture ||
      capture.eventId !== event.eventId ||
      capture.byteLength === 0
    ) {
      return this.store.save(event);
    }

    const capturedDurationMs = Math.min(
      event.durationMs,
      this.maximumDurationMs,
    );
    const isCompleteRecording = event.durationMs < this.maximumDurationMs;
    const desiredDurationMs =
      capturedDurationMs -
      (isCompleteRecording ? COMPLETE_RECORDING_TAIL_TRIM_MS : 0);
    const desiredBytes = Math.min(
      capture.byteLength,
      Math.round((desiredDurationMs * this.sampleRateHz * 2) / 1_000),
    );
    const pcm = Buffer.from(
      Buffer.concat(capture.buffers, capture.byteLength).subarray(0, desiredBytes),
    );
    applyEdgeFades(pcm, this.sampleRateHz);
    const normalizedPcm = normalizePcm(pcm);
    const wave = createWaveFile(normalizedPcm, this.sampleRateHz);
    const audioDurationMs = Math.round(
      (normalizedPcm.length / 2 / this.sampleRateHz) * 1_000,
    );
    const audioPath = path.join(this.directory, `${event.eventId}.wav`);
    const temporaryPath = `${audioPath}.tmp`;
    const saved = this.store.save(event, {
      audioPath,
      audioState: "preparing",
      audioContentType: AUDIO_CONTENT_TYPE,
      audioSizeBytes: wave.length,
      audioDurationMs,
    });
    if (!saved) {
      return false;
    }

    const write = mkdir(this.directory, { recursive: true })
      .then(() => writeFile(temporaryPath, wave))
      .then(() => rename(temporaryPath, audioPath))
      .then(() => {
        this.store.markAudioReady(event.eventId);
      })
      .catch(async (error) => {
        await rm(temporaryPath, { force: true });
        this.store.discardAudio(event.eventId);
        this.logger.error(
          `Unable to prepare audio for ${event.eventId}: ${error.message}`,
        );
      })
      .finally(() => {
        this.pendingWrites.delete(write);
      });
    this.pendingWrites.add(write);
    return true;
  }

  async recover() {
    for (const item of this.store.preparingAudio()) {
      try {
        await access(item.audioPath);
        this.store.markAudioReady(item.eventId);
      } catch {
        this.store.discardAudio(item.eventId);
      }
    }
  }

  async waitForPendingWrites() {
    await Promise.all(this.pendingWrites);
  }
}
