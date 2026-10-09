function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

export function normalizeSignal(
  measurementDbfs,
  thresholdDbfs,
  scoreRangeDb,
) {
  return clamp((measurementDbfs - thresholdDbfs) / scoreRangeDb, 0, 1);
}

export function calculateScore({
  peakDbfs,
  averageDbfs,
  thresholdDbfs,
  scoreRangeDb,
}) {
  const normalizedPeak = normalizeSignal(
    peakDbfs,
    thresholdDbfs,
    scoreRangeDb,
  );
  const normalizedAverage = normalizeSignal(
    averageDbfs,
    thresholdDbfs,
    scoreRangeDb,
  );

  return Math.round(100 * (0.4 * normalizedPeak + 0.6 * normalizedAverage));
}
