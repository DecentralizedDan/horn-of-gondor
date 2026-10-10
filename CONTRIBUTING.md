# Contributing to Horn of Gondor

Contributions are welcome through GitHub issues and pull requests.

## Development Setup

Install Node.js 22 or later, clone the repository, and run:

```sh
npm ci
npm ci --prefix receiver
npm run check
```

See [docs/installation.md](docs/installation.md) for Cloudflare and Raspberry
Pi setup.

## Pull Requests

- Keep changes focused and explain how they were tested.
  - Changes should be as small and compartmentalized as possible.
  - Giant changes will be ignored.
- Add or update tests when behavior changes.
- Run `npm run check` before submitting.
- Update documentation when configuration, installation, or operation changes.
- Do not commit upload tokens, `.dev.vars`, `receiver/config.json`, receiver
  databases, recordings, or location data.
- Describe signal measurements as relative dBFS values unless they were
  produced by a documented calibrated test setup.

## Radio Safety and Compliance

Test transmissions must follow the operator's license conditions, local band
plan, identification requirements, and applicable regulations. Avoid
interfering with active communications.
