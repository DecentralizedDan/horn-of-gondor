# Horn of Gondor

[![CI](https://github.com/DecentralizedDan/horn-of-gondor/actions/workflows/ci.yml/badge.svg)](https://github.com/DecentralizedDan/horn-of-gondor/actions/workflows/ci.yml)

Horn of Gondor is an open source VHF signal-reporting receiver for testing amateur-radio handheld transceivers. A Raspberry Pi and RTL-SDR detect transmissions at home, then publish relative signal reports to a public, read-only website.

The project is under active development. The Cloudflare API and public display
are implemented. The Raspberry Pi receiver supports synthetic signals, local
SQLite storage, scoring, upload queuing, and channelized RTL-SDR IQ input.
The live RF-to-website path has been verified; broader field testing remains.

## Architecture

- `src/` contains the Cloudflare Worker API and retention job.
- `public/` contains the mobile-first public website.
- `public/config.json` contains public chart display settings.
- `receiver/` contains the Node.js service that runs on the Raspberry Pi.
- `receiver/deploy/` contains the Raspberry Pi `systemd` installer.
- `migrations/` contains Cloudflare D1 database migrations.
- `test/` contains Worker integration tests.
- `docs/api-contract.md` defines the API shared by the Pi and cloud service.
- `docs/installation.md` covers a fresh Cloudflare and Raspberry Pi install.
- `REQUIREMENTS.md` defines the MVP.
- `ROADMAP.md` tracks the path to deployment, Pi integration, and future work.

## Installation

See [docs/installation.md](docs/installation.md) for the complete installation,
calibration, `systemd`, verification, update, and operations procedure.

## Prerequisites

- Node.js 22 or later
- npm
- A free Cloudflare account

## Local Setup

1. Install dependencies:

   ```sh
   npm install
   npm --prefix receiver install
   ```

2. Create `.dev.vars` with a development upload token:

   ```text
   INGEST_TOKEN=replace-with-a-long-random-secret
   ```

3. Apply the D1 migration locally:

   ```sh
   npm run db:migrate:local
   ```

4. Start the local Cloudflare development server:

   ```sh
   npm run dev
   ```

Wrangler prints the local URL. The public page and API are served from the same origin.

## Test an Upload Locally

Replace the URL and bearer token if your local configuration differs:

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

## Verification

Run the complete local verification suite:

```sh
npm run check
```

This performs TypeScript checking, Worker integration tests, and a dry-run Cloudflare build.

## Cloudflare Deployment

1. Authenticate Wrangler:

   ```sh
   npx wrangler login
   ```

2. Create the production D1 database:

   ```sh
   npx wrangler d1 create horn-of-gondor
   ```

3. Copy the returned database ID into `wrangler.jsonc`, replacing the existing
   `database_id` value.

4. Apply the production migration:

   ```sh
   npm run db:migrate:remote
   ```

5. Deploy once to create the Worker and website:

   ```sh
   npm run deploy
   ```

6. Generate a strong upload secret:

   ```sh
   openssl rand -hex 32
   ```

7. Save that value as the encrypted Worker secret:

   ```sh
   npx wrangler secret put INGEST_TOKEN
   ```

Do not commit `.dev.vars`, upload tokens, or other credentials.

## API

The public endpoints are:

- `GET /api/v1/transmissions/latest`
- `GET /api/v1/transmissions`

The Pi uses authenticated endpoints:

- `POST /api/v1/transmissions`
- `PUT /api/v1/settings`

See `docs/api-contract.md` for request bodies, validation, pagination, and error behavior.

## Contributing and Security

See [CONTRIBUTING.md](CONTRIBUTING.md) for development and pull-request
guidance. Report vulnerabilities according to [SECURITY.md](SECURITY.md).

## License

Horn of Gondor is available under the MIT License.
