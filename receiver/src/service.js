import { TransmissionDetector } from "./detector.js";

const RETENTION_INTERVAL_MS = 86_400_000;

export class ReceiverService {
  constructor({
    config,
    source,
    store,
    uploader = null,
    receiverVersion,
    logger = console,
    now = Date.now,
  }) {
    this.config = config;
    this.source = source;
    this.store = store;
    this.uploader = uploader;
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

    const retentionSyncPromise = this.uploader
      ? this.uploader
          .syncRetention(this.config.storage.retentionDays, signal)
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
      const event = detector.addSample(sample);
      if (event) {
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
    if (this.store.save(event)) {
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
