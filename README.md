# Split

Share expenses with friends, settle up without the awkward math. Live (soon) at
[split.dhairya.cloud](https://split.dhairya.cloud).

Fully self-hosted and infrastructure-as-code: everything from the app code to
the server it runs on is defined in this repo.

## Architecture

- `apps/api` — Fastify (TypeScript) REST API
- `apps/web` — React (Vite) frontend
- Postgres (data) + Redis (job queue) as backing services
- Background workers (receipt OCR, email reminders) — coming in phase 2
- Infra: Oracle Cloud free ARM VM, Docker Compose, Terraform, Nginx + Let's
  Encrypt, GitHub Actions CI/CD, Prometheus/Grafana — coming in phases 3–5

## Local development

Requirements: Node 20+, Docker.

```sh
npm install
docker compose -f docker-compose.dev.yml up -d   # postgres + redis
npm run dev:api                                   # API on :3000
npm run dev:web                                   # frontend on :5173 (proxies /api)
```

Health check: `curl localhost:3000/api/health`
