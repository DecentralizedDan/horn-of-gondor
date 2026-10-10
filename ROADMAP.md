# Horn of Gondor Roadmap

This roadmap describes the planned path from the current development prototype
to a reliable Raspberry Pi signal-reporting receiver. Priorities may change as
real RTL-SDR testing reveals hardware or signal-processing constraints.

## Phase 1 — Cloud Prototype

Status: Complete locally

- Define the transmission schema and API contract.
- Build the Cloudflare Worker API and D1 schema.
- Build the public, mobile-first results page.
- Add the ten-minute transmission chart.
- Test locally with Wrangler and simulated transmissions.
- Add API validation, authenticated uploads, pagination, and cloud retention.

## Phase 2 — Early Cloudflare Deployment

Status: Complete

- Authenticate Wrangler with the Cloudflare account.
- Create the production D1 database.
- Apply database migrations.
- Generate and store the production upload secret.
- Deploy the Worker and public website.
- Confirm public reads and authenticated test uploads.
- Establish a repeatable deployment process.

## Phase 3 — Synthetic Pi Receiver

Status: Complete

- Create the receiver package in JavaScript.
- Define and validate the Pi's JSON configuration file.
- Implement the agreed relative-score calculation.
- Generate synthetic signal samples and transmission events.
- Store events in local SQLite.
- Queue uploads while offline.
- Retry temporary upload failures safely and idempotently.
- Synchronize cloud retention settings from the Pi.

## Phase 4 — RTL-SDR Integration

Status: Complete

- Install and verify RTL-SDR support on the Raspberry Pi 3 Model B+.
- Configure frequency and fixed tuner gain.
- Disable automatic gain control.
- Measure channel power in dBFS.
- Establish the local noise threshold.
- Detect FM transmissions lasting at least one second.
- Calculate duration, peak, average, and score.
- Compare synthetic events with real receiver output.

## Phase 5 — End-to-End Field Test

Status: In progress; live Pi-to-website transmission verified

- Connect the Pi receiver to the deployed Cloudflare service.
- Confirm that real transmissions appear on the website.
- Test offline storage and delayed uploads.
- Test multiple transmissions within the same minute.
- Compare several locations, HTs, and antennas.
- Check for false detections and missed transmissions.
- Adjust receiver defaults without presenting relative readings as calibrated
  S-units.

## Phase 6 — Reliable Installation and Operation

Status: In progress; automatic startup verified on the Pi

- Build a reproducible Pi installer.
- Create and enable the `systemd` receiver service.
- Start automatically after reboot.
- Store the upload token in a root-only service environment file.
- Add useful logs without exposing secrets.
- Harden local and cloud error handling.
- Test retention cleanup locally and in Cloudflare.
- Document installation, configuration, calibration, operation, and recovery.
- Add release packaging and versioning.

## Phase 7 — Transmission Recording and Playback

Status: Feature complete; deployed Raspberry Pi audio validation in progress

Website users can select a transmission bar and play back a recording of that
transmission.

Implemented:

- Demodulate 16 kHz mono FM audio while measuring the RTL-SDR IQ stream.
- Keep only the configurable opening excerpt, defaulting to ten seconds.
- Remove the first 200 ms from every recording to suppress the opening static
  burst.
- Trim the final 250 ms from complete recordings to suppress the receiver
  squelch “kerchunk,” while leaving capped excerpts at their full length.
- Apply short edge fades and normalize clips to approximately -18 dBFS RMS
  with a -1 dBFS soft limiter.
- Associate each audio clip with its transmission event.
- Write browser-compatible PCM WAV without requiring a Pi-side encoder.
- Upload clips before event metadata so every published audio bar is playable.
- Store audio in Cloudflare R2 rather than D1.
- Add authenticated uploads and public read-only playback URLs.
- Add accessible playback controls to each chart bar.
- Retain audio for one day by default, independently configurable through
  `recording.retentionDays`.
- Handle interrupted recordings and uploads without corrupting event history.

Remaining:

- Validate received voice quality with the real RTL-SDR and antenna.
- Measure Raspberry Pi 3 B+ CPU temperature, throttling, and missed samples.
- Test back-to-back transmissions, offline audio queues, and one-day cleanup.
- Revisit compressed audio only if measured R2 egress or storage warrants the
  additional Pi CPU and deployment complexity.

## Future Quality-of-Life Improvements

- Accept the configured receive frequency in MHz instead of requiring integer
  hertz. Replace `radio.frequencyHz` with `radio.frequencyMhz`; for example,
  configure 145 MHz as `145.000`.

## Future Project and Contributor Improvements

- Add an AI-assisted contribution policy to `CONTRIBUTING.md`.
- Require contributors to understand, review, test, and take responsibility
  for all submitted code, including AI-generated code.
- Require disclosure when AI materially contributed to a pull request.
- Do not accept unreviewed AI output, fabricated test results, or generated
  dependencies and licenses whose provenance has not been verified.
- Never provide secrets, private configuration, unpublished recordings, or
  other sensitive project data to an AI service.
- Hold AI-assisted contributions to the same testing, documentation,
  security, licensing, and radio-compliance standards as other contributions.
