import { mkdirSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

function rowToEvent(row, includeAudio = false) {
  const event = {
    eventId: row.event_id,
    startedAt: row.started_at,
    durationMs: row.duration_ms,
    peakDbfs: row.peak_dbfs,
    averageDbfs: row.average_dbfs,
    score: row.score,
    frequencyHz: row.frequency_hz,
    gainDb: row.gain_db,
    thresholdDbfs: row.threshold_dbfs,
    receiverVersion: row.receiver_version,
  };
  if (includeAudio) {
    event.audioAvailable = true;
    event.audioContentType = row.audio_content_type;
    event.audioSizeBytes = row.audio_size_bytes;
    event.audioDurationMs = row.audio_duration_ms;
  }
  return event;
}

export class EventStore {
  constructor(databasePath) {
    if (databasePath !== ":memory:") {
      mkdirSync(path.dirname(databasePath), { recursive: true });
    }

    this.database = new Database(databasePath);
    this.database.pragma("journal_mode = WAL");
    this.initialize();
    this.prepareStatements();
  }

  initialize() {
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS receiver_events (
        event_id TEXT PRIMARY KEY NOT NULL,
        started_at TEXT NOT NULL,
        started_at_ms INTEGER NOT NULL,
        duration_ms INTEGER NOT NULL,
        peak_dbfs REAL NOT NULL,
        average_dbfs REAL NOT NULL,
        score INTEGER NOT NULL,
        frequency_hz INTEGER NOT NULL,
        gain_db REAL NOT NULL,
        threshold_dbfs REAL NOT NULL,
        receiver_version TEXT NOT NULL,
        upload_state TEXT NOT NULL DEFAULT 'pending'
          CHECK (upload_state IN ('pending', 'uploaded', 'rejected')),
        upload_attempts INTEGER NOT NULL DEFAULT 0,
        next_attempt_at_ms INTEGER NOT NULL DEFAULT 0,
        last_upload_error TEXT,
        created_at_ms INTEGER NOT NULL,
        uploaded_at_ms INTEGER,
        audio_path TEXT,
        audio_state TEXT NOT NULL DEFAULT 'none'
          CHECK (audio_state IN ('none', 'preparing', 'ready', 'uploaded')),
        audio_content_type TEXT,
        audio_size_bytes INTEGER,
        audio_duration_ms INTEGER
      );

      CREATE INDEX IF NOT EXISTS idx_receiver_events_upload_queue
      ON receiver_events (upload_state, next_attempt_at_ms, started_at_ms);

      CREATE INDEX IF NOT EXISTS idx_receiver_events_retention
      ON receiver_events (upload_state, started_at_ms);
    `);

    const columns = new Set(
      this.database
        .prepare("PRAGMA table_info(receiver_events)")
        .all()
        .map((column) => column.name),
    );
    const additions = [
      ["audio_path", "TEXT"],
      ["audio_state", "TEXT NOT NULL DEFAULT 'none'"],
      ["audio_content_type", "TEXT"],
      ["audio_size_bytes", "INTEGER"],
      ["audio_duration_ms", "INTEGER"],
    ];
    for (const [name, definition] of additions) {
      if (!columns.has(name)) {
        this.database.exec(
          `ALTER TABLE receiver_events ADD COLUMN ${name} ${definition}`,
        );
      }
    }
  }

  prepareStatements() {
    this.insertEvent = this.database.prepare(`
      INSERT OR IGNORE INTO receiver_events (
        event_id, started_at, started_at_ms, duration_ms, peak_dbfs,
        average_dbfs, score, frequency_hz, gain_db, threshold_dbfs,
        receiver_version, created_at_ms, audio_path, audio_state,
        audio_content_type, audio_size_bytes, audio_duration_ms
      ) VALUES (
        @eventId, @startedAt, @startedAtMs, @durationMs, @peakDbfs,
        @averageDbfs, @score, @frequencyHz, @gainDb, @thresholdDbfs,
        @receiverVersion, @createdAtMs, @audioPath, @audioState,
        @audioContentType, @audioSizeBytes, @audioDurationMs
      )
    `);
    this.selectPending = this.database.prepare(`
      SELECT * FROM receiver_events
      WHERE upload_state = 'pending'
        AND audio_state != 'preparing'
        AND next_attempt_at_ms <= ?
      ORDER BY started_at_ms ASC
      LIMIT ?
    `);
    this.updateUploaded = this.database.prepare(`
      UPDATE receiver_events
      SET upload_state = 'uploaded',
          upload_attempts = upload_attempts + 1,
          last_upload_error = NULL,
          uploaded_at_ms = ?
      WHERE event_id = ?
    `);
    this.updateRetry = this.database.prepare(`
      UPDATE receiver_events
      SET upload_attempts = upload_attempts + 1,
          next_attempt_at_ms = ?,
          last_upload_error = ?
      WHERE event_id = ?
    `);
    this.updateRejected = this.database.prepare(`
      UPDATE receiver_events
      SET upload_state = 'rejected',
          upload_attempts = upload_attempts + 1,
          last_upload_error = ?
      WHERE event_id = ?
    `);
    this.updateAudioReady = this.database.prepare(`
      UPDATE receiver_events
      SET audio_state = 'ready'
      WHERE event_id = ? AND audio_state = 'preparing'
    `);
    this.updateAudioUploaded = this.database.prepare(`
      UPDATE receiver_events
      SET audio_state = 'uploaded'
      WHERE event_id = ? AND audio_state = 'ready'
    `);
    this.discardEventAudio = this.database.prepare(`
      UPDATE receiver_events
      SET audio_path = NULL,
          audio_state = 'none',
          audio_content_type = NULL,
          audio_size_bytes = NULL,
          audio_duration_ms = NULL
      WHERE event_id = ?
    `);
    this.clearEventAudioPath = this.database.prepare(`
      UPDATE receiver_events
      SET audio_path = NULL
      WHERE event_id = ?
    `);
    this.selectPreparingAudio = this.database.prepare(`
      SELECT event_id, audio_path
      FROM receiver_events
      WHERE audio_state = 'preparing' AND audio_path IS NOT NULL
    `);
    this.deleteExpired = this.database.prepare(`
      DELETE FROM receiver_events
      WHERE upload_state = 'uploaded' AND started_at_ms < ?
    `);
    this.selectCounts = this.database.prepare(`
      SELECT upload_state, COUNT(*) AS count
      FROM receiver_events
      GROUP BY upload_state
    `);
  }

  save(event, audio = {}, now = Date.now()) {
    if (typeof audio === "number") {
      now = audio;
      audio = {};
    }
    const result = this.insertEvent.run({
      ...event,
      startedAtMs: Date.parse(event.startedAt),
      createdAtMs: now,
      audioPath: audio.audioPath ?? null,
      audioState: audio.audioState ?? "none",
      audioContentType: audio.audioContentType ?? null,
      audioSizeBytes: audio.audioSizeBytes ?? null,
      audioDurationMs: audio.audioDurationMs ?? null,
    });
    return result.changes > 0;
  }

  pending(limit, now = Date.now()) {
    return this.selectPending.all(now, limit).map((row) => ({
      event: rowToEvent(row, row.audio_state === "uploaded"),
      attempts: row.upload_attempts,
      audio: {
        path: row.audio_path,
        state: row.audio_state,
        contentType: row.audio_content_type,
        sizeBytes: row.audio_size_bytes,
        durationMs: row.audio_duration_ms,
      },
    }));
  }

  markUploaded(eventId, now = Date.now()) {
    this.updateUploaded.run(now, eventId);
  }

  markRetry(eventId, error, nextAttemptAtMs) {
    this.updateRetry.run(
      nextAttemptAtMs,
      String(error).slice(0, 1_000),
      eventId,
    );
  }

  markRejected(eventId, error) {
    this.updateRejected.run(String(error).slice(0, 1_000), eventId);
  }

  markAudioReady(eventId) {
    this.updateAudioReady.run(eventId);
  }

  markAudioUploaded(eventId) {
    this.updateAudioUploaded.run(eventId);
  }

  discardAudio(eventId) {
    this.discardEventAudio.run(eventId);
  }

  clearAudioPath(eventId) {
    this.clearEventAudioPath.run(eventId);
  }

  preparingAudio() {
    return this.selectPreparingAudio.all().map((row) => ({
      eventId: row.event_id,
      audioPath: row.audio_path,
    }));
  }

  deleteExpiredUploaded(retentionDays, now = Date.now()) {
    const cutoff = now - retentionDays * 86_400_000;
    return this.deleteExpired.run(cutoff).changes;
  }

  counts() {
    const counts = {
      pending: 0,
      uploaded: 0,
      rejected: 0,
    };
    for (const row of this.selectCounts.all()) {
      counts[row.upload_state] = row.count;
    }
    return counts;
  }

  close() {
    this.database.close();
  }
}
