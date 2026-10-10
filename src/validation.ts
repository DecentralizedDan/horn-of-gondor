import type { TransmissionInput } from "./types";

export interface ValidationDetail {
  field: string;
  message: string;
}

export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; details: ValidationDetail[] };

const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const RFC3339_MILLISECONDS =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const MAX_AUDIO_BYTES = 2 * 1_024 * 1_024;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isIntegerInRange(
  value: unknown,
  minimum: number,
  maximum: number,
): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= minimum &&
    value <= maximum
  );
}

function isCanonicalTimestamp(value: unknown): value is string {
  if (typeof value !== "string" || !RFC3339_MILLISECONDS.test(value)) {
    return false;
  }

  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value;
}

export function validateTransmission(
  input: unknown,
): ValidationResult<TransmissionInput> {
  if (!isObject(input)) {
    return {
      ok: false,
      details: [{ field: "$", message: "Must be a JSON object." }],
    };
  }

  const details: ValidationDetail[] = [];

  if (typeof input.eventId !== "string" || !UUID_V4.test(input.eventId)) {
    details.push({ field: "eventId", message: "Must be a UUID v4." });
  }

  if (!isCanonicalTimestamp(input.startedAt)) {
    details.push({
      field: "startedAt",
      message: "Must be an RFC 3339 UTC timestamp with millisecond precision.",
    });
  }

  if (!isIntegerInRange(input.durationMs, 1_000, 3_600_000)) {
    details.push({
      field: "durationMs",
      message: "Must be an integer from 1000 through 3600000.",
    });
  }

  for (const field of [
    "peakDbfs",
    "averageDbfs",
    "thresholdDbfs",
  ] as const) {
    if (!isFiniteNumber(input[field]) || input[field] > 0) {
      details.push({
        field,
        message: "Must be a finite number no greater than 0.",
      });
    }
  }

  if (
    isFiniteNumber(input.peakDbfs) &&
    isFiniteNumber(input.averageDbfs) &&
    input.peakDbfs < input.averageDbfs
  ) {
    details.push({
      field: "peakDbfs",
      message: "Must be greater than or equal to averageDbfs.",
    });
  }

  if (!isIntegerInRange(input.score, 0, 100)) {
    details.push({
      field: "score",
      message: "Must be an integer from 0 through 100.",
    });
  }

  if (!isIntegerInRange(input.frequencyHz, 144_000_000, 148_000_000)) {
    details.push({
      field: "frequencyHz",
      message: "Must be an integer from 144000000 through 148000000.",
    });
  }

  if (
    !isFiniteNumber(input.gainDb) ||
    input.gainDb < 0 ||
    input.gainDb > 60
  ) {
    details.push({
      field: "gainDb",
      message: "Must be a finite number from 0 through 60.",
    });
  }

  if (
    typeof input.receiverVersion !== "string" ||
    input.receiverVersion.length < 1 ||
    input.receiverVersion.length > 50
  ) {
    details.push({
      field: "receiverVersion",
      message: "Must be a nonempty string no longer than 50 characters.",
    });
  }

  const audioAvailable = input.audioAvailable === true;
  if (
    input.audioAvailable !== undefined &&
    typeof input.audioAvailable !== "boolean"
  ) {
    details.push({
      field: "audioAvailable",
      message: "Must be a boolean when supplied.",
    });
  }
  if (audioAvailable) {
    if (input.audioContentType !== "audio/wav") {
      details.push({
        field: "audioContentType",
        message: 'Must be "audio/wav" when audio is available.',
      });
    }
    if (!isIntegerInRange(input.audioSizeBytes, 44, MAX_AUDIO_BYTES)) {
      details.push({
        field: "audioSizeBytes",
        message: `Must be an integer from 44 through ${MAX_AUDIO_BYTES}.`,
      });
    }
    if (
      !isIntegerInRange(input.audioDurationMs, 1, 30_000) ||
      (isIntegerInRange(input.durationMs, 1_000, 3_600_000) &&
        input.audioDurationMs > input.durationMs)
    ) {
      details.push({
        field: "audioDurationMs",
        message:
          "Must be from 1 through 30000 and no longer than the transmission.",
      });
    }
  }

  if (details.length > 0) {
    return { ok: false, details };
  }

  return {
    ok: true,
    value: {
      ...(input as unknown as TransmissionInput),
      audioAvailable,
      audioContentType: audioAvailable
        ? (input.audioContentType as string)
        : null,
      audioSizeBytes: audioAvailable
        ? (input.audioSizeBytes as number)
        : null,
      audioDurationMs: audioAvailable
        ? (input.audioDurationMs as number)
        : null,
    },
  };
}

export function validateSettings(
  input: unknown,
): ValidationResult<{
  retentionDays: number;
  audioRetentionDays: number;
}> {
  if (!isObject(input)) {
    return {
      ok: false,
      details: [{ field: "$", message: "Must be a JSON object." }],
    };
  }

  const details: ValidationDetail[] = [];
  if (!isIntegerInRange(input.retentionDays, 1, 3_650)) {
    details.push({
      field: "retentionDays",
      message: "Must be an integer from 1 through 3650.",
    });
  }
  if (
    input.audioRetentionDays !== undefined &&
    !isIntegerInRange(input.audioRetentionDays, 1, 3_650)
  ) {
    details.push({
      field: "audioRetentionDays",
      message: "Must be an integer from 1 through 3650.",
    });
  }
  if (details.length > 0) {
    return {
      ok: false,
      details,
    };
  }

  return {
    ok: true,
    value: {
      retentionDays: input.retentionDays as number,
      audioRetentionDays:
        (input.audioRetentionDays as number | undefined) ?? 1,
    },
  };
}
