<p align="center"><img src="split.png" alt="Split" width="260"></p>

Share expenses with friends, settle up without the awkward math. Live at
[split.dhairya.cloud](https://split.dhairya.cloud).

Fully self-hosted and infrastructure-as-code: everything from the app code to
the server it runs on is defined in this repo. For a guided tour of how it
all fits together — the money math, the containers, the Terraform, the sharp
edges — see [HOW-IT-WORKS.md](HOW-IT-WORKS.md).

## Features

- Groups with email invites — existing users are added instantly, new
  people get a signup link and join automatically when they register
- Expenses with equal or exact splits (money handled as integer paise/cents),
  editable after the fact — balances always recalculate from the record
- Live balances with debt simplification — at most N−1 transfers to settle a
  whole group
- Recorded settlements ("paid back via GPay") — reviewable and removable, so
  a mis-click never locks in a payment that did not happen
- Sign in with Google or email + password — a Google sign-in links to an
  existing account with the same email automatically
- Cookie-session auth (scrypt password hashing, sessions in Redis)
- Email notifications: group invites, weekly "you owe" reminders (Brevo;
  logged to console when no `BREVO_API_KEY` is set)
- Group bin with 30-day retention, purged by a scheduled job
- Account deletion (settled-up accounts only) — shared expense history is
  anonymized, never altered

## Architecture

- `apps/api` — Fastify (TypeScript) REST API + BullMQ worker process
  (emails, scheduled jobs) sharing one codebase
- `apps/web` — React (Vite) frontend
- Postgres (data) + Redis (sessions + job queue) as backing services
- Infra: Oracle Cloud free ARM VM, Docker Compose, Terraform, Nginx + Let's
  Encrypt, GitHub Actions CI/CD, Prometheus/Grafana — coming in phases 3–5

## Local development

Requirements: Node 20+, Docker.

```sh
npm install
docker compose -f docker-compose.dev.yml up -d   # postgres + redis
npm run migrate --workspace apps/api              # apply DB migrations
npm run dev:api                                   # API on :3000
npm run dev:worker                                # job worker (emails, schedules)
npm run dev:web                                   # frontend on :5173 (proxies /api)
```

Tests: `npm test --workspace apps/api` · Health: `curl localhost:3000/api/health`

Dev dashboards: Adminer (DB) at `localhost:8080` — server `postgres`,
user/password/db `split` · Bull Board (queues) at
`localhost:3000/admin/queues` (non-production only)
