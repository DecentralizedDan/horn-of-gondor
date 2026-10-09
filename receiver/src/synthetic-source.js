import { setTimeout as delay } from "node:timers/promises";

export class SyntheticSignalSource {
  constructor({
    sampleIntervalMs,
    segments,
    realtime,
    repeat,
    startTimeMs = Date.now(),
  }) {
    this.sampleIntervalMs = sampleIntervalMs;
    this.segments = segments;
    this.realtime = realtime;
    this.repeat = repeat;
    this.startTimeMs = startTimeMs;
  }

  async *samples({ signal } = {}) {
    let timestampMs = this.startTimeMs;

    do {
      for (const segment of this.segments) {
        const sampleCount = segment.durationMs / this.sampleIntervalMs;
        for (let index = 0; index < sampleCount; index += 1) {
          if (signal?.aborted) {
            return;
          }

          yield {
            timestampMs,
            powerDbfs: segment.powerDbfs,
          };
          timestampMs += this.sampleIntervalMs;

          if (this.realtime) {
            try {
              await delay(this.sampleIntervalMs, undefined, { signal });
            } catch (error) {
              if (error.name === "AbortError") {
                return;
              }
              throw error;
            }
          }
        }
      }
    } while (this.repeat && !signal?.aborted);
  }
}
