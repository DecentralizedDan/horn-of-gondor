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
`d1_databases[0].database_id` value. Then apply the database migration:

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

The `source.synthetic` object may be removed when `source.type` is
`"rtl_fm"`. `radio.ppmError` is optional and defaults to zero.

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
timeout 60 node src/cli.js --config config.json --calibrate
```

Calibration prints one-second minimum, median, 95th-percentile, and maximum
dBFS summaries. Start with `detection.thresholdDbfs` approximately 6 dB above
the stable noise level.

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
appears on the website.

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
sudo systemctl restart horn-of-gondor-receiver
```

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
file are not tracked by Git.

## Security and Radio Notes

- The website is intentionally public and read-only.
- `robots.txt`, HTML metadata, and response headers ask bots not to index the
  site, but these controls are advisory and are not access control.
- Never commit `.dev.vars`, `receiver/config.json`, or either upload-token
  copy.
- Use fixed RTL-SDR gain for comparable relative measurements.
- dBFS results are relative to this receiver chain; they are not calibrated
  RF power or S-units.
- The operator remains responsible for frequency selection, station
  identification, and compliance with local amateur-radio rules.
