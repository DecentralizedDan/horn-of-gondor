# Horn of Gondor Receiver

The receiver package runs on the Raspberry Pi. It supports both deterministic
synthetic samples and live, channelized IQ samples from `rtl_fm`.

For a fresh cloud-and-Pi deployment, see
[the complete installation guide](../docs/installation.md).

## Current Capabilities

- Validated JSON configuration
- Synthetic dBFS samples
- Native `rtl_fm -M raw` process management
- Signed 16-bit IQ decoding
- 100 ms RF power measurements
- Automatic `rtl_fm` restart after unexpected exits
- Live noise calibration summaries
- Threshold-based transmission detection
- Configurable minimum duration and end grace period
- Peak, average, duration, and relative-score calculation
- Bounded 16 kHz mono PCM WAV capture from FM IQ
- Audio-first cloud delivery so published events are immediately playable
- Local SQLite storage
- Idempotent cloud uploads
- Exponential retry backoff
- Local retention that never deletes unsynchronized events
- Graceful `SIGINT` and `SIGTERM` handling

The RTL-SDR source and end-to-end upload path have been verified with a live
transmission on the Pi.

## Configuration

Copy the example before normal operation:

```sh
cp config.example.json config.json
```

`config.json` is ignored by Git. It contains private Pi and cloud settings,
unlike the website's public `public/config.json`.

Important receiver settings include:

- `radio.frequencyMhz`: VHF receive frequency in MHz; accepts integer or
  decimal JSON numbers such as `145` or `145.5`
- `radio.gainDb`: Fixed RTL-SDR tuner gain
- `radio.ppmError`: RTL-SDR frequency correction
- `source.rtlFm.sampleRateHz`: Channelized IQ sample rate
- `source.rtlFm.restartDelayMs`: Delay before process recovery
- `source.rtlFm.maximumRestartAttempts`: Consecutive startup failures allowed
- `detection.thresholdDbfs`: Minimum accepted signal level
- `detection.scoreRangeDb`: Signal range mapped from 0 to 100
- `detection.minimumDurationMs`: Minimum accepted transmission duration
- `detection.endGraceMs`: Below-threshold time that ends a transmission
- `storage.retentionDays`: Local and cloud history retention
- `recording.enabled`: Capture and upload transmission audio
- `recording.retentionDays`: Audio retention, defaulting to one day
- `recording.maximumDurationSeconds`: Maximum opening excerpt, defaulting to 10 seconds
- `recording.directory`: Temporary local WAV directory
- `cloud.apiBaseUrl`: Deployed Cloudflare service

Recording requires the `rtl_fm` source. The configured RTL sample rate must be
a multiple of 16 kHz; the tested 48 kHz setting produces 16 kHz mono WAV
audio. WAV files are uploaded before event metadata and deleted locally after
successful publication. An interrupted upload remains queued in SQLite.
All recordings have their first 200 ms removed to suppress the receiver's
opening static burst. Complete recordings also have their final 250 ms trimmed
to suppress the squelch tail; capped excerpts are not trimmed at the end.
Clips then receive 20 ms edge fades and are normalized toward -18 dBFS RMS
with a -1 dBFS soft limiter.

The upload token may be stored in `config.json`, but the recommended approach
is an environment variable:

```sh
export HORN_OF_GONDOR_UPLOAD_TOKEN='replace-with-production-secret'
```

## Install on the Pi

The package targets Node.js 20 or later. On Debian 13:

```sh
sudo apt update
sudo apt install -y build-essential python3 rtl-sdr
cd ~/horn-of-gondor/receiver
npm ci
```

The compiler packages are a fallback if npm cannot download a prebuilt
`better-sqlite3` binary for the Pi.

## Test

Run the automated tests:

```sh
npm test
```

Run one synthetic scenario:

```sh
npm run demo
```

The demonstration writes detected transmissions to `data/receiver.sqlite`.
Cloud uploads are disabled in `config.example.json`.

## Run Continuously

After copying and editing the configuration:

```sh
npm start
```

The example synthetic scenario repeats until interrupted. Press `Ctrl+C` for a
graceful shutdown.

## Use the RTL-SDR

In `config.json`, change:

```json
"type": "rtl_fm"
```

Keep automatic gain control disabled by retaining a fixed `radio.gainDb`.
The initial configuration uses:

- 146.550 MHz
- 28 dB tuner gain
- 48,000 channelized IQ samples per second
- 100 ms measurement windows

Confirm that the selected frequency is appropriate for local simplex use
before transmitting.

To enable the default ten-second audio excerpt:

```json
"recording": {
  "enabled": true,
  "retentionDays": 1,
  "maximumDurationSeconds": 10,
  "directory": "./data/audio"
}
```

Audio adds roughly 32 KB per recorded second. On a Raspberry Pi 3 B+, monitor
CPU temperature and throttling during initial field tests:

```sh
vcgencmd measure_temp
vcgencmd get_throttled
```

## Calibrate the Noise Threshold

Recalibrate after moving the Pi, changing the SDR antenna, changing tuner gain,
or making another change that affects the local noise floor. Stop the service
so it releases the RTL-SDR, ensure the configured channel is idle, and run:

```sh
sudo systemctl stop horn-of-gondor-receiver
npm run recalibrate
```

After a 60-second measurement, the command prints only the `config.json`
fields that should change, for example:

```text
detection.thresholdDbfs = -38.25
```

It uses the measured 95th-percentile noise plus a 3 dB margin. Override the
duration or margin when needed:

```sh
npm run recalibrate -- --seconds 120 --margin-db 4
```

Edit `config.json` with `vim`, apply the printed values, then restart:

```sh
vim config.json
sudo systemctl start horn-of-gondor-receiver
sudo journalctl -u horn-of-gondor-receiver -f
```

For diagnostic one-second summaries instead of an automatic recommendation:

```sh
timeout 60 node src/cli.js --config config.json --calibrate
```

The receiver prints minimum, median, 95th-percentile, and maximum dBFS values
once per second. Begin with `detection.thresholdDbfs` approximately 6 dB above
the stable noise level, then adjust based on false detections and missed
signals.

These dBFS values are relative to the fixed `rtl_fm` processing chain. They
are useful for repeatable comparisons but are not calibrated receiver input
power or S-units.

The IQ format and processing assumptions follow the
[Debian `rtl_fm` manual](https://manpages.debian.org/trixie/rtl-sdr/rtl_fm.1.en.html)
and [Osmocom `rtl_fm` source](https://github.com/osmocom/rtl-sdr/blob/master/src/rtl_fm.c).

## Run With Live IQ

After calibration:

```sh
node src/cli.js --config config.json
```

Press `Ctrl+C` for a graceful shutdown.

## Install the System Service

Stop any manually running receiver with `Ctrl+C`, then run:

```sh
cd ~/horn-of-gondor/receiver
sudo bash deploy/install-systemd.sh
```

On its first run, the installer securely prompts for the cloud upload token.
It stores the token in `/etc/horn-of-gondor/receiver.env` with permissions
that allow only root to read it. The token is not included in the service
definition or command line.

The installer enables and immediately starts
`horn-of-gondor-receiver.service`. Common operations are:

```sh
sudo systemctl status horn-of-gondor-receiver
npm run restart-service
sudo systemctl stop horn-of-gondor-receiver
sudo journalctl -u horn-of-gondor-receiver -f
```

`npm run restart-service` restarts the receiver and prints its full service
status so startup failures are immediately visible. After changing
`config.json`, run it to apply the new settings.
After rotating the cloud token, edit
`/etc/horn-of-gondor/receiver.env` with `sudo vim` and restart the service.
