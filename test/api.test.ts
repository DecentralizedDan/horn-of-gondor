import { env, SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { deleteExpiredTransmissions } from "../src/database";
import type { TransmissionInput } from "../src/types";

const AUTHORIZATION = "Bearer test-token-with-at-least-32-characters";

beforeEach(async () => {
  await env.DB.prepare("DELETE FROM transmissions").run();
  await env.DB.prepare(
    "UPDATE settings SET retention_days = 180, updated_at_ms = 0 WHERE id = 1",
  ).run();
  const audio = await env.AUDIO.list();
  if (audio.objects.length > 0) {
    await env.AUDIO.delete(audio.objects.map(({ key }) => key));
  }
});

function transmission(
  overrides: Partial<TransmissionInput> = {},
): TransmissionInput {
  return {
    eventId: "3157bbbf-7208-4873-9c1c-e99965a0d6c4",
    startedAt: "2026-10-09T00:31:42.127Z",
    durationMs: 4_380,
    peakDbfs: -31.4,
    averageDbfs: -39.8,
    score: 76,
    frequencyHz: 146_550_000,
    gainDb: 28,
    thresholdDbfs: -62,
    receiverVersion: "0.2.0",
    ...overrides,
  };
}

async function postTransmission(
  event: TransmissionInput,
  authorization = AUTHORIZATION,
): Promise<Response> {
  return SELF.fetch("https://example.com/api/v1/transmissions", {
    method: "POST",
    headers: {
      Authorization: authorization,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(event),
  });
}

function waveFile(): ArrayBuffer {
  const buffer = new ArrayBuffer(44);
  const wave = new Uint8Array(buffer);
  wave.set(new TextEncoder().encode("RIFF"), 0);
  wave.set(new TextEncoder().encode("WAVE"), 8);
  return buffer;
}

async function putAudio(eventId: string): Promise<Response> {
  return SELF.fetch(
    `https://example.com/api/v1/transmissions/${eventId}/audio`,
    {
      method: "PUT",
      headers: {
        Authorization: AUTHORIZATION,
        "Content-Type": "audio/wav",
      },
      body: waveFile(),
    },
  );
}

describe("Horn of Gondor API", () => {
  it("requires authentication for uploads", async () => {
    const response = await SELF.fetch(
      "https://example.com/api/v1/transmissions",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(transmission()),
      },
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "unauthorized" },
    });
  });

  it("creates, reads, and idempotently retries a transmission", async () => {
    const event = transmission();
    const created = await postTransmission(event);
    expect(created.status).toBe(201);
    await expect(created.json()).resolves.toMatchObject({
      data: {
        eventId: event.eventId,
        duplicate: false,
      },
    });

    const latest = await SELF.fetch(
      "https://example.com/api/v1/transmissions/latest",
    );
    expect(latest.status).toBe(200);
    expect(latest.headers.get("X-Robots-Tag")).toBe(
      "noindex, nofollow, noarchive, nosnippet",
    );
    expect(latest.headers.get("Access-Control-Allow-Origin")).toBe("*");
    const latestBody = await latest.json<{
      data: TransmissionInput & { receivedAt: string };
    }>();
    expect(latestBody.data).toMatchObject(event);
    expect(latestBody.data.receivedAt).toMatch(/Z$/);

    const etag = latest.headers.get("ETag");
    expect(etag).toBeTruthy();
    const unchanged = await SELF.fetch(
      "https://example.com/api/v1/transmissions/latest",
      { headers: { "If-None-Match": etag ?? "" } },
    );
    expect(unchanged.status).toBe(304);

    const duplicate = await postTransmission(event);
    expect(duplicate.status).toBe(200);
    await expect(duplicate.json()).resolves.toMatchObject({
      data: {
        eventId: event.eventId,
        duplicate: true,
      },
    });

    const conflict = await postTransmission({
      ...event,
      score: event.score - 1,
    });
    expect(conflict.status).toBe(409);
    await expect(conflict.json()).resolves.toMatchObject({
      error: { code: "event_conflict" },
    });
  });

  it("validates event fields", async () => {
    const response = await postTransmission(
      transmission({
        durationMs: 500,
        frequencyHz: 150_000_000,
      }),
    );

    expect(response.status).toBe(400);
    const body = await response.json<{
      error: { code: string; details: Array<{ field: string }> };
    }>();
    expect(body.error.code).toBe("validation_error");
    expect(body.error.details.map(({ field }) => field)).toEqual(
      expect.arrayContaining(["durationMs", "frequencyHz"]),
    );
  });

  it("rejects malformed and oversized request bodies", async () => {
    const malformed = await SELF.fetch(
      "https://example.com/api/v1/transmissions",
      {
        method: "POST",
        headers: {
          Authorization: AUTHORIZATION,
          "Content-Type": "application/json",
        },
        body: "{",
      },
    );
    expect(malformed.status).toBe(400);
    await expect(malformed.json()).resolves.toMatchObject({
      error: { code: "invalid_json" },
    });

    const oversized = await SELF.fetch(
      "https://example.com/api/v1/transmissions",
      {
        method: "POST",
        headers: {
          Authorization: AUTHORIZATION,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ padding: "x".repeat(16 * 1_024) }),
      },
    );
    expect(oversized.status).toBe(413);
    await expect(oversized.json()).resolves.toMatchObject({
      error: { code: "payload_too_large" },
    });
  });

  it("paginates history from newest to oldest", async () => {
    const events = [
      transmission({
        eventId: "11111111-1111-4111-8111-111111111111",
        startedAt: "2026-10-09T00:00:01.000Z",
      }),
      transmission({
        eventId: "22222222-2222-4222-8222-222222222222",
        startedAt: "2026-10-09T00:00:02.000Z",
      }),
      transmission({
        eventId: "33333333-3333-4333-8333-333333333333",
        startedAt: "2026-10-09T00:00:03.000Z",
      }),
    ];

    for (const event of events) {
      expect((await postTransmission(event)).status).toBe(201);
    }

    const firstResponse = await SELF.fetch(
      "https://example.com/api/v1/transmissions?limit=2",
    );
    const first = await firstResponse.json<{
      data: Array<{ eventId: string }>;
      pagination: { hasMore: boolean; nextCursor: string };
    }>();
    expect(first.data.map(({ eventId }) => eventId)).toEqual([
      events[2].eventId,
      events[1].eventId,
    ]);
    expect(first.pagination.hasMore).toBe(true);

    const secondResponse = await SELF.fetch(
      `https://example.com/api/v1/transmissions?limit=2&cursor=${encodeURIComponent(first.pagination.nextCursor)}`,
    );
    const second = await secondResponse.json<{
      data: Array<{ eventId: string }>;
      pagination: { hasMore: boolean; nextCursor: null };
    }>();
    expect(second.data.map(({ eventId }) => eventId)).toEqual([
      events[0].eventId,
    ]);
    expect(second.pagination).toEqual({
      hasMore: false,
      nextCursor: null,
    });

    const filteredResponse = await SELF.fetch(
      "https://example.com/api/v1/transmissions?since=2026-10-09T00%3A00%3A02.500Z",
    );
    const filtered = await filteredResponse.json<{
      data: Array<{ eventId: string }>;
    }>();
    expect(filtered.data.map(({ eventId }) => eventId)).toEqual([
      events[2].eventId,
    ]);
  });

  it("rejects an invalid history start time", async () => {
    const response = await SELF.fetch(
      "https://example.com/api/v1/transmissions?since=ten-minutes-ago",
    );
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "validation_error",
        details: [{ field: "since" }],
      },
    });
  });

  it("rejects invalid cursors and unsupported methods", async () => {
    const invalidCursor = await SELF.fetch(
      "https://example.com/api/v1/transmissions?cursor=not-a-cursor",
    );
    expect(invalidCursor.status).toBe(400);
    await expect(invalidCursor.json()).resolves.toMatchObject({
      error: { code: "invalid_cursor" },
    });

    const unsupportedMethod = await SELF.fetch(
      "https://example.com/api/v1/transmissions/latest",
      { method: "POST" },
    );
    expect(unsupportedMethod.status).toBe(405);
    expect(unsupportedMethod.headers.get("Allow")).toBe("GET");
  });

  it("updates the cloud retention setting", async () => {
    const response = await SELF.fetch("https://example.com/api/v1/settings", {
      method: "PUT",
      headers: {
        Authorization: AUTHORIZATION,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ retentionDays: 90 }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: {
        retentionDays: 90,
        audioRetentionDays: 1,
      },
    });
  });

  it("publishes audio only after the object is uploaded", async () => {
    const event = transmission({
      audioAvailable: true,
      audioContentType: "audio/wav",
      audioSizeBytes: 44,
      audioDurationMs: 1_000,
    });

    const missingAudio = await postTransmission(event);
    expect(missingAudio.status).toBe(400);
    await expect(missingAudio.json()).resolves.toMatchObject({
      error: { code: "audio_not_found" },
    });

    expect((await putAudio(event.eventId)).status).toBe(201);
    expect((await postTransmission(event)).status).toBe(201);

    const playback = await SELF.fetch(
      `https://example.com/api/v1/transmissions/${event.eventId}/audio`,
    );
    expect(playback.status).toBe(200);
    expect(playback.headers.get("Content-Type")).toBe("audio/wav");
    expect((await playback.arrayBuffer()).byteLength).toBe(44);

    const latest = await SELF.fetch(
      "https://example.com/api/v1/transmissions/latest",
    );
    await expect(latest.json()).resolves.toMatchObject({
      data: {
        eventId: event.eventId,
        audioAvailable: true,
        audioDurationMs: 1_000,
      },
    });
  });

  it("expires audio independently while retaining measurements", async () => {
    const event = transmission({
      audioAvailable: true,
      audioContentType: "audio/wav",
      audioSizeBytes: 44,
      audioDurationMs: 1_000,
    });
    expect((await putAudio(event.eventId)).status).toBe(201);
    expect((await postTransmission(event)).status).toBe(201);

    await deleteExpiredTransmissions(env, Date.now() + 2 * 86_400_000);

    const playback = await SELF.fetch(
      `https://example.com/api/v1/transmissions/${event.eventId}/audio`,
    );
    expect(playback.status).toBe(404);

    const latest = await SELF.fetch(
      "https://example.com/api/v1/transmissions/latest",
    );
    await expect(latest.json()).resolves.toMatchObject({
      data: {
        eventId: event.eventId,
        audioAvailable: false,
      },
    });
  });

  it("deletes results older than the configured retention period", async () => {
    const oldEvent = transmission({
      eventId: "44444444-4444-4444-8444-444444444444",
      startedAt: "2026-04-01T00:00:00.000Z",
    });
    const recentEvent = transmission({
      eventId: "55555555-5555-4555-8555-555555555555",
      startedAt: "2026-10-01T00:00:00.000Z",
    });
    expect((await postTransmission(oldEvent)).status).toBe(201);
    expect((await postTransmission(recentEvent)).status).toBe(201);

    const deleted = await deleteExpiredTransmissions(
      env,
      Date.parse("2026-10-09T00:00:00.000Z"),
    );
    expect(deleted).toBe(1);

    const remaining = await env.DB.prepare(
      "SELECT event_id FROM transmissions ORDER BY event_id",
    ).all<{ event_id: string }>();
    expect(remaining.results).toEqual([{ event_id: recentEvent.eventId }]);
  });
});
