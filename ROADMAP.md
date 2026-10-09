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

## Future Iteration — Transmission Recording and Playback

Status: Deferred until after the MVP

Website users will be able to select a transmission bar and play back a
recording of that transmission.

This iteration will require:

- Record audio only for accepted transmission events.
- Associate each audio clip with its transmission event.
- Encode clips in a browser-compatible, bandwidth-efficient format.
- Upload clips after their event metadata is stored safely.
- Store audio in object storage rather than D1.
- Add authenticated uploads and public read-only playback URLs.
- Add accessible playback controls to each chart bar.
- Define audio retention separately from measurement retention.
- Set storage and bandwidth limits to control cost.
- Handle interrupted recordings and uploads without corrupting event history.
- Document privacy, legal, moderation, and abuse considerations before enabling
  public playback.

Audio recording, upload, and playback remain explicitly outside the MVP.
