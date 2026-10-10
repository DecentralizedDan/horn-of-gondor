import { randomUUID } from "node:crypto";
import { calculateScore } from "./scoring.js";

function roundSignal(value) {
  return Math.round(value * 100) / 100;
}

export class TransmissionDetector {
  constructor({
    thresholdDbfs,
    scoreRangeDb,
    minimumDurationMs,
    endGraceMs,
    sampleIntervalMs,
    frequencyHz,
    gainDb,
    receiverVersion,
    createEventId = randomUUID,
  }) {
    this.thresholdDbfs = thresholdDbfs;
    this.scoreRangeDb = scoreRangeDb;
    this.minimumDurationMs = minimumDurationMs;
    this.endGraceMs = endGraceMs;
    this.sampleIntervalMs = sampleIntervalMs;
    this.frequencyHz = frequencyHz;
    this.gainDb = gainDb;
    this.receiverVersion = receiverVersion;
    this.createEventId = createEventId;
    this.active = null;
    this.lastTimestampMs = null;
  }

  addSample({ timestampMs, powerDbfs }) {
    if (!Number.isSafeInteger(timestampMs)) {
      throw new TypeError("Sample timestampMs must be a safe integer.");
    }
    if (!Number.isFinite(powerDbfs) || powerDbfs > 0) {
      throw new TypeError(
        "Sample powerDbfs must be a finite number no greater than 0.",
      );
    }
    if (
      this.lastTimestampMs !== null &&
      timestampMs <= this.lastTimestampMs
    ) {
      throw new RangeError("Sample timestamps must increase monotonically.");
    }
    this.lastTimestampMs = timestampMs;

    if (!this.active) {
      if (powerDbfs >= this.thresholdDbfs) {
        this.startTransmission(timestampMs, powerDbfs);
      }
      return null;
    }

    if (powerDbfs >= this.thresholdDbfs) {
      this.active.lastAboveMs = timestampMs;
      this.active.belowSinceMs = null;
      this.active.peakDbfs = Math.max(this.active.peakDbfs, powerDbfs);
      this.active.signalSum += powerDbfs;
      this.active.signalSamples += 1;
      return null;
    }

    if (this.active.belowSinceMs === null) {
      this.active.belowSinceMs = timestampMs;
    }

    if (timestampMs - this.active.belowSinceMs >= this.endGraceMs) {
      return this.finishTransmission();
    }

    return null;
  }

  flush() {
    return this.active ? this.finishTransmission() : null;
  }

  get isActive() {
    return this.active !== null;
  }

  get activeEventId() {
    return this.active?.eventId ?? null;
  }

  startTransmission(timestampMs, powerDbfs) {
    this.active = {
      eventId: this.createEventId(),
      startedAtMs: timestampMs,
      lastAboveMs: timestampMs,
      belowSinceMs: null,
      peakDbfs: powerDbfs,
      signalSum: powerDbfs,
      signalSamples: 1,
    };
  }

  finishTransmission() {
    const active = this.active;
    this.active = null;

    const durationMs =
      active.lastAboveMs - active.startedAtMs + this.sampleIntervalMs;
    if (durationMs < this.minimumDurationMs) {
      return null;
    }

    const peakDbfs = roundSignal(active.peakDbfs);
    const averageDbfs = roundSignal(
      active.signalSum / active.signalSamples,
    );

    return {
      eventId: active.eventId,
      startedAt: new Date(active.startedAtMs).toISOString(),
      durationMs,
      peakDbfs,
      averageDbfs,
      score: calculateScore({
        peakDbfs,
        averageDbfs,
        thresholdDbfs: this.thresholdDbfs,
        scoreRangeDb: this.scoreRangeDb,
      }),
      frequencyHz: this.frequencyHz,
      gainDb: this.gainDb,
      thresholdDbfs: this.thresholdDbfs,
      receiverVersion: this.receiverVersion,
    };
  }
}
