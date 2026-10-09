import assert from "node:assert/strict";
import { test } from "node:test";
import { EventStore } from "../src/store.js";
import { UploadClient } from "../src/uploader.js";

function event(overrides = {}) {
  return {
    eventId: "3157bbbf-7208-4873-9c1c-e99965a0d6c4",
    startedAt: "2026-01-01T00:00:00.000Z",
    durationMs: 2_000,
    peakDbfs: -30,
    averageDbfs: -40,
    score: 68,
    frequencyHz: 146_550_000,
    gainDb: 28,
    thresholdDbfs: -70,
    receiverVersion: "0.2.0-test",
    ...overrides,
  };
}

const quietLogger = {
  info() {},
  warn() {},
  error() {},
};

test("stores events idempotently and retains unsynchronized events", () => {
  const store = new EventStore(":memory:");
  try {
    assert.equal(store.save(event()), true);
    assert.equal(store.save(event()), false);
    assert.deepEqual(store.counts(), {
      pending: 1,
      uploaded: 0,
      rejected: 0,
    });

    const farFuture = Date.parse("2027-01-01T00:00:00.000Z");
    assert.equal(store.deleteExpiredUploaded(180, farFuture), 0);

    store.markUploaded(event().eventId, farFuture);
    assert.equal(store.deleteExpiredUploaded(180, farFuture), 1);
    assert.deepEqual(store.counts(), {
      pending: 0,
      uploaded: 0,
      rejected: 0,
    });
  } finally {
    store.close();
  }
});

test("uploads pending events and synchronizes retention", async () => {
  const store = new EventStore(":memory:");
  const requests = [];
  store.save(event());

  const client = new UploadClient({
    apiBaseUrl: "https://example.com",
    uploadToken: "test-token-with-at-least-32-characters",
    requestTimeoutMs: 10_000,
    store,
    logger: quietLogger,
    fetchImplementation: async (url, options) => {
      requests.push({
        url,
        method: options.method,
        body: JSON.parse(options.body),
        authorization: options.headers.Authorization,
      });
      return Response.json({ data: {} }, { status: 200 });
    },
  });

  try {
    await client.syncRetention(180);
    const summary = await client.uploadPending(25);

    assert.deepEqual(summary, {
      attempted: 1,
      uploaded: 1,
      rejected: 0,
      deferred: 0,
    });
    assert.deepEqual(store.counts(), {
      pending: 0,
      uploaded: 1,
      rejected: 0,
    });
    assert.equal(requests[0].url, "https://example.com/api/v1/settings");
    assert.deepEqual(requests[0].body, { retentionDays: 180 });
    assert.equal(
      requests[1].url,
      "https://example.com/api/v1/transmissions",
    );
    assert.deepEqual(requests[1].body, event());
  } finally {
    store.close();
  }
});

test("defers temporary upload failures with backoff", async () => {
  const store = new EventStore(":memory:");
  const now = Date.parse("2026-10-09T00:00:00.000Z");
  store.save(event(), now);
  const client = new UploadClient({
    apiBaseUrl: "https://example.com",
    uploadToken: "test-token-with-at-least-32-characters",
    requestTimeoutMs: 10_000,
    store,
    logger: quietLogger,
    random: () => 0.5,
    fetchImplementation: async () =>
      Response.json(
        { error: { message: "Temporarily unavailable." } },
        { status: 503 },
      ),
  });

  try {
    const summary = await client.uploadPending(25, now);
    assert.deepEqual(summary, {
      attempted: 1,
      uploaded: 0,
      rejected: 0,
      deferred: 1,
    });
    assert.equal(store.pending(25, now).length, 0);
    assert.equal(store.pending(25, now + 5_000).length, 1);
  } finally {
    store.close();
  }
});

test("pauses uploads after an authentication failure without discarding events", async () => {
  const store = new EventStore(":memory:");
  store.save(event());
  let requestCount = 0;
  const client = new UploadClient({
    apiBaseUrl: "https://example.com",
    uploadToken: "incorrect-token-with-at-least-32-characters",
    requestTimeoutMs: 10_000,
    store,
    logger: quietLogger,
    fetchImplementation: async () => {
      requestCount += 1;
      return Response.json(
        { error: { message: "A valid upload token is required." } },
        { status: 401 },
      );
    },
  });

  try {
    assert.deepEqual(await client.uploadPending(25), {
      attempted: 1,
      uploaded: 0,
      rejected: 0,
      deferred: 1,
    });
    assert.deepEqual(await client.uploadPending(25), {
      attempted: 0,
      uploaded: 0,
      rejected: 0,
      deferred: 0,
    });
    assert.equal(requestCount, 1);
    assert.deepEqual(store.counts(), {
      pending: 1,
      uploaded: 0,
      rejected: 0,
    });
  } finally {
    store.close();
  }
});
