# URL / IP Checker

[![CI](https://github.com/Smithey-Lab/url-ip-checker/actions/workflows/ci.yml/badge.svg)](https://github.com/Smithey-Lab/url-ip-checker/actions)

Public network diagnostics by Smithey Lab: DNS records, TCP latency, HTTP response headers, TLS certificates, ping and traceroute. [Try the hosted tool](https://smitheylab.com/tools/url-ip-checker/).

Direct checks run in AWS Lambda. Ping and traceroute use one US Globalping probe; results identify the probe location. Target validation rejects non-public destinations, pins direct connections to the validated address, and does not follow HTTP redirects.

## Local development

Use Node.js 24 or newer:

```sh
npm ci
npm run ci
npm run dev
```

Open http://localhost:5173. The example API endpoint is empty. Tests use fixtures and mocks; CI does not deploy AWS resources or start measurements. See [deployment](docs/deployment.md) to run your own backend.

## Layout

- `src/`: standalone frontend and example configuration.
- `backend/checker.cjs`: diagnostics, destination checks and quota reservations.
- `backend/*.test.cjs`: isolated backend tests.
- `scripts/`: static build and standalone infrastructure generation.

The parent website, other tools, admin portal, production configuration and user records are excluded.

## Limits and privacy

Defaults: 20 checks per network per UTC hour and 1,000 globally per UTC day. Ping and traceroute additionally share five per network per hour, 100 globally per hour and 200 globally per day. Cooldowns are 30 seconds for probes and 10 seconds for other checks. IPv6 networks are grouped by /64. Quota records use daily network hashes and asynchronous DynamoDB TTL deletion.

Globalping receives the public target address. Its public measurements are not private; the browser also contacts Globalping to retrieve results. Review its terms before operating an instance. No paid Globalping credentials are included. The backend stores quota counters rather than a target history.

Rate limits reduce exposure; they do not create a hard billing ceiling for AWS requests or other resources. Only test destinations you are authorized to investigate.

## Contributing and security

Open feature PRs into `dev` and release PRs into `main`. Both branches require the `Quality` check and resolved review conversations. Approval count is zero so a sole maintainer can merge their own passing PRs. See [CONTRIBUTING.md](CONTRIBUTING.md), [SECURITY.md](SECURITY.md), [LICENSE](LICENSE) and [NOTICE.md](NOTICE.md).

CI runs lint, tests, the frontend build, a publication pattern check and a production dependency audit. Original code is MIT licensed; dependency licenses and branding rights remain separate.
