function percentile(sortedValues, fraction) {
  const index = Math.min(
    sortedValues.length - 1,
    Math.ceil(sortedValues.length * fraction) - 1,
  );
  return sortedValues[index];
}

function round(value) {
  return Math.round(value * 100) / 100;
}

export function summarizeNoise(measurements) {
  if (!Array.isArray(measurements) || measurements.length === 0) {
    throw new TypeError("Calibration requires at least one measurement.");
  }
  if (
    measurements.some(
      (measurement) =>
        !Number.isFinite(measurement) || measurement > 0,
    )
  ) {
    throw new TypeError(
      "Calibration measurements must be finite dBFS values no greater than 0.",
    );
  }

  const sorted = measurements.toSorted((first, second) => first - second);
  return {
    minimumDbfs: round(sorted[0]),
    medianDbfs: round(percentile(sorted, 0.5)),
    percentile95Dbfs: round(percentile(sorted, 0.95)),
    maximumDbfs: round(sorted.at(-1)),
  };
}

export function recommendDetectionSettings({
  measurements,
  marginDb = 3,
  currentScoreRangeDb,
}) {
  if (!Number.isFinite(marginDb) || marginDb <= 0) {
    throw new TypeError("Calibration margin must be greater than 0 dB.");
  }
  if (!Number.isFinite(currentScoreRangeDb) || currentScoreRangeDb < 1) {
    throw new TypeError("Current score range must be at least 1 dB.");
  }

  const summary = summarizeNoise(measurements);
  const thresholdDbfs = round(summary.percentile95Dbfs + marginDb);
  if (thresholdDbfs > -1) {
    throw new RangeError(
      "The measured noise is too close to 0 dBFS for a usable threshold.",
    );
  }

  return {
    summary,
    thresholdDbfs,
    scoreRangeDb: Math.min(
      currentScoreRangeDb,
      round(-thresholdDbfs),
    ),
  };
}
