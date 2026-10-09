import { readFile } from "node:fs/promises";
import path from "node:path";

export class ConfigurationError extends Error {
  constructor(details) {
    super(`Invalid receiver configuration:\n- ${details.join("\n- ")}`);
    this.name = "ConfigurationError";
    this.details = details;
  }
}

function isObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function numberInRange(value, minimum, maximum) {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= minimum &&
    value <= maximum
  );
}

function integerInRange(value, minimum, maximum) {
  return Number.isInteger(value) && value >= minimum && value <= maximum;
}

export function validateConfig(
  input,
  {
    configDirectory = process.cwd(),
    environment = process.env,
    requireCloudToken = true,
  } = {},
) {
  const errors = [];

  if (!isObject(input)) {
    throw new ConfigurationError(["The root value must be a JSON object."]);
  }

  if (input.version !== 1) {
    errors.push("version must be 1.");
  }

  if (!isObject(input.source)) {
    errors.push("source must be an object.");
  } else {
    if (!["synthetic", "rtl_fm"].includes(input.source.type)) {
      errors.push('source.type must be "synthetic" or "rtl_fm".');
    }
    if (!integerInRange(input.source.sampleIntervalMs, 10, 1_000)) {
      errors.push("source.sampleIntervalMs must be an integer from 10 to 1000.");
    }

    const synthetic = input.source.synthetic;
    if (input.source.type === "synthetic" && !isObject(synthetic)) {
      errors.push("source.synthetic must be an object.");
    } else if (isObject(synthetic)) {
      if (typeof synthetic.realtime !== "boolean") {
        errors.push("source.synthetic.realtime must be a boolean.");
      }
      if (typeof synthetic.repeat !== "boolean") {
        errors.push("source.synthetic.repeat must be a boolean.");
      }
      if (!Array.isArray(synthetic.segments) || synthetic.segments.length === 0) {
        errors.push("source.synthetic.segments must be a nonempty array.");
      } else {
        synthetic.segments.forEach((segment, index) => {
          if (!isObject(segment)) {
            errors.push(`source.synthetic.segments[${index}] must be an object.`);
            return;
          }
          if (
            !integerInRange(
              segment.durationMs,
              input.source.sampleIntervalMs ?? 10,
              3_600_000,
            )
          ) {
            errors.push(
              `source.synthetic.segments[${index}].durationMs must be an integer at least as large as source.sampleIntervalMs.`,
            );
          } else if (
            segment.durationMs % input.source.sampleIntervalMs !== 0
          ) {
            errors.push(
              `source.synthetic.segments[${index}].durationMs must be divisible by source.sampleIntervalMs.`,
            );
          }
          if (!numberInRange(segment.powerDbfs, -200, 0)) {
            errors.push(
              `source.synthetic.segments[${index}].powerDbfs must be from -200 through 0.`,
            );
          }
        });
      }
    }

    const rtlFm = input.source.rtlFm;
    if (input.source.type === "rtl_fm" && !isObject(rtlFm)) {
      errors.push("source.rtlFm must be an object.");
    } else if (isObject(rtlFm)) {
      if (
        typeof rtlFm.executable !== "string" ||
        rtlFm.executable.trim() === ""
      ) {
        errors.push("source.rtlFm.executable must be a nonempty string.");
      }
      if (!integerInRange(rtlFm.sampleRateHz, 8_000, 256_000)) {
        errors.push(
          "source.rtlFm.sampleRateHz must be an integer from 8000 through 256000.",
        );
      } else if (
        integerInRange(input.source.sampleIntervalMs, 10, 1_000) &&
        (rtlFm.sampleRateHz * input.source.sampleIntervalMs) % 1_000 !== 0
      ) {
        errors.push(
          "source.rtlFm.sampleRateHz multiplied by source.sampleIntervalMs must produce a whole number of IQ samples.",
        );
      }
      if (!integerInRange(rtlFm.restartDelayMs, 100, 60_000)) {
        errors.push(
          "source.rtlFm.restartDelayMs must be an integer from 100 through 60000.",
        );
      }
      if (!integerInRange(rtlFm.maximumRestartAttempts, 0, 100)) {
        errors.push(
          "source.rtlFm.maximumRestartAttempts must be an integer from 0 through 100.",
        );
      }
    }
  }

  if (!isObject(input.radio)) {
    errors.push("radio must be an object.");
  } else {
    if (!integerInRange(input.radio.deviceIndex, 0, 100)) {
      errors.push("radio.deviceIndex must be an integer from 0 through 100.");
    }
    if (!integerInRange(input.radio.frequencyHz, 144_000_000, 148_000_000)) {
      errors.push(
        "radio.frequencyHz must be an integer from 144000000 through 148000000.",
      );
    }
    if (!numberInRange(input.radio.gainDb, 0, 60)) {
      errors.push("radio.gainDb must be from 0 through 60.");
    }
    if (
      input.radio.ppmError !== undefined &&
      !integerInRange(input.radio.ppmError, -100, 100)
    ) {
      errors.push("radio.ppmError must be an integer from -100 through 100.");
    }
  }

  if (!isObject(input.detection)) {
    errors.push("detection must be an object.");
  } else {
    if (!numberInRange(input.detection.thresholdDbfs, -200, 0)) {
      errors.push("detection.thresholdDbfs must be from -200 through 0.");
    }
    if (!numberInRange(input.detection.scoreRangeDb, 1, 200)) {
      errors.push("detection.scoreRangeDb must be from 1 through 200.");
    }
    if (
      numberInRange(input.detection.thresholdDbfs, -200, 0) &&
      numberInRange(input.detection.scoreRangeDb, 1, 200) &&
      input.detection.thresholdDbfs + input.detection.scoreRangeDb > 0
    ) {
      errors.push(
        "detection.thresholdDbfs plus detection.scoreRangeDb must not exceed 0 dBFS.",
      );
    }
    if (!integerInRange(input.detection.minimumDurationMs, 1_000, 3_600_000)) {
      errors.push(
        "detection.minimumDurationMs must be an integer from 1000 through 3600000.",
      );
    }
    if (!integerInRange(input.detection.endGraceMs, 0, 60_000)) {
      errors.push(
        "detection.endGraceMs must be an integer from 0 through 60000.",
      );
    }
  }

  if (!isObject(input.storage)) {
    errors.push("storage must be an object.");
  } else {
    if (
      typeof input.storage.databasePath !== "string" ||
      input.storage.databasePath.trim() === ""
    ) {
      errors.push("storage.databasePath must be a nonempty string.");
    }
    if (!integerInRange(input.storage.retentionDays, 1, 3_650)) {
      errors.push("storage.retentionDays must be an integer from 1 through 3650.");
    }
  }

  if (!isObject(input.cloud)) {
    errors.push("cloud must be an object.");
  } else {
    if (typeof input.cloud.enabled !== "boolean") {
      errors.push("cloud.enabled must be a boolean.");
    }
    let cloudUrl = null;
    try {
      cloudUrl = new URL(input.cloud.apiBaseUrl);
      if (!["http:", "https:"].includes(cloudUrl.protocol)) {
        throw new Error("Unsupported protocol.");
      }
    } catch {
      errors.push("cloud.apiBaseUrl must be an absolute HTTP or HTTPS URL.");
    }
    if (
      input.cloud.enabled === true &&
      cloudUrl?.protocol === "http:" &&
      !["localhost", "127.0.0.1", "[::1]"].includes(cloudUrl.hostname)
    ) {
      errors.push(
        "cloud.apiBaseUrl must use HTTPS when cloud uploads are enabled.",
      );
    }
    if (!integerInRange(input.cloud.uploadIntervalMs, 1_000, 3_600_000)) {
      errors.push(
        "cloud.uploadIntervalMs must be an integer from 1000 through 3600000.",
      );
    }
    if (!integerInRange(input.cloud.requestTimeoutMs, 1_000, 120_000)) {
      errors.push(
        "cloud.requestTimeoutMs must be an integer from 1000 through 120000.",
      );
    }
    if (!integerInRange(input.cloud.batchSize, 1, 100)) {
      errors.push("cloud.batchSize must be an integer from 1 through 100.");
    }

    const uploadToken =
      environment.HORN_OF_GONDOR_UPLOAD_TOKEN ?? input.cloud.uploadToken;
    if (
      requireCloudToken &&
      input.cloud.enabled === true &&
      (typeof uploadToken !== "string" || uploadToken.length < 32)
    ) {
      errors.push(
        "cloud upload token must contain at least 32 characters when uploads are enabled.",
      );
    }
  }

  if (errors.length > 0) {
    throw new ConfigurationError(errors);
  }

  const uploadToken =
    environment.HORN_OF_GONDOR_UPLOAD_TOKEN ?? input.cloud.uploadToken;

  return {
    version: 1,
    source: {
      type: input.source.type,
      sampleIntervalMs: input.source.sampleIntervalMs,
      synthetic: input.source.synthetic
        ? {
            realtime: input.source.synthetic.realtime,
            repeat: input.source.synthetic.repeat,
            segments: input.source.synthetic.segments.map((segment) => ({
              durationMs: segment.durationMs,
              powerDbfs: segment.powerDbfs,
            })),
          }
        : null,
      rtlFm: input.source.rtlFm
        ? {
            executable: input.source.rtlFm.executable,
            sampleRateHz: input.source.rtlFm.sampleRateHz,
            restartDelayMs: input.source.rtlFm.restartDelayMs,
            maximumRestartAttempts:
              input.source.rtlFm.maximumRestartAttempts,
          }
        : null,
    },
    radio: {
      deviceIndex: input.radio.deviceIndex,
      frequencyHz: input.radio.frequencyHz,
      gainDb: input.radio.gainDb,
      ppmError: input.radio.ppmError ?? 0,
    },
    detection: {
      thresholdDbfs: input.detection.thresholdDbfs,
      scoreRangeDb: input.detection.scoreRangeDb,
      minimumDurationMs: input.detection.minimumDurationMs,
      endGraceMs: input.detection.endGraceMs,
    },
    storage: {
      databasePath: path.resolve(configDirectory, input.storage.databasePath),
      retentionDays: input.storage.retentionDays,
    },
    cloud: {
      enabled: input.cloud.enabled,
      apiBaseUrl: input.cloud.apiBaseUrl.replace(/\/+$/, ""),
      uploadToken,
      uploadIntervalMs: input.cloud.uploadIntervalMs,
      requestTimeoutMs: input.cloud.requestTimeoutMs,
      batchSize: input.cloud.batchSize,
    },
  };
}

export async function loadConfig(configPath, options = {}) {
  const absolutePath = path.resolve(configPath);
  const text = await readFile(absolutePath, "utf8");
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new ConfigurationError([
      `Configuration is not valid JSON: ${error.message}`,
    ]);
  }

  return validateConfig(parsed, {
    configDirectory: path.dirname(absolutePath),
    ...options,
  });
}
