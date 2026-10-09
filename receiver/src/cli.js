#!/usr/bin/env node

import { loadConfig } from "./config.js";
import { RtlFmSignalSource } from "./rtl-fm-source.js";
import { ReceiverService } from "./service.js";
import { EventStore } from "./store.js";
import { SyntheticSignalSource } from "./synthetic-source.js";
import { UploadClient } from "./uploader.js";

const RECEIVER_VERSION = "0.2.0";

function usage() {
  return `Usage: node src/cli.js --config <path> [--once]

Options:
  --config <path>  Receiver JSON configuration file
  --once           Run one synthetic scenario and exit
  --calibrate      Print one-second signal summaries until interrupted
  --help           Show this message`;
}

function parseArguments(arguments_) {
  const result = {
    configPath: null,
    once: false,
    calibrate: false,
  };

  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === "--config") {
      result.configPath = arguments_[index + 1];
      index += 1;
    } else if (argument === "--once") {
      result.once = true;
    } else if (argument === "--calibrate") {
      result.calibrate = true;
    } else if (argument === "--help") {
      console.log(usage());
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }

  if (!result.configPath) {
    throw new Error("--config is required.");
  }
  if (result.once && result.calibrate) {
    throw new Error("--once and --calibrate cannot be combined.");
  }

  return result;
}

function createSource(config, arguments_) {
  if (config.source.type === "synthetic") {
    return new SyntheticSignalSource({
      sampleIntervalMs: config.source.sampleIntervalMs,
      segments: config.source.synthetic.segments,
      realtime: arguments_.once
        ? false
        : config.source.synthetic.realtime,
      repeat: arguments_.once ? false : config.source.synthetic.repeat,
    });
  }

  if (arguments_.once) {
    throw new Error("--once is available only for synthetic input.");
  }

  return new RtlFmSignalSource({
    ...config.source.rtlFm,
    sampleIntervalMs: config.source.sampleIntervalMs,
    radio: config.radio,
  });
}

function percentile(sortedValues, percentile_) {
  const index = Math.min(
    sortedValues.length - 1,
    Math.ceil(sortedValues.length * percentile_) - 1,
  );
  return sortedValues[index];
}

async function runCalibration(source, sampleIntervalMs, signal) {
  const samplesPerSummary = Math.max(
    1,
    Math.round(1_000 / sampleIntervalMs),
  );
  let measurements = [];

  console.log("Calibration mode: press Ctrl+C to stop.");
  console.log("Timestamp\tMinimum\tMedian\t95th percentile\tMaximum");

  for await (const sample of source.samples({ signal })) {
    measurements.push(sample.powerDbfs);
    if (measurements.length < samplesPerSummary) {
      continue;
    }

    const sorted = measurements.toSorted((first, second) => first - second);
    console.log(
      [
        new Date(sample.timestampMs).toISOString(),
        sorted[0].toFixed(2),
        percentile(sorted, 0.5).toFixed(2),
        percentile(sorted, 0.95).toFixed(2),
        sorted.at(-1).toFixed(2),
      ].join("\t"),
    );
    measurements = [];
  }
}

async function main() {
  const arguments_ = parseArguments(process.argv.slice(2));
  const config = await loadConfig(arguments_.configPath, {
    requireCloudToken: !arguments_.calibrate,
  });
  const abortController = new AbortController();
  const stop = () => abortController.abort();
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);

  const source = createSource(config, arguments_);

  if (arguments_.calibrate) {
    try {
      await runCalibration(
        source,
        config.source.sampleIntervalMs,
        abortController.signal,
      );
    } finally {
      process.removeListener("SIGINT", stop);
      process.removeListener("SIGTERM", stop);
    }
    return;
  }

  const store = new EventStore(config.storage.databasePath);
  const uploader = config.cloud.enabled
    ? new UploadClient({
        ...config.cloud,
        store,
      })
    : null;
  const service = new ReceiverService({
    config,
    source,
    store,
    uploader,
    receiverVersion: RECEIVER_VERSION,
  });

  console.log(
    `Horn of Gondor receiver ${RECEIVER_VERSION} starting with ${config.source.type} input.`,
  );
  if (!config.cloud.enabled) {
    console.log("Cloud uploads are disabled; events will remain pending locally.");
  }

  try {
    const counts = await service.run({ signal: abortController.signal });
    console.log(
      `Receiver stopped. ${counts.pending} pending, ${counts.uploaded} uploaded, ${counts.rejected} rejected.`,
    );
  } finally {
    store.close();
    process.removeListener("SIGINT", stop);
    process.removeListener("SIGTERM", stop);
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
