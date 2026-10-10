import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import {
  ConfigurationError,
  validateConfig,
} from "../src/config.js";

async function exampleConfig() {
  const text = await readFile(
    new URL("../config.example.json", import.meta.url),
    "utf8",
  );
  return JSON.parse(text);
}

test("validates and normalizes the example configuration", async () => {
  const input = await exampleConfig();
  input.cloud.enabled = true;
  const config = validateConfig(input, {
    configDirectory: "/tmp/horn-of-gondor",
    environment: {
      HORN_OF_GONDOR_UPLOAD_TOKEN:
        "test-token-with-at-least-32-characters",
    },
  });

  assert.equal(config.detection.scoreRangeDb, 50);
  assert.equal(config.radio.frequencyHz, 146_550_000);
  assert.equal(config.recording.retentionDays, 1);
  assert.equal(config.recording.enabled, false);
  assert.equal(config.recording.maximumDurationSeconds, 10);
  assert.equal(
    config.recording.directory,
    path.resolve("/tmp/horn-of-gondor", "./data/audio"),
  );
  assert.equal(
    config.storage.databasePath,
    path.resolve("/tmp/horn-of-gondor", "./data/receiver.sqlite"),
  );
  assert.equal(
    config.cloud.uploadToken,
    "test-token-with-at-least-32-characters",
  );
});

test("accepts integer and decimal frequencies in MHz", async () => {
  const input = await exampleConfig();

  input.radio.frequencyMhz = 145;
  assert.equal(validateConfig(input).radio.frequencyHz, 145_000_000);

  input.radio.frequencyMhz = 145.5;
  assert.equal(validateConfig(input).radio.frequencyHz, 145_500_000);

  delete input.radio.frequencyMhz;
  input.radio.frequencyHz = 145_500_000;
  assert.throws(
    () => validateConfig(input),
    (error) =>
      error instanceof ConfigurationError &&
      error.details.some((detail) =>
        detail.includes("radio.frequencyMhz"),
      ),
  );
});

test("defaults audio retention and validates configured days", async () => {
  const input = await exampleConfig();
  delete input.recording;
  assert.equal(
    validateConfig(input).recording.retentionDays,
    1,
  );

  input.recording = { retentionDays: 0 };
  assert.throws(
    () => validateConfig(input),
    (error) =>
      error instanceof ConfigurationError &&
      error.details.some((detail) =>
        detail.includes("recording.retentionDays"),
      ),
  );
});

test("rejects a score range that would exceed zero dBFS", async () => {
  const input = await exampleConfig();
  input.detection.thresholdDbfs = -40;
  input.detection.scoreRangeDb = 50;

  assert.throws(
    () => validateConfig(input),
    (error) =>
      error instanceof ConfigurationError &&
      error.details.some((detail) =>
        detail.includes("must not exceed 0 dBFS"),
      ),
  );
});

test("requires a cloud token only when uploads are enabled", async () => {
  const input = await exampleConfig();
  input.cloud.enabled = true;
  input.cloud.uploadToken = "";

  assert.throws(
    () => validateConfig(input, { environment: {} }),
    ConfigurationError,
  );
  assert.doesNotThrow(() =>
    validateConfig(input, {
      environment: {},
      requireCloudToken: false,
    }),
  );

  input.cloud.enabled = false;
  assert.doesNotThrow(() =>
    validateConfig(input, { environment: {} }),
  );
});

test("requires HTTPS for non-local cloud uploads", async () => {
  const input = await exampleConfig();
  input.cloud.enabled = true;
  input.cloud.uploadToken = "test-token-with-at-least-32-characters";
  input.cloud.apiBaseUrl = "http://receiver.example.com";

  assert.throws(
    () => validateConfig(input, { environment: {} }),
    (error) =>
      error instanceof ConfigurationError &&
      error.details.some((detail) => detail.includes("must use HTTPS")),
  );

  input.cloud.apiBaseUrl = "http://localhost:8787";
  assert.doesNotThrow(() =>
    validateConfig(input, { environment: {} }),
  );
});

test("validates RTL-FM source settings", async () => {
  const input = await exampleConfig();
  input.source.type = "rtl_fm";
  const config = validateConfig(input, { environment: {} });

  assert.deepEqual(config.source.rtlFm, {
    executable: "rtl_fm",
    sampleRateHz: 48_000,
    restartDelayMs: 2_000,
    maximumRestartAttempts: 5,
  });
  assert.equal(config.radio.ppmError, 0);

  input.source.rtlFm.sampleRateHz = 48_001;
  assert.throws(() => validateConfig(input), ConfigurationError);
});

test("requires compatible RTL-FM input when recording is enabled", async () => {
  const input = await exampleConfig();
  input.recording.enabled = true;

  assert.throws(
    () => validateConfig(input),
    (error) =>
      error instanceof ConfigurationError &&
      error.details.some((detail) =>
        detail.includes('requires source.type to be "rtl_fm"'),
      ),
  );

  input.source.type = "rtl_fm";
  assert.doesNotThrow(() => validateConfig(input));
});
