export interface Env {
  DB: D1Database;
  AUDIO: R2Bucket;
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
  audioAvailable?: boolean;
  audioContentType?: string | null;
  audioSizeBytes?: number | null;
  audioDurationMs?: number | null;
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
  audio_available: number;
  audio_content_type: string | null;
  audio_size_bytes: number | null;
  audio_duration_ms: number | null;
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
