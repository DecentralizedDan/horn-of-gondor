#!/usr/bin/env node

import { recommendDetectionSettings } from "./calibration.js";
import { loadConfig } from "./config.js";
import { RtlFmSignalSource } from "./rtl-fm-source.js";

const DEFAULT_SECONDS = 60;
const DEFAULT_MARGIN_DB = 3;
const SETTLING_SECONDS = 2;

function usage() {
  return `Usage: node src/recalibrate.js [options]

Options:
  --config <path>    Receiver configuration (default: config.json)
  --seconds <value>  Idle-channel measurement time (default: 60)
  --margin-db <db>   Margin above the 95th-percentile noise (default: 3)
  --help             Show this message`;
}

function numericArgument(value, name, minimum, maximum) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(
      `${name} must be a number from ${minimum} through ${maximum}.`,
    );
  }
  return parsed;
}

function parseArguments(arguments_) {
  const result = {
    configPath: "config.json",
    seconds: DEFAULT_SECONDS,
    marginDb: DEFAULT_MARGIN_DB,
  };

  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === "--config") {
      result.configPath = arguments_[index + 1];
      index += 1;
    } else if (argument === "--seconds") {
      result.seconds = numericArgument(
        arguments_[index + 1],
        "--seconds",
        10,
        600,
      );
      index += 1;
    } else if (argument === "--margin-db") {
      result.marginDb = numericArgument(
        arguments_[index + 1],
        "--margin-db",
        0.5,
        20,
      );
      index += 1;
    } else if (argument === "--help") {
      console.log(usage());
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }

  if (!result.configPath) {
    throw new Error("--config requires a path.");
  }
  return result;
}

async function collectMeasurements(source, {
  sampleIntervalMs,
  seconds,
  signal,
}) {
  const settlingSamples = Math.ceil(
    (SETTLING_SECONDS * 1_000) / sampleIntervalMs,
  );
  const requiredSamples = Math.ceil((seconds * 1_000) / sampleIntervalMs);
  const measurements = [];
  let observedSamples = 0;

  for await (const sample of source.samples({ signal })) {
    observedSamples += 1;
    if (observedSamples <= settlingSamples) {
      continue;
    }
    measurements.push(sample.powerDbfs);
    if (measurements.length >= requiredSamples) {
      break;
    }
  }

  if (measurements.length < requiredSamples) {
    throw new Error(
      `Calibration stopped after ${measurements.length} of ${requiredSamples} measurements.`,
    );
  }
  return measurements;
}

async function main() {
  const arguments_ = parseArguments(process.argv.slice(2));
  const config = await loadConfig(arguments_.configPath, {
    requireCloudToken: false,
  });
  if (config.source.type !== "rtl_fm") {
    throw new Error(
      'Recalibration requires source.type to be "rtl_fm".',
    );
  }

  const abortController = new AbortController();
  const stop = () => abortController.abort();
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);

  const source = new RtlFmSignalSource({
    ...config.source.rtlFm,
    sampleIntervalMs: config.source.sampleIntervalMs,
    radio: config.radio,
  });

  console.error(
    `Measuring an idle channel for ${arguments_.seconds} seconds after a ${SETTLING_SECONDS}-second settling period.`,
  );
  console.error("Do not transmit during calibration.");

  try {
    const measurements = await collectMeasurements(source, {
      sampleIntervalMs: config.source.sampleIntervalMs,
      seconds: arguments_.seconds,
      signal: abortController.signal,
    });
    const recommendation = recommendDetectionSettings({
      measurements,
      marginDb: arguments_.marginDb,
      currentScoreRangeDb: config.detection.scoreRangeDb,
    });

    console.error(
      [
        "Measured dBFS:",
        `min ${recommendation.summary.minimumDbfs}`,
        `median ${recommendation.summary.medianDbfs}`,
        `p95 ${recommendation.summary.percentile95Dbfs}`,
        `max ${recommendation.summary.maximumDbfs}`,
      ].join(" "),
    );
    console.log(
      `detection.thresholdDbfs = ${recommendation.thresholdDbfs}`,
    );
    if (
      recommendation.scoreRangeDb !== config.detection.scoreRangeDb
    ) {
      console.log(
        `detection.scoreRangeDb = ${recommendation.scoreRangeDb}`,
      );
    }
  } finally {
    abortController.abort();
    process.removeListener("SIGINT", stop);
    process.removeListener("SIGTERM", stop);
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
