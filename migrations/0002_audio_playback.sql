ALTER TABLE transmissions
ADD COLUMN audio_available INTEGER NOT NULL DEFAULT 0
CHECK (audio_available IN (0, 1));

ALTER TABLE transmissions
ADD COLUMN audio_content_type TEXT;

ALTER TABLE transmissions
ADD COLUMN audio_size_bytes INTEGER;

ALTER TABLE transmissions
ADD COLUMN audio_duration_ms INTEGER;

ALTER TABLE settings
ADD COLUMN audio_retention_days INTEGER NOT NULL DEFAULT 1
CHECK (audio_retention_days BETWEEN 1 AND 3650);
