# Horn of Gondor Installation

This guide installs a fresh Horn of Gondor deployment from the repository. It
covers the Cloudflare service and the Raspberry Pi receiver.

## Before You Begin

You need:

- A Cloudflare account
- A development computer with Git, Node.js 22 or later, and npm
- A Raspberry Pi 3 Model B+ running 64-bit Raspberry Pi OS
- An RTL-SDR supported by `rtl-sdr`
- A suitable VHF antenna
- A lawful local simplex frequency between 144 and 148 MHz

The Raspberry Pi makes outbound HTTPS requests. No inbound port or router
port-forwarding is required.

## 1. Clone the Repository

On the development computer:

```sh
git clone https://github.com/DecentralizedDan/horn-of-gondor.git
cd horn-of-gondor
npm ci
```

Run the local verification suite:

```sh
npm run check
```

## 2. Create the Cloudflare Service

Authenticate Wrangler:

```sh
npx wrangler login
```

Create the production D1 database:

```sh
npx wrangler d1 create horn-of-gondor
```

Copy the returned database ID into `wrangler.jsonc` as the
`d1_databases[0].database_id` value. In the Cloudflare dashboard, open **R2
Object Storage** and enable R2 for the account if it has not previously been
activated. Wrangler cannot create the bucket until R2 is enabled.

Create the R2 bucket used for audio:

```sh
npx wrangler r2 bucket create horn-of-gondor-audio
```

Apply all database migrations:

```sh
npm run db:migrate:remote
```

Deploy once to create the Worker and website:

```sh
npm run deploy
```

Generate one upload token:

```sh
openssl rand -hex 32
```

Keep this value private. Save the same token in Cloudflare:

```sh
npx wrangler secret put INGEST_TOKEN
```

Wrangler prints the deployed `workers.dev` URL. Verify the empty or current
latest-result response:

```sh
curl https://YOUR-WORKER-URL/api/v1/transmissions/latest
```

Before the first transmission, `{"data":null}` is expected.

For an existing deployment receiving the audio feature, first enable R2 in the
Cloudflare account, then run these commands in this order:

```sh
npx wrangler r2 bucket create horn-of-gondor-audio
npm run db:migrate:remote
npm run deploy
```

If deployment reports Cloudflare error `10085` and says that
`horn-of-gondor-audio` was not found, the R2 bucket was not created in the
active Cloudflare account. Create it with the first command above, then repeat
the migration and deployment.

## 3. Install Raspberry Pi Prerequisites

On the Pi:

```sh
sudo apt update
sudo apt install -y git nodejs npm rtl-sdr build-essential python3
node --version
npm --version
```

Node.js 20 or later is required. Connect the RTL-SDR and verify that it is
visible:

```sh
lsusb
rtl_test
```

Stop `rtl_test` with `Ctrl+C` after it begins reading samples.

## 4. Install the Receiver From the Repository

Clone the same repository on the Pi:

```sh
cd /home/"$USER"
git clone https://github.com/DecentralizedDan/horn-of-gondor.git
cd horn-of-gondor/receiver
npm ci
npm test
cp config.example.json config.json
chmod 600 config.json
vim config.json
```

Configure at least:

- `source.type`: set to `"rtl_fm"`
- `radio.frequencyHz`: receive frequency in integer hertz
- `radio.gainDb`: fixed tuner gain; `28` is the initial tested value
- `cloud.enabled`: set to `true`
- `cloud.apiBaseUrl`: the deployed Cloudflare URL
- `cloud.uploadToken`: leave empty; the service installer stores it separately
- `storage.retentionDays`: local and cloud retention period
- `recording.enabled`: set to `true` to capture and publish audio
- `recording.retentionDays`: audio retention period; defaults to `1`
- `recording.maximumDurationSeconds`: opening excerpt length; defaults to `10`
- `recording.directory`: temporary local WAV directory

The `source.synthetic` object may be removed when `source.type` is
`"rtl_fm"`. `radio.ppmError` is optional and defaults to zero.
Recording requires the `rtl_fm` source and a sample rate divisible by 16 kHz.
The tested 48 kHz source produces 16 kHz mono PCM WAV clips. A ten-second clip
is approximately 320 KB.

The initial RTL source settings are:

```json
{
  "type": "rtl_fm",
  "sampleIntervalMs": 100,
  "rtlFm": {
    "executable": "rtl_fm",
    "sampleRateHz": 48000,
    "restartDelayMs": 2000,
    "maximumRestartAttempts": 5
  }
}
```

Do not put the upload token in the repository or public website
configuration.

## 5. Calibrate the Receiver

Connect the intended antenna and measure an idle frequency without making a
test transmission:

```sh
sudo systemctl stop horn-of-gondor-receiver 2>/dev/null || true
npm run recalibrate
```

The script measures for 60 seconds and prints the exact `config.json` fields
and values to change. By default it recommends
`detection.thresholdDbfs` at 3 dB above the measured 95th-percentile noise. If
that recommendation would make the configured score range invalid, it also
prints a compatible `detection.scoreRangeDb`.

Apply the values with `vim config.json`. For longer sampling or a different
noise margin:

```sh
npm run recalibrate -- --seconds 120 --margin-db 4
```

After calibration, start the installed service when applicable:

```sh
sudo systemctl start horn-of-gondor-receiver
```

The configured `detection.scoreRangeDb` must satisfy:

```text
thresholdDbfs + scoreRangeDb <= 0
```

For the first tested installation, idle measurements were near `-41 dBFS`, so
`-35` threshold and `35` score range were used initially. Every antenna,
gain, frequency, and RF environment can produce a different noise floor; do
not copy these values without calibrating.

## 6. Test Live Reception

Provide the upload token in the current shell if cloud uploads are enabled:

```sh
export HORN_OF_GONDOR_UPLOAD_TOKEN='your-existing-private-token'
```

Run the receiver in the foreground:

```sh
node src/cli.js --config config.json
```

Make a lawful identified test transmission lasting at least two seconds, then
release PTT. Confirm the receiver reports the completed event and that it
appears on the website. Select its chart bar and confirm that the audio player
appears, labels the clip as complete or as an opening excerpt, and plays the
received FM audio.

During the first sustained test on a Raspberry Pi 3 B+, also check:

```sh
vcgencmd measure_temp
vcgencmd get_throttled
```

Test back-to-back transmissions and inspect the receiver log for RTL-SDR
restarts, lost samples, failed audio preparation, or deferred uploads.

Stop the foreground receiver with `Ctrl+C` before installing the service.

## 7. Install the Automatic Service

From the Pi receiver directory:

```sh
sudo bash deploy/install-systemd.sh
```

Enter the same private upload token when prompted. The installer:

- Stores it in `/etc/horn-of-gondor/receiver.env` with mode `0600`
- Creates `horn-of-gondor-receiver.service`
- Enables automatic startup after reboot
- Starts the receiver immediately
- Configures restart after failures

Check status and follow logs:

```sh
sudo systemctl status horn-of-gondor-receiver --no-pager
sudo journalctl -u horn-of-gondor-receiver -f
```

Test startup persistence:

```sh
sudo reboot
```

After reconnecting:

```sh
sudo systemctl status horn-of-gondor-receiver --no-pager
```

## Operation

After changing `config.json`, apply it with:

```sh
cd ~/horn-of-gondor/receiver
npm run restart-service
```

The restart script uses `sudo`, verifies that the service is installed, and
prints the full service status after restarting.

Recent logs:

```sh
sudo journalctl -u horn-of-gondor-receiver -n 100 --no-pager
```

If the upload token is rotated or logs report an authentication failure,
update the root-only environment file and restart:

```sh
sudo vim /etc/horn-of-gondor/receiver.env
sudo systemctl restart horn-of-gondor-receiver
```

Update an existing repository installation:

```sh
cd ~/horn-of-gondor/receiver
git -C .. pull --ff-only
npm ci
npm test
sudo systemctl restart horn-of-gondor-receiver
```

The private `receiver/config.json`, receiver database, and service environment
file are not tracked by Git. Local WAV files are temporary and are removed
after successful cloud publication.

## Security and Radio Notes

- The website is intentionally public and read-only.
- Transmission audio is public to anyone who can access the website until its
  independently configured retention period expires.
- `robots.txt`, HTML metadata, and response headers ask bots not to index the
  site, but these controls are advisory and are not access control.
- Never commit `.dev.vars`, `receiver/config.json`, or either upload-token
  copy.
- Use fixed RTL-SDR gain for comparable relative measurements.
- dBFS results are relative to this receiver chain; they are not calibrated
  RF power or S-units.
- The operator remains responsible for frequency selection, station
  identification, and compliance with local amateur-radio rules.
