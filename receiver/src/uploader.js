const PERMANENT_EVENT_STATUSES = new Set([400, 409, 413]);
const AUTHENTICATION_STATUSES = new Set([401, 403]);

async function responseMessage(response) {
  try {
    const body = await response.json();
    return body.error?.message ?? `HTTP ${response.status}`;
  } catch {
    return `HTTP ${response.status}`;
  }
}

export class UploadClient {
  constructor({
    apiBaseUrl,
    uploadToken,
    requestTimeoutMs,
    store,
    fetchImplementation = globalThis.fetch,
    random = Math.random,
    logger = console,
  }) {
    this.apiBaseUrl = apiBaseUrl;
    this.uploadToken = uploadToken;
    this.requestTimeoutMs = requestTimeoutMs;
    this.store = store;
    this.fetch = fetchImplementation;
    this.random = random;
    this.logger = logger;
    this.authenticationPaused = false;
  }

  headers() {
    return {
      Authorization: `Bearer ${this.uploadToken}`,
      "Content-Type": "application/json",
    };
  }

  requestSignal(signal) {
    const timeout = AbortSignal.timeout(this.requestTimeoutMs);
    return signal ? AbortSignal.any([signal, timeout]) : timeout;
  }

  async syncRetention(retentionDays, signal) {
    const response = await this.fetch(`${this.apiBaseUrl}/api/v1/settings`, {
      method: "PUT",
      headers: this.headers(),
      body: JSON.stringify({ retentionDays }),
      signal: this.requestSignal(signal),
    });

    if (AUTHENTICATION_STATUSES.has(response.status)) {
      await response.arrayBuffer();
      this.authenticationPaused = true;
      throw new Error(
        "Cloud authentication failed; uploads are paused until the receiver restarts.",
      );
    }
    if (!response.ok) {
      throw new Error(
        `Unable to synchronize retention: ${await responseMessage(response)}`,
      );
    }
    await response.arrayBuffer();
  }

  async uploadPending(limit, now = Date.now(), signal) {
    if (this.authenticationPaused) {
      return { attempted: 0, uploaded: 0, rejected: 0, deferred: 0 };
    }

    const queued = this.store.pending(limit, now);
    const summary = {
      attempted: queued.length,
      uploaded: 0,
      rejected: 0,
      deferred: 0,
    };

    for (const [index, queuedEvent] of queued.entries()) {
      const { event, attempts } = queuedEvent;
      try {
        const response = await this.fetch(
          `${this.apiBaseUrl}/api/v1/transmissions`,
          {
            method: "POST",
            headers: this.headers(),
            body: JSON.stringify(event),
            signal: this.requestSignal(signal),
          },
        );

        if (response.ok) {
          await response.arrayBuffer();
          this.store.markUploaded(event.eventId, now);
          summary.uploaded += 1;
          continue;
        }

        const message = await responseMessage(response);
        if (AUTHENTICATION_STATUSES.has(response.status)) {
          this.authenticationPaused = true;
          summary.attempted = index + 1;
          summary.deferred += queued.length - index;
          this.logger.error(
            "Cloud authentication failed; uploads are paused until the receiver restarts.",
          );
          break;
        }
        if (PERMANENT_EVENT_STATUSES.has(response.status)) {
          this.store.markRejected(event.eventId, message);
          summary.rejected += 1;
          this.logger.error(
            `Cloud rejected transmission ${event.eventId}: ${message}`,
          );
          continue;
        }

        this.defer(event.eventId, attempts, message, now);
        summary.deferred += 1;
      } catch (error) {
        if (signal?.aborted) {
          summary.attempted = index + 1;
          summary.deferred += queued.length - index;
          break;
        }
        const message =
          error instanceof Error ? error.message : String(error);
        this.defer(event.eventId, attempts, message, now);
        summary.deferred += 1;
      }
    }

    return summary;
  }

  defer(eventId, attempts, message, now) {
    const baseDelayMs = Math.min(300_000, 5_000 * 2 ** attempts);
    const jitter = 0.75 + this.random() * 0.5;
    const nextAttemptAtMs = now + Math.round(baseDelayMs * jitter);
    this.store.markRetry(eventId, message, nextAttemptAtMs);
    this.logger.warn(
      `Upload deferred for transmission ${eventId}: ${message}`,
    );
  }
}
