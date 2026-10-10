# Horn of Gondor

[![CI](https://github.com/DecentralizedDan/horn-of-gondor/actions/workflows/ci.yml/badge.svg)](https://github.com/DecentralizedDan/horn-of-gondor/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
![Node.js 22+](https://img.shields.io/badge/node-%3E%3D22-339933?logo=node.js&logoColor=white)
![Runs on Cloudflare free tier](https://img.shields.io/badge/cloud-Cloudflare%20free%20tier-F38020?logo=cloudflare&logoColor=white)

**Did my handheld radio reach home?** Horn of Gondor answers that from your
phone. A Raspberry Pi and a cheap RTL-SDR dongle listen on one 2 m simplex
frequency at home. Whenever you key up from the field, it measures the
transmission and publishes a signal report to a public, read-only web page a
few seconds later.

<p align="center">
  <img src="docs/images/dashboard.png" alt="Horn of Gondor dashboard showing the latest signal score and a ten-minute history chart" width="560">
  &nbsp;
  <img src="docs/images/dashboard-mobile.png" alt="The same dashboard on a phone" width="220">
</p>

<p align="center"><sub>Dashboard rendered from a local run with test data.</sub></p>

## Why

Testing amateur-radio handhelds (HTs) and antennas usually needs a second
person at home saying "you're five by nine." Horn of Gondor replaces that
person with a receive-only station that gives **repeatable, relative**
measurements, so you can compare radios, antennas, and locations with
numbers instead of impressions:

- Drive to a spot, transmit for a few seconds, refresh the page.
- Swap the rubber duck for a better antenna, transmit again, compare the bars.
- Walk back from the edge of coverage and watch the score climb.

It never transmits, records audio, or identifies stations.

## How It Works

```mermaid
flowchart LR
    HT["Handheld radio<br/>(in the field)"] -. "2 m FM" .-> SDR
    subgraph Home["At home, outbound HTTPS only"]
        SDR["RTL-SDR"] -- "rtl_fm -M raw<br/>48 kHz IQ" --> RX["Node.js receiver<br/>Raspberry Pi"]
        RX --> DB[("SQLite<br/>offline queue")]
    end
    DB -- "idempotent upload<br/>bearer token" --> W["Cloudflare Worker"]
    W --> D1[("D1")]
    D1 --> Web["Public web page<br/>polls every 5 s"]
```

1. **Measure.** `rtl_fm` tunes a single channel with automatic gain control
   off and streams signed 16-bit IQ at 48 kHz. The receiver averages
   I² + Q² over 100 ms windows and converts that to dBFS against the
   `rtl_fm` full-scale value.
2. **Detect.** A transmission starts when power crosses a calibrated
   threshold. By default, it ends after 500 ms below the threshold and is
   kept only if it lasted at least one second.
3. **Score.** Peak and average power are each normalized across a 50 dB
   range above the threshold, then combined as 40% peak and 60% average into
   a 0–100 score.
4. **Survive outages.** Every event receives a UUID and is written to SQLite
   before upload. Uploads retry with exponential backoff and are idempotent,
   so a flaky home connection can't lose or duplicate a result.
5. **Publish.** A Cloudflare Worker validates the upload, stores it in D1, and
   serves a mobile-first page. Bar height shows peak dBFS, bar color shows
   the score, and bar width shows duration on a log scale.

No inbound ports, port forwarding, or paid services are required.

## Try It Without a Radio

The receiver ships with a synthetic signal source, so you can watch the
detection and scoring pipeline run on any machine with Node.js:

```sh
git clone https://github.com/DecentralizedDan/horn-of-gondor.git
cd horn-of-gondor/receiver
npm ci
npm run demo
```

```text
Horn of Gondor receiver 0.2.0 starting with synthetic input.
Cloud uploads are disabled; events will remain pending locally.
Detected transmission b6a48c33-…: 1800 ms, peak -54 dBFS, score 16
Detected transmission e57da74e-…: 3200 ms, peak -31 dBFS, score 62
Receiver stopped. 2 pending, 0 uploaded, 0 rejected.
```

To run the website and API locally as well, see [Local Development](#local-development).

## Hardware

| Part     | Used for the MVP                                       |
| -------- | ------------------------------------------------------ |
| Computer | Raspberry Pi 3 Model B+ running 64-bit Raspberry Pi OS |
| Receiver | RTL-SDR Blog V3 (R860 tuner, RTL2832U, 1 PPM TCXO)     |
| Antenna  | The antenna supplied with the RTL-SDR                  |
| Network  | Any home internet connection                           |

Any RTL-SDR supported by `rtl-sdr` should work. The receiver tunes one
frequency between 144 and 148 MHz.

## What the Numbers Mean

Scores are **relative, not calibrated**. dBFS here is measured against the
fixed `rtl_fm` processing chain, not antenna input power, and it is not an
S-meter reading. That is deliberate: fixed gain and a fixed threshold make
readings comparable over time on the same station, which is what you need to
compare two radios or two antennas. Other users on the frequency will also
show up in the results.

## Status

The live path from RF to website is working on a real Pi. The Worker API,
public page, synthetic receiver, RTL-SDR input, local storage, upload queue,
and `systemd` installer are complete. Broader field testing is in progress.
See [ROADMAP.md](ROADMAP.md) for details, including planned recording and
playback of transmissions.

## Deploy Your Own

[docs/installation.md](docs/installation.md) walks through a complete setup:
creating the Cloudflare D1 database and Worker, installing the receiver on
the Pi, calibrating the noise threshold, and installing the `systemd`
service.

## Local Development

Requires Node.js 22 or later.

```sh
npm install
npm --prefix receiver install
echo 'INGEST_TOKEN=replace-with-a-long-random-secret' > .dev.vars
npm run db:migrate:local
npm run dev
```

Wrangler prints the local URL. The public page and API are served from the
same origin.

<details>
<summary>Send a test transmission to the local API</summary>

```sh
curl http://localhost:8787/api/v1/transmissions \
  --request POST \
  --header 'Authorization: Bearer replace-with-a-long-random-secret' \
  --header 'Content-Type: application/json' \
  --data '{
    "eventId": "3157bbbf-7208-4873-9c1c-e99965a0d6c4",
    "startedAt": "2026-10-09T00:31:42.127Z",
    "durationMs": 4380,
    "peakDbfs": -31.4,
    "averageDbfs": -39.8,
    "score": 76,
    "frequencyHz": 146550000,
    "gainDb": 28,
    "thresholdDbfs": -62,
    "receiverVersion": "0.2.0"
  }'
```

</details>

Run type checking, Worker integration tests, receiver tests, and a dry-run
Cloudflare build:

```sh
npm run check
```

## Repository Layout

| Path                                           | Contents                                                                      |
| ---------------------------------------------- | ----------------------------------------------------------------------------- |
| [`receiver/`](receiver/)                       | Raspberry Pi service: `rtl_fm` input, detection, scoring, SQLite, and uploads |
| [`src/`](src/)                                 | Cloudflare Worker API and daily retention job                                 |
| [`public/`](public/)                           | Public website, written in plain HTML, CSS, and JavaScript                    |
| [`migrations/`](migrations/)                   | D1 schema migrations                                                          |
| [`docs/api-contract.md`](docs/api-contract.md) | API shared by the Pi and the cloud service                                    |
| [`REQUIREMENTS.md`](REQUIREMENTS.md)           | MVP requirements and scoring definition                                       |

## API

| Endpoint                           | Access                      |
| ---------------------------------- | --------------------------- |
| `GET /api/v1/transmissions/latest` | Public                      |
| `GET /api/v1/transmissions`        | Public, paginated           |
| `POST /api/v1/transmissions`       | Receiver only, bearer token |
| `PUT /api/v1/settings`             | Receiver only, bearer token |

See [docs/api-contract.md](docs/api-contract.md) for request bodies,
validation, pagination, and error behavior.

## Operating Notes

The operator is responsible for choosing a lawful frequency for the local
band plan and identifying their own transmissions as required. The public
site stores no audio and no receiver location.

## Contributing and Security

See [CONTRIBUTING.md](CONTRIBUTING.md) for development and pull-request
guidance. Report vulnerabilities according to [SECURITY.md](SECURITY.md).

## AI-Assisted Development

I am a software engineer with 10 years experience writing code. Everything
in Horn of Gondor was written using AI tools under my direction. I
chose to use AI because it was way faster and easier than learning how
to do this from scratch.

## License

[MIT](LICENSE)
