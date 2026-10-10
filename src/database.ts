import type {
  Env,
  Transmission,
  TransmissionInput,
  TransmissionRow,
} from "./types";

const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface CursorValue {
  startedAtMs: number;
  eventId: string;
}

export type InsertResult =
  | { outcome: "created"; transmission: Transmission }
  | { outcome: "duplicate"; transmission: Transmission }
  | { outcome: "conflict" };

function rowToTransmission(row: TransmissionRow): Transmission {
  return {
    eventId: row.event_id,
    startedAt: new Date(row.started_at_ms).toISOString(),
    durationMs: row.duration_ms,
    peakDbfs: row.peak_dbfs,
    averageDbfs: row.average_dbfs,
    score: row.score,
    frequencyHz: row.frequency_hz,
    gainDb: row.gain_db,
    thresholdDbfs: row.threshold_dbfs,
    receiverVersion: row.receiver_version,
    audioAvailable: row.audio_available === 1,
    audioContentType: row.audio_content_type,
    audioSizeBytes: row.audio_size_bytes,
    audioDurationMs: row.audio_duration_ms,
    receivedAt: new Date(row.received_at_ms).toISOString(),
  };
}

function rowMatchesInput(
  row: TransmissionRow,
  input: TransmissionInput,
): boolean {
  return (
    row.event_id === input.eventId &&
    row.started_at_ms === new Date(input.startedAt).getTime() &&
    row.duration_ms === input.durationMs &&
    row.peak_dbfs === input.peakDbfs &&
    row.average_dbfs === input.averageDbfs &&
    row.score === input.score &&
    row.frequency_hz === input.frequencyHz &&
    row.gain_db === input.gainDb &&
    row.threshold_dbfs === input.thresholdDbfs &&
    row.receiver_version === input.receiverVersion &&
    row.audio_available === (input.audioAvailable ? 1 : 0) &&
    row.audio_content_type === (input.audioContentType ?? null) &&
    row.audio_size_bytes === (input.audioSizeBytes ?? null) &&
    row.audio_duration_ms === (input.audioDurationMs ?? null)
  );
}

function encodeCursor(value: CursorValue): string {
  return btoa(JSON.stringify(value))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

export function decodeCursor(cursor: string): CursorValue | null {
  try {
    const normalized = cursor.replaceAll("-", "+").replaceAll("_", "/");
    const padding = "=".repeat((4 - (normalized.length % 4)) % 4);
    const value: unknown = JSON.parse(atob(normalized + padding));

    if (
      typeof value !== "object" ||
      value === null ||
      !("startedAtMs" in value) ||
      !("eventId" in value)
    ) {
      return null;
    }

    const { startedAtMs, eventId } = value as Record<string, unknown>;
    if (
      typeof startedAtMs !== "number" ||
      !Number.isSafeInteger(startedAtMs) ||
      typeof eventId !== "string" ||
      !UUID_V4.test(eventId)
    ) {
      return null;
    }

    return { startedAtMs, eventId };
  } catch {
    return null;
  }
}

export async function insertTransmission(
  db: D1Database,
  input: TransmissionInput,
  now = Date.now(),
): Promise<InsertResult> {
  const startedAtMs = new Date(input.startedAt).getTime();
  const insert = await db
    .prepare(
      `INSERT OR IGNORE INTO transmissions (
        event_id, started_at_ms, duration_ms, peak_dbfs, average_dbfs,
        score, frequency_hz, gain_db, threshold_dbfs, receiver_version,
        audio_available, audio_content_type, audio_size_bytes,
        audio_duration_ms, received_at_ms
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      input.eventId,
      startedAtMs,
      input.durationMs,
      input.peakDbfs,
      input.averageDbfs,
      input.score,
      input.frequencyHz,
      input.gainDb,
      input.thresholdDbfs,
      input.receiverVersion,
      input.audioAvailable ? 1 : 0,
      input.audioContentType ?? null,
      input.audioSizeBytes ?? null,
      input.audioDurationMs ?? null,
      now,
    )
    .run();

  if ((insert.meta.changes ?? 0) > 0) {
    return {
      outcome: "created",
      transmission: {
        ...input,
        receivedAt: new Date(now).toISOString(),
      },
    };
  }

  const existing = await db
    .prepare("SELECT * FROM transmissions WHERE event_id = ?")
    .bind(input.eventId)
    .first<TransmissionRow>();

  if (existing && rowMatchesInput(existing, input)) {
    return {
      outcome: "duplicate",
      transmission: rowToTransmission(existing),
    };
  }

  return { outcome: "conflict" };
}

export async function getLatestTransmission(
  db: D1Database,
): Promise<Transmission | null> {
  const row = await db
    .prepare(
      `SELECT * FROM transmissions
       ORDER BY started_at_ms DESC, event_id DESC
       LIMIT 1`,
    )
    .first<TransmissionRow>();

  return row ? rowToTransmission(row) : null;
}

export async function getTransmissionById(
  db: D1Database,
  eventId: string,
): Promise<Transmission | null> {
  const row = await db
    .prepare("SELECT * FROM transmissions WHERE event_id = ?")
    .bind(eventId)
    .first<TransmissionRow>();
  return row ? rowToTransmission(row) : null;
}

export async function listTransmissions(
  db: D1Database,
  limit: number,
  cursor: CursorValue | null,
  sinceMs: number | null = null,
): Promise<{
  transmissions: Transmission[];
  nextCursor: string | null;
  hasMore: boolean;
}> {
  const conditions: string[] = [];
  const bindings: Array<number | string> = [];

  if (sinceMs !== null) {
    conditions.push("started_at_ms >= ?");
    bindings.push(sinceMs);
  }

  if (cursor) {
    conditions.push(
      "(started_at_ms < ? OR (started_at_ms = ? AND event_id < ?))",
    );
    bindings.push(cursor.startedAtMs, cursor.startedAtMs, cursor.eventId);
  }

  const where =
    conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const statement = db
    .prepare(
      `SELECT * FROM transmissions
       ${where}
       ORDER BY started_at_ms DESC, event_id DESC
       LIMIT ?`,
    )
    .bind(...bindings, limit + 1);

  const result = await statement.all<TransmissionRow>();
  const rows = result.results;
  const hasMore = rows.length > limit;
  const visibleRows = hasMore ? rows.slice(0, limit) : rows;
  const lastRow = visibleRows.at(-1);

  return {
    transmissions: visibleRows.map(rowToTransmission),
    nextCursor:
      hasMore && lastRow
        ? encodeCursor({
            startedAtMs: lastRow.started_at_ms,
            eventId: lastRow.event_id,
          })
        : null,
    hasMore,
  };
}

export async function updateRetention(
  db: D1Database,
  retentionDays: number,
  audioRetentionDays: number,
  now = Date.now(),
): Promise<{
  retentionDays: number;
  audioRetentionDays: number;
  updatedAt: string;
}> {
  await db
    .prepare(
      `INSERT INTO settings (
         id, retention_days, audio_retention_days, updated_at_ms
       )
       VALUES (1, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         retention_days = excluded.retention_days,
         audio_retention_days = excluded.audio_retention_days,
         updated_at_ms = excluded.updated_at_ms`,
    )
    .bind(retentionDays, audioRetentionDays, now)
    .run();

  return {
    retentionDays,
    audioRetentionDays,
    updatedAt: new Date(now).toISOString(),
  };
}

export async function deleteExpiredTransmissions(
  env: Pick<Env, "DB" | "AUDIO">,
  now = Date.now(),
): Promise<number> {
  const setting = await env.DB.prepare(
    `SELECT retention_days, audio_retention_days
     FROM settings WHERE id = 1`,
  ).first<{
    retention_days: number;
    audio_retention_days: number;
  }>();

  const storedRetentionDays = setting?.retention_days;
  const retentionDays =
    Number.isInteger(storedRetentionDays) &&
    storedRetentionDays !== undefined &&
    storedRetentionDays >= 1 &&
    storedRetentionDays <= 3_650
      ? storedRetentionDays
      : 180;
  const cutoff = now - retentionDays * 86_400_000;
  const storedAudioRetentionDays = setting?.audio_retention_days;
  const audioRetentionDays =
    Number.isInteger(storedAudioRetentionDays) &&
    storedAudioRetentionDays !== undefined &&
    storedAudioRetentionDays >= 1 &&
    storedAudioRetentionDays <= 3_650
      ? storedAudioRetentionDays
      : 1;
  const audioCutoff = now - audioRetentionDays * 86_400_000;

  const audioKeys: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await env.AUDIO.list({ cursor });
    for (const object of page.objects) {
      if (
        object.key.startsWith("audio/") &&
        object.uploaded.getTime() < audioCutoff
      ) {
        audioKeys.push(object.key);
      }
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);

  for (let index = 0; index < audioKeys.length; index += 1_000) {
    await env.AUDIO.delete(audioKeys.slice(index, index + 1_000));
  }
  const expiredEventIds = audioKeys
    .map((key) => key.match(/^audio\/([0-9a-f-]+)\.wav$/)?.[1])
    .filter((eventId): eventId is string => Boolean(eventId));
  for (let index = 0; index < expiredEventIds.length; index += 100) {
    await env.DB.batch(
      expiredEventIds.slice(index, index + 100).map((eventId) =>
        env.DB
          .prepare(
            `UPDATE transmissions
             SET audio_available = 0,
                 audio_content_type = NULL,
                 audio_size_bytes = NULL,
                 audio_duration_ms = NULL
             WHERE event_id = ?`,
          )
          .bind(eventId),
      ),
    );
  }
  await env.DB.prepare(
    `UPDATE transmissions
     SET audio_available = 0,
         audio_content_type = NULL,
         audio_size_bytes = NULL,
         audio_duration_ms = NULL
     WHERE audio_available = 1 AND received_at_ms < ?`,
  )
    .bind(audioCutoff)
    .run();

  const result = await env.DB.prepare(
    "DELETE FROM transmissions WHERE started_at_ms < ?",
  )
    .bind(cutoff)
    .run();

  return result.meta.changes ?? 0;
}
