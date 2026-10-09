CREATE TABLE transmissions (
  event_id TEXT PRIMARY KEY NOT NULL,
  started_at_ms INTEGER NOT NULL,
  duration_ms INTEGER NOT NULL,
  peak_dbfs REAL NOT NULL,
  average_dbfs REAL NOT NULL,
  score INTEGER NOT NULL,
  frequency_hz INTEGER NOT NULL,
  gain_db REAL NOT NULL,
  threshold_dbfs REAL NOT NULL,
  receiver_version TEXT NOT NULL,
  received_at_ms INTEGER NOT NULL
);

CREATE INDEX idx_transmissions_started_at
ON transmissions (started_at_ms DESC, event_id DESC);

CREATE TABLE settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  retention_days INTEGER NOT NULL
    CHECK (retention_days BETWEEN 1 AND 3650),
  updated_at_ms INTEGER NOT NULL
);

INSERT INTO settings (id, retention_days, updated_at_ms)
VALUES (1, 180, 0);
