import { TransmissionDetector } from "./detector.js";

const RETENTION_INTERVAL_MS = 86_400_000;

export class ReceiverService {
  constructor({
    config,
    source,
    store,
    uploader = null,
    recorder = null,
    receiverVersion,
    logger = console,
    now = Date.now,
  }) {
    this.config = config;
    this.source = source;
    this.store = store;
    this.uploader = uploader;
    this.recorder = recorder;
    this.receiverVersion = receiverVersion;
    this.logger = logger;
    this.now = now;
  }

  async run({ signal } = {}) {
    const detector = new TransmissionDetector({
      ...this.config.detection,
      sampleIntervalMs: this.config.source.sampleIntervalMs,
      frequencyHz: this.config.radio.frequencyHz,
      gainDb: this.config.radio.gainDb,
      receiverVersion: this.receiverVersion,
    });

    let nextUploadAt = this.now();
    let nextRetentionAt = this.now();
    let uploadPromise = null;

    if (this.recorder) {
      await this.recorder.recover();
    }

    const retentionSyncPromise = this.uploader
      ? this.uploader
          .syncRetention(
            this.config.storage.retentionDays,
            this.config.recording?.retentionDays ?? 1,
            signal,
          )
          .catch((error) => {
            if (!signal?.aborted) {
              this.logger.warn(
                `Retention synchronization failed: ${error.message}`,
              );
            }
          })
      : Promise.resolve();

    const startUpload = () => {
      if (!this.uploader || uploadPromise) {
        return;
      }
      uploadPromise = this.upload(signal)
        .catch((error) => {
          if (!signal?.aborted) {
            this.logger.warn(`Upload pass failed: ${error.message}`);
          }
        })
        .finally(() => {
          uploadPromise = null;
        });
    };

    for await (const sample of this.source.samples({ signal })) {
      const wasActive = detector.isActive;
      if (wasActive && this.recorder) {
        this.recorder.append(sample.audioPcm);
      }
      const event = detector.addSample(sample);
      if (!wasActive && detector.isActive && this.recorder) {
        this.recorder.start(detector.activeEventId);
        this.recorder.append(sample.audioPcm);
      }
      if (wasActive && !detector.isActive && this.recorder) {
        if (event) {
          this.record(event);
        } else {
          this.recorder.cancel();
        }
      } else if (event) {
        this.record(event);
      }

      const currentTime = this.now();
      if (this.uploader && currentTime >= nextUploadAt) {
        startUpload();
        nextUploadAt = currentTime + this.config.cloud.uploadIntervalMs;
      }
      if (currentTime >= nextRetentionAt) {
        this.cleanUp(currentTime);
        nextRetentionAt = currentTime + RETENTION_INTERVAL_MS;
      }
    }

    const finalEvent = detector.flush();
    if (finalEvent) {
      this.record(finalEvent);
    } else {
      this.recorder?.cancel();
    }
    if (this.recorder) {
      await this.recorder.waitForPendingWrites();
    }

    if (this.uploader) {
      await retentionSyncPromise;
      if (uploadPromise) {
        await uploadPromise;
      }
      if (!signal?.aborted) {
        await this.upload().catch((error) => {
          this.logger.warn(`Final upload pass failed: ${error.message}`);
        });
      }
    }
    this.cleanUp(this.now());

    return this.store.counts();
  }

  record(event) {
    const saved = this.recorder
      ? this.recorder.finish(event)
      : this.store.save(event);
    if (saved) {
      this.logger.info(
        `Detected transmission ${event.eventId}: ${event.durationMs} ms, peak ${event.peakDbfs} dBFS, score ${event.score}`,
      );
    }
  }

  async upload(signal) {
    const summary = await this.uploader.uploadPending(
      this.config.cloud.batchSize,
      this.now(),
      signal,
    );
    if (summary.attempted > 0) {
      this.logger.info(
        `Upload pass: ${summary.uploaded} uploaded, ${summary.rejected} rejected, ${summary.deferred} deferred`,
      );
    }
  }

  cleanUp(now) {
    const deleted = this.store.deleteExpiredUploaded(
      this.config.storage.retentionDays,
      now,
    );
    if (deleted > 0) {
      this.logger.info(`Deleted ${deleted} expired local transmission(s).`);
    }
  }
}
