export interface Env {
  DB: D1Database;
  INGEST_TOKEN: string;
}

export interface TransmissionInput {
  eventId: string;
  startedAt: string;
  durationMs: number;
  peakDbfs: number;
  averageDbfs: number;
  score: number;
  frequencyHz: number;
  gainDb: number;
  thresholdDbfs: number;
  receiverVersion: string;
}

export interface Transmission extends TransmissionInput {
  receivedAt: string;
}

export interface TransmissionRow {
  event_id: string;
  started_at_ms: number;
  duration_ms: number;
  peak_dbfs: number;
  average_dbfs: number;
  score: number;
  frequency_hz: number;
  gain_db: number;
  threshold_dbfs: number;
  receiver_version: string;
  received_at_ms: number;
}

export interface ApiError {
  code: string;
  message: string;
  details?: Array<{
    field: string;
    message: string;
  }>;
}
