const POLL_INTERVAL_MS = 5_000;
const CHART_BUCKETS = 10;
const CHART_BUCKET_MS = 60_000;
const CHART_WINDOW_MS = CHART_BUCKETS * CHART_BUCKET_MS;
const CHART_FLOOR_DBFS = -100;
const DEFAULT_CHART_CONFIG = {
  minimumDurationSeconds: 1,
  maximumDurationSeconds: 30,
  minimumBarWidthPx: 4,
  maximumBarWidthPx: 18,
};

const elements = {
  average: document.querySelector("#latest-average"),
  chartAudio: document.querySelector("#chart-audio"),
  chartAudioNote: document.querySelector("#chart-audio-note"),
  chartAudioPanel: document.querySelector("#chart-audio-panel"),
  chartBars: document.querySelector("#chart-bars"),
  chartDetail: document.querySelector("#chart-detail"),
  chartEmpty: document.querySelector("#chart-empty"),
  connectionStatus: document.querySelector("#connection-status"),
  duration: document.querySelector("#latest-duration"),
  emptyState: document.querySelector("#empty-state"),
  frequency: document.querySelector("#latest-frequency"),
  latestResult: document.querySelector("#latest-result"),
  meter: document.querySelector("#signal-meter"),
  meterFill: document.querySelector("#signal-fill"),
  peak: document.querySelector("#latest-peak"),
  refreshButton: document.querySelector("#refresh-button"),
  score: document.querySelector("#latest-score"),
  time: document.querySelector("#latest-time"),
};

const state = {
  chartConfig: { ...DEFAULT_CHART_CONFIG },
  chartTransmissions: [],
  latestEtag: null,
  latestEventId: null,
  refreshing: false,
};

const timestampFormatter = new Intl.DateTimeFormat([], {
  dateStyle: "medium",
  timeStyle: "medium",
});

const timeFormatter = new Intl.DateTimeFormat([], {
  hour: "numeric",
  minute: "2-digit",
  second: "2-digit",
});

const minuteFormatter = new Intl.DateTimeFormat([], {
  hour: "numeric",
  minute: "2-digit",
});

function formatTimestamp(timestamp) {
  return timestampFormatter.format(new Date(timestamp));
}

function formatDuration(durationMs) {
  const seconds = durationMs / 1_000;
  return seconds < 60
    ? `${seconds.toFixed(seconds < 10 ? 1 : 0)} s`
    : `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
}

function formatDbfs(value) {
  return `${Number(value).toFixed(1)} dBFS`;
}

function formatFrequency(frequencyHz) {
  return `${(frequencyHz / 1_000_000).toFixed(3)} MHz`;
}

function setStatus(message, isError = false) {
  elements.connectionStatus.textContent = message;
  elements.connectionStatus.classList.toggle("error", isError);
}

function renderLatest(transmission) {
  if (!transmission) {
    elements.latestResult.hidden = true;
    elements.emptyState.hidden = false;
    state.latestEventId = null;
    return;
  }

  const score = Math.max(0, Math.min(100, Number(transmission.score)));
  state.latestEventId = transmission.eventId;
  elements.emptyState.hidden = true;
  elements.latestResult.hidden = false;
  elements.score.textContent = String(score);
  elements.meterFill.style.width = `${score}%`;
  elements.meter.setAttribute("aria-valuenow", String(score));
  elements.peak.textContent = formatDbfs(transmission.peakDbfs);
  elements.average.textContent = formatDbfs(transmission.averageDbfs);
  elements.duration.textContent = formatDuration(transmission.durationMs);
  elements.frequency.textContent = formatFrequency(transmission.frequencyHz);
  elements.time.textContent = `Started ${formatTimestamp(transmission.startedAt)}`;
}

function interpolateColor(start, end, amount) {
  const channels = start.map((value, index) =>
    Math.round(value + (end[index] - value) * amount),
  );
  return `rgb(${channels.join(" ")})`;
}

function colorForScore(rawScore) {
  const score = Math.max(0, Math.min(100, Number(rawScore)));
  const darkGold = [143, 100, 32];
  const gold = [241, 191, 84];
  const green = [111, 211, 145];

  return score <= 50
    ? interpolateColor(darkGold, gold, score / 50)
    : interpolateColor(gold, green, (score - 50) / 50);
}

function heightForPeak(rawPeak) {
  const peak = Math.max(CHART_FLOOR_DBFS, Math.min(0, Number(rawPeak)));
  return Math.max(2, ((peak - CHART_FLOOR_DBFS) / -CHART_FLOOR_DBFS) * 100);
}

function widthForDuration(durationMs) {
  const {
    minimumDurationSeconds,
    maximumDurationSeconds,
    minimumBarWidthPx,
    maximumBarWidthPx,
  } = state.chartConfig;
  const durationSeconds = Math.max(
    minimumDurationSeconds,
    Math.min(maximumDurationSeconds, Number(durationMs) / 1_000),
  );
  const logarithmicPosition =
    Math.log(durationSeconds / minimumDurationSeconds) /
    Math.log(maximumDurationSeconds / minimumDurationSeconds);

  return (
    minimumBarWidthPx +
    logarithmicPosition * (maximumBarWidthPx - minimumBarWidthPx)
  );
}

async function loadChartConfig() {
  try {
    const response = await fetch("/config.json");
    if (!response.ok) {
      throw new Error(`Configuration request failed with ${response.status}.`);
    }

    const body = await response.json();
    const candidate = body.chart;
    const values = [
      candidate?.minimumDurationSeconds,
      candidate?.maximumDurationSeconds,
      candidate?.minimumBarWidthPx,
      candidate?.maximumBarWidthPx,
    ];
    if (
      values.some((value) => !Number.isFinite(value) || value <= 0) ||
      candidate.maximumDurationSeconds <= candidate.minimumDurationSeconds ||
      candidate.maximumBarWidthPx <= candidate.minimumBarWidthPx
    ) {
      throw new Error("Chart configuration contains invalid values.");
    }

    state.chartConfig = { ...candidate };
  } catch (error) {
    console.warn("Using default chart configuration.", error);
  }
}

function transmissionsByMinute(transmissions, now) {
  const currentMinuteStart =
    Math.floor(now / CHART_BUCKET_MS) * CHART_BUCKET_MS;
  const windowStart =
    currentMinuteStart - (CHART_BUCKETS - 1) * CHART_BUCKET_MS;
  const buckets = Array.from({ length: CHART_BUCKETS }, () => []);

  for (const transmission of transmissions) {
    const startedAt = Date.parse(transmission.startedAt);
    if (startedAt < windowStart || startedAt > now) {
      continue;
    }

    const index = Math.min(
      CHART_BUCKETS - 1,
      Math.floor((startedAt - windowStart) / CHART_BUCKET_MS),
    );
    buckets[index].push(transmission);
  }

  for (const bucket of buckets) {
    bucket.sort(
      (first, second) =>
        Date.parse(first.startedAt) - Date.parse(second.startedAt),
    );
  }

  return buckets;
}

function renderChart(now = Date.now()) {
  const buckets = transmissionsByMinute(state.chartTransmissions, now);
  const fragment = document.createDocumentFragment();
  const hasResults = buckets.some((bucket) => bucket.length > 0);

  buckets.forEach((transmissions, index) => {
    const column = document.createElement("div");
    column.className = "chart-column";

    const currentMinuteStart =
      Math.floor(now / CHART_BUCKET_MS) * CHART_BUCKET_MS;
    const bucketStart =
      currentMinuteStart - (CHART_BUCKETS - 1 - index) * CHART_BUCKET_MS;
    const periodLabel = `during the minute beginning ${minuteFormatter.format(new Date(bucketStart))}`;

    for (const transmission of transmissions) {
      const bar = document.createElement("div");
      bar.className = "chart-bar";
      bar.role = "button";
      bar.tabIndex = 0;

      const eventPeriodLabel =
        periodLabel.charAt(0).toUpperCase() + periodLabel.slice(1);
      const label = [
        eventPeriodLabel,
        `peak ${formatDbfs(transmission.peakDbfs)}`,
        `score ${transmission.score} out of 100`,
        transmission.audioAvailable
          ? "select to play audio"
          : "audio unavailable",
      ].join(", ");
      bar.setAttribute("aria-label", label);
      bar.title = label;
      bar.style.height = `${heightForPeak(transmission.peakDbfs)}%`;
      bar.style.width = `${widthForDuration(transmission.durationMs)}px`;
      bar.style.backgroundColor = colorForScore(transmission.score);
      const showDetails = () => {
        elements.chartDetail.textContent = [
          formatTimestamp(transmission.startedAt),
          `Peak ${formatDbfs(transmission.peakDbfs)}`,
          `Score ${transmission.score}/100`,
          `Duration ${formatDuration(transmission.durationMs)}`,
        ].join(" · ");
        if (transmission.audioAvailable) {
          const source = `/api/v1/transmissions/${encodeURIComponent(transmission.eventId)}/audio`;
          if (elements.chartAudio.getAttribute("src") !== source) {
            elements.chartAudio.src = source;
          }
          elements.chartAudioPanel.hidden = false;
          elements.chartAudioNote.textContent =
            transmission.audioDurationMs < transmission.durationMs
              ? `Playback contains the first ${formatDuration(transmission.audioDurationMs)} of this transmission.`
              : "Playback contains the complete transmission.";
        } else {
          elements.chartAudio.pause();
          elements.chartAudio.removeAttribute("src");
          elements.chartAudio.load();
          elements.chartAudioPanel.hidden = true;
        }
      };
      bar.addEventListener("click", showDetails);
      bar.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          showDetails();
        }
      });
      column.append(bar);
    }

    if (transmissions.length === 0) {
      column.setAttribute(
        "aria-label",
        `No transmission detected ${periodLabel}`,
      );
    }

    fragment.append(column);
  });

  elements.chartBars.replaceChildren(fragment);
  elements.chartEmpty.hidden = hasResults;
  if (!hasResults) {
    elements.chartDetail.textContent =
      "Each bar shows one detected transmission.";
    elements.chartAudioPanel.hidden = true;
  }
}

async function apiRequest(path, options = {}) {
  const response = await fetch(path, options);
  if (!response.ok && response.status !== 304) {
    let message = `Request failed with status ${response.status}.`;
    try {
      const body = await response.json();
      message = body.error?.message ?? message;
    } catch {
      // Keep the status-based message when the response is not JSON.
    }
    throw new Error(message);
  }
  return response;
}

async function fetchLatest() {
  const headers = {};
  if (state.latestEtag) {
    headers["If-None-Match"] = state.latestEtag;
  }

  const response = await apiRequest("/api/v1/transmissions/latest", {
    headers,
  });

  setStatus(`Checked ${timeFormatter.format(new Date())}`);
  if (response.status === 304) {
    return false;
  }

  state.latestEtag = response.headers.get("ETag");
  const body = await response.json();
  const changed = body.data?.eventId !== state.latestEventId;
  renderLatest(body.data);
  return changed;
}

async function fetchChart() {
  const since = new Date(Date.now() - CHART_WINDOW_MS).toISOString();
  const transmissions = [];
  let cursor = null;

  do {
    const parameters = new URLSearchParams({ limit: "100", since });
    if (cursor) {
      parameters.set("cursor", cursor);
    }

    const response = await apiRequest(
      `/api/v1/transmissions?${parameters.toString()}`,
    );
    const body = await response.json();
    transmissions.push(...body.data);
    cursor = body.pagination.hasMore ? body.pagination.nextCursor : null;
  } while (cursor);

  state.chartTransmissions = transmissions;
  renderChart();
}

async function refresh({ includeChart = false } = {}) {
  if (state.refreshing) {
    return;
  }

  state.refreshing = true;
  elements.refreshButton.disabled = true;

  try {
    const latestChanged = await fetchLatest();
    if (includeChart || latestChanged) {
      await fetchChart();
    } else {
      renderChart();
    }
  } catch (error) {
    console.error(error);
    setStatus("Unable to update", true);
  } finally {
    state.refreshing = false;
    elements.refreshButton.disabled = false;
  }
}

elements.refreshButton.addEventListener("click", () => {
  void refresh({ includeChart: true });
});

document.addEventListener("visibilitychange", () => {
  if (!document.hidden) {
    void refresh({ includeChart: true });
  }
});

async function start() {
  await loadChartConfig();
  await refresh({ includeChart: true });
  setInterval(() => {
    if (!document.hidden) {
      void refresh();
    }
  }, POLL_INTERVAL_MS);
}

void start();
