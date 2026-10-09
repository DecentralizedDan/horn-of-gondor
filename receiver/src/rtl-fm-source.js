import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { IqPowerDecoder } from "./iq-power.js";

const HEALTHY_RUN_MS = 10_000;

export function buildRtlFmArguments({
  deviceIndex,
  frequencyHz,
  gainDb,
  ppmError,
  sampleRateHz,
}) {
  return [
    "-d",
    String(deviceIndex),
    "-f",
    String(frequencyHz),
    "-M",
    "raw",
    "-s",
    String(sampleRateHz),
    "-g",
    String(gainDb),
    "-p",
    String(ppmError),
    "-l",
    "0",
    "-",
  ];
}

function processOutcome(child) {
  return new Promise((resolve) => {
    child.once("error", (error) => resolve({ error }));
    child.once("close", (code, signal) => resolve({ code, signal }));
  });
}

function roundPower(powerDbfs) {
  return Math.round(powerDbfs * 100) / 100;
}

export class RtlFmSignalSource {
  constructor({
    executable,
    sampleRateHz,
    sampleIntervalMs,
    restartDelayMs,
    maximumRestartAttempts,
    radio,
    spawnProcess = spawn,
    wait = delay,
    clock = Date.now,
    logger = console,
  }) {
    this.executable = executable;
    this.sampleRateHz = sampleRateHz;
    this.sampleIntervalMs = sampleIntervalMs;
    this.restartDelayMs = restartDelayMs;
    this.maximumRestartAttempts = maximumRestartAttempts;
    this.radio = radio;
    this.spawnProcess = spawnProcess;
    this.wait = wait;
    this.clock = clock;
    this.logger = logger;
  }

  async *samples({ signal } = {}) {
    let restartAttempts = 0;
    let nextTimestampMs = null;

    while (!signal?.aborted) {
      const decoder = new IqPowerDecoder({
        sampleRateHz: this.sampleRateHz,
        windowMs: this.sampleIntervalMs,
      });
      const arguments_ = buildRtlFmArguments({
        ...this.radio,
        sampleRateHz: this.sampleRateHz,
      });
      const child = this.spawnProcess(this.executable, arguments_, {
        stdio: ["ignore", "pipe", "pipe"],
      });
      const outcomePromise = processOutcome(child);
      let stderrRemainder = "";
      const stderrLines = [];
      let producedSamples = 0;
      let streamError = null;

      const captureStderr = (chunk) => {
        stderrRemainder += chunk.toString();
        const lines = stderrRemainder.split(/\r?\n/);
        stderrRemainder = lines.pop() ?? "";
        for (const line of lines.filter(Boolean)) {
          stderrLines.push(line);
          if (stderrLines.length > 20) {
            stderrLines.shift();
          }
          this.logger.info(`[rtl_fm] ${line}`);
        }
      };
      child.stderr?.on("data", captureStderr);

      const stopChild = () => {
        if (child.exitCode === null && !child.killed) {
          child.kill("SIGTERM");
        }
      };
      signal?.addEventListener("abort", stopChild, { once: true });

      try {
        try {
          for await (const chunk of child.stdout) {
            for (const powerDbfs of decoder.push(chunk)) {
              producedSamples += 1;
              const measuredStartMs = this.clock() - this.sampleIntervalMs;
              nextTimestampMs =
                nextTimestampMs === null
                  ? measuredStartMs
                  : Math.max(nextTimestampMs, measuredStartMs);

              yield {
                timestampMs: Math.round(nextTimestampMs),
                powerDbfs: roundPower(powerDbfs),
              };
              nextTimestampMs += this.sampleIntervalMs;
            }
          }
        } catch (error) {
          streamError = error;
          stopChild();
        }

        const outcome = await outcomePromise;
        if (signal?.aborted) {
          return;
        }

        if (producedSamples * this.sampleIntervalMs >= HEALTHY_RUN_MS) {
          restartAttempts = 0;
        }
        restartAttempts += 1;
        const lastErrorLine =
          stderrRemainder.trim() || stderrLines.at(-1) || "no diagnostic output";
        const reason = streamError
          ? streamError.message
          : outcome.error
            ? outcome.error.message
            : `exit code ${outcome.code ?? "unknown"}${outcome.signal ? ` (${outcome.signal})` : ""}: ${lastErrorLine}`;

        if (restartAttempts > this.maximumRestartAttempts) {
          throw new Error(
            `rtl_fm stopped and exceeded ${this.maximumRestartAttempts} restart attempt(s): ${reason}`,
          );
        }

        this.logger.warn(
          `rtl_fm stopped; restarting in ${this.restartDelayMs} ms (${restartAttempts}/${this.maximumRestartAttempts}): ${reason}`,
        );
        try {
          await this.wait(this.restartDelayMs, undefined, { signal });
        } catch (error) {
          if (error.name === "AbortError" || signal?.aborted) {
            return;
          }
          throw error;
        }
      } finally {
        signal?.removeEventListener("abort", stopChild);
        child.stderr?.removeListener("data", captureStderr);
        stopChild();
      }

    }
  }
}
