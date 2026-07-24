# How Split Works

A guided tour of this codebase and the infrastructure it runs on. No prior
knowledge of the stack assumed — where Sesh's guide leaned application-side,
Split's story is half app, half operations, because this project owns its
server all the way down to the firewall rules.

---

## 1. The big picture

Split is five cooperating containers on one ARM VM in Oracle Cloud:

```
                        HTTPS (443)
                            │
                 ┌──────────▼──────────┐
                 │  web — Nginx        │  static React bundle
                 │  TLS termination    │  /api/* proxied onward
                 └──────────┬──────────┘
                            │ http (Docker network, not the internet)
                 ┌──────────▼──────────┐
                 │  api — Fastify      │──────┐
                 │  REST + sessions    │      │
                 └───┬────────────┬────┘      │
                     │            │           │
              ┌──────▼─────┐ ┌────▼─────┐ ┌───▼──────────────┐
              │  postgres  │ │  redis   │ │  worker — BullMQ │
              │  the facts │ │ sessions │ │  emails + cron   │
              └────────────┘ │ + queue  │ └──────────────────┘
                             └──────────┘
```

- **web** is the only container with ports open to the internet (80/443).
  It serves the compiled React app and reverse-proxies `/api/*` to the API.
- **api** is a Fastify (Node/TypeScript) REST server. Every piece of truth —
  users, groups, expenses — lives in Postgres; login sessions live in Redis.
- **worker** is a second Node process running the *same codebase* as the API
  but doing background work: sending emails and running scheduled jobs. It
  talks to the API only through Redis (a job queue), never directly.
- **postgres** and **redis** have no public ports at all. They're reachable
  only on Docker's internal network, by service name.

A sixth small container, **certbot**, wakes twice a day to renew the TLS
certificate. That's the whole system.

## 2. Repo layout

```
split/
├── apps/
│   ├── api/            # Fastify server + worker (one codebase, two entrypoints)
│   │   ├── migrations/ # numbered .sql files — the database's version history
│   │   └── src/        # routes, auth, balances math, jobs, email
│   └── web/            # React app (Vite)
├── infra/
│   ├── terraform/      # the server, network and firewall as code
│   └── nginx/          # reverse-proxy configs (plain + TLS)
├── docker-compose.dev.yml   # local: just postgres/redis/adminer
├── docker-compose.prod.yml  # production: the full five-container stack
└── .env                     # secrets (gitignored; .env.example shows the shape)
```

One npm-workspaces monorepo: `npm install` once at the root wires up both
apps. `npm run dev:api`, `dev:worker` and `dev:web` run the three processes
locally with hot reload against the dev containers.

## 3. Money, the part that must never be wrong

Three rules keep the accounting trustworthy:

**Rule 1 — money is integers.** Every amount is stored and computed in
paise (`amount_cents bigint`). Floating point can't represent 0.1 exactly;
adding thirds of ₹100 in floats drifts by fractions of a paisa that
eventually surface as a ₹0.01 discrepancy nobody can explain. Integers
can't drift. Splitting ₹100 three ways gives 3334 + 3333 + 3333 — the
remainder paisa are handed to the first participants, deterministically
(`equalSplit` in `balances.ts`, covered by unit tests).

**Rule 2 — balances are never stored.** There is no `balance` column
anywhere. A member's net position is *derived* on every read:

```
net = paid (expenses)  − owed (shares)  + sent (settlements) − received
```

Storing a running balance means every write must update it correctly
forever, and one missed path leaves a stale number nobody can trust.
Deriving it means expenses can be added, edited, or deleted — settlements
recorded or undone — and the balances are simply *recomputed from the
record*, correct by construction. This one decision is why features like
expense editing and settlement undo were cheap to build.

**Rule 3 — history is protected.** A member can only be removed from a
group when their net is exactly zero; an account can only be deleted when
it's settled up everywhere. Deleting an account that appears in shared
history doesn't remove the row — it's *anonymized* ("Deleted user", scrambled
email, unusable password) so everyone else's records stay intact. The
database enforces this too: expense rows reference users without cascade
deletes, so even a bug can't silently vaporize who-paid-what.

The one clever algorithm: **debt simplification** (`simplifyDebts`). Naively,
five people can owe each other along ten different edges. The greedy
algorithm repeatedly matches the biggest debtor with the biggest creditor,
which settles any group in at most N−1 transfers. It's the same algorithm
Splitwise made famous.

## 4. Signing in

Standard cookie sessions, done carefully:

- Passwords are hashed with **scrypt** (Node's built-in) — deliberately slow
  and memory-hungry, so stolen hashes are expensive to brute-force. Each
  user gets a random salt; comparison uses `timingSafeEqual`.
- A successful login writes `sess:<random-uuid> → userId` into Redis with a
  30-day TTL and hands the browser a signed, httpOnly cookie holding that
  uuid. The browser can't read or forge it; the server checks Redis on every
  request. Logout (and account deletion) deletes the Redis key — sessions
  are revocable instantly, server-side.
- Why Redis and not a JWT? Revocability. A JWT is valid until it expires no
  matter what; a Redis session dies the moment we delete the key.

## 5. Groups and their life cycle

The features are ordinary; the invariants are the interesting part.

- **Invites**: adding an email that has an account joins them instantly (and
  emails them). An unknown email becomes a *pending invite* — stored in
  `group_invites`, emailed a signup link — and signup redeems it: account
  creation and group-joining happen in one database transaction, so neither
  exists without the other.
- **The bin**: deleting a group soft-deletes it (`deleted_at` timestamp).
  Binned groups behave as deleted everywhere except the bin page, can be
  restored for 30 days, and are permanently purged by a scheduled job.
  Permanent deletion by hand requires the group to already be in the bin —
  no single click can irreversibly destroy a live group.
- **Expenses are editable, settlements are removable** — both are visible
  records with a paper trail (edited expenses carry a marker), and every
  correction flows through the derived-balance math (§3, Rule 2).

## 6. The worker: things that happen without a request

Some work shouldn't happen inside an HTTP request: sending email (slow,
can fail, needs retries) and anything on a schedule. That's the worker's
job, connected to the API by **BullMQ**, a Redis-backed job queue.

The pattern: the API *enqueues* (e.g. "send this invite email") and returns
immediately; the worker *dequeues* and does the work. If sending fails, the
job retries with exponential backoff (3 attempts). If the worker is down,
jobs wait in Redis until it's back. The API never blocks on email — an
invite whose notification fails still added the member.

Two scheduled jobs live in the worker (`upsertJobScheduler` keeps them
registered without duplicating on restarts):

- **Bin purge** — every 6 hours, permanently delete groups binned more than
  30 days ago.
- **Debt reminders** — Mondays 9am IST, compute per-group debts and email
  each debtor a summary.

Email itself goes through **Brevo** (transactional email service, free
tier) — because email from a fresh VM's IP goes straight to spam. The
domain is authenticated with SPF/DKIM/DMARC. With no `BREVO_API_KEY` set,
emails just log to the console — local dev never sends anything real.

## 7. The database's version history

The schema isn't managed by hand — `migrations/` holds numbered SQL files
(`001_init.sql`, `002_...`) that are applied in order, exactly once each,
by a small runner (`migrate.ts`). Applied filenames are recorded in a
`schema_migrations` table; each file runs inside a transaction; a Postgres
advisory lock ensures two containers starting at once can't both run
migrations. The production API container's start command is literally
"migrate, then serve" — deploying a schema change is just deploying.

## 8. The server it runs on (infrastructure as code)

Nothing about the server was clicked together in a cloud console. The whole
environment is ~150 lines of Terraform in `infra/terraform/`:

- **The network** (`network.tf`): a VCN (Oracle's private network), an
  internet gateway, and a security list allowing exactly three inbound
  ports — 22 (SSH), 80, 443. Postgres and Redis aren't just firewalled,
  they have no public ports at all (§1) — defence in depth.
- **The VM** (`compute.tf`): an Ampere A1 instance (4 ARM cores, 24 GB RAM —
  Oracle's always-free allotment), always resolving the newest Ubuntu 24.04
  ARM image rather than pinning a stale one.
- **First boot** (`cloud-init.yaml`): installs Docker and opens 80/443 in
  the *OS-level* firewall — Oracle's Ubuntu images ship iptables rules that
  reject everything but SSH, a classic trap where the cloud firewall says
  yes but the server still refuses connections.

`terraform apply` builds all of it; `terraform destroy` removes it;
`terraform plan` shows exactly what would change and nothing changes
outside these files. If the VM vanished tomorrow, the rebuild is: apply,
point DNS at the new IP, restore a database backup, `docker compose up`.

Total monthly cost: ₹0. The VM, the network, and the egress all fit in
Oracle's always-free tier; the domain was already owned.

## 9. Production: how a request reaches the code

- **DNS**: `split.dhairya.cloud` is an A record (Hostinger) pointing at the
  VM's public IP.
- **TLS**: a Let's Encrypt certificate, obtained via the ACME HTTP
  challenge — Let's Encrypt calls `http://split.dhairya.cloud/.well-known/
  acme-challenge/...` and issuance proves domain control. The certbot
  container renews twice daily (a no-op until ~30 days before expiry).
  Nginx redirects all plain HTTP to HTTPS, except that challenge path.
- **Nginx** terminates TLS, serves the React bundle, and proxies `/api/*`
  to the API container by service name — resolved through Docker's internal
  DNS *per request* (see sharp edge #2 below for why that italic matters).
- **The stack** is `docker-compose.prod.yml`: multi-stage Docker builds
  (the dev toolchain never reaches the final images), containers run as an
  unprivileged user, healthchecks gate startup order (Postgres must answer
  before the API starts; the API must be healthy before Nginx starts), and
  `restart: unless-stopped` brings everything back after a reboot.
- **Data outlives containers**: Postgres data, Redis's append-only file,
  and the TLS certificates live in named Docker volumes. Containers are
  cattle; volumes are pets.
- **Deploying** is currently: SSH in, `git pull`, `docker compose -f
  docker-compose.prod.yml up -d --build --wait`. Images build natively on
  the ARM server. (CI/CD to automate exactly this is the next milestone.)
- **Secrets** live in a `.env` file on the server (mode 600, gitignored):
  the database password and cookie-signing secret were generated *on* the
  server and have never existed anywhere else; the Brevo API key is a
  production-only key, separate from the dev one.

## 10. Where the sharp edges are

The "why is this weird" list — traps the current code already avoids:

1. **Postgres `sum(bigint)` returns a string.** Summing bigints yields
   `numeric`, which the Node driver returns as a string to avoid precision
   loss — and JavaScript's `+` happily *concatenates* it. Every aggregate
   in the balance queries carries a `::bigint` cast, and the driver is
   configured to parse int8 as a number. Symptom if you forget: balances
   10× too large with digits in suspicious order.
2. **Nginx caches DNS at startup.** A literal `proxy_pass http://api:3000`
   resolves `api` once, forever. Recreate the API container (any deploy)
   and it gets a new internal IP — Nginx keeps proxying into the void:
   502s while the API is perfectly healthy. Fix: a `resolver 127.0.0.11`
   directive plus a variable upstream, which forces per-request
   re-resolution. If you touch the Nginx configs, keep that pattern.
3. **Compose project names fork resources.** Volume and network names are
   prefixed by the project name, which defaults to the directory name. A
   renamed checkout would quietly create a second, empty database. The
   prod compose file pins `name: split` so it can't happen.
4. **Oracle's Ubuntu images firewall themselves.** The cloud security list
   is not the only firewall — the OS ships iptables rules rejecting all
   inbound except SSH. Cloud-init opens 80/443 and persists it. If a new
   port ever "doesn't work" despite the security list allowing it, look
   here first.
5. **Never stop the VM.** Always-free ARM capacity in this region is
   scarce; a stopped instance releases its hardware claim and restarting
   can fail with "out of host capacity" indefinitely. Reboots are fine
   (the claim is kept). There is never a reason to stop it — it costs
   nothing while running.
6. **Participants must be current members.** Expense edits validate against
   the *current* member list; an old expense involving a since-departed
   member filters them out client-side too. The removed member's history
   stays (rule 3 of §3) — they just can't be in *new* math.

## 11. Local development

```
docker compose -f docker-compose.dev.yml up -d   # postgres, redis, adminer
npm install
npm run dev:api      # API on :3000 (applies migrations on boot)
npm run dev:worker   # background jobs
npm run dev:web      # React app on :5173, proxying /api to :3000
```

Dev niceties: **Adminer** (a one-container database GUI) on :8080 — log in
with server `postgres`, user/password/database `split`; **Bull Board** (a
queue dashboard: jobs, retries, failures) at `:3000/admin/queues`. Both are
dev-only — neither exists in the production images. For production
inspection, SSH in and `docker exec -it split-postgres-1 psql -U split`.

`npm test` runs the unit tests for the money math — the part where a bug
would matter most.
