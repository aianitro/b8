# Step 19 — putting b8 on a machine that stays on

What is done, what is yours, and what to type. Written after the container was built and run for
the first time on 2026-09-15; every claim below about the app's behaviour was measured, not assumed.

---

## What this buys you

Today the app runs on one laptop, bound to `127.0.0.1`, only while a dev server is running. Nothing
else in the house can reach it. After this it runs on a machine that stays on, and your phone reaches
it over Tailscale from anywhere — with nothing exposed to the public internet.

It is also the precondition for a mobile app. A phone client needs a server to talk to that is not
your closed laptop.

---

## Already done, in the repo

- **The image builds.** `docker compose build` was failing for four reasons, all now fixed and
  committed. It had never been run before, so none of them were known.
- **Migrations apply to a fresh database** — verified against an empty volume: 13 migrations, 19
  tables.
- **The app comes up and serves.**
- **The auth boundary is already correct for a tailnet.** Step 12 put every route behind a session
  and added the Tailscale hostname to the host allowlist. Measured through the running container:

  | `Host:` header      | result |
  |---------------------|--------|
  | `localhost:3000`    | 200    |
  | `b8.tailnet.ts.net` | 200    |
  | `evil.example.com`  | 403    |
  | `192.168.1.50:3000` | 403    |

  The LAN address being refused is the part worth noticing: even if the port were accidentally
  exposed on your home network, the app would not answer to it.

---

## Yours to do

### 1. A machine

Any always-on box: a mini-PC, an old laptop with the lid-close behaviour changed, a NAS that runs
Docker. It needs Docker and Docker Compose, and enough disk for Postgres plus two images (~1.7 GB
during build; the runtime image is 298 MB).

### 2. Copy the repo and make an `.env.local`

Start from `.env.local.example`. Everything in it is already documented there. Two notes:

- **`POSTGRES_PASSWORD` must be set.** It is empty in the example and absent from the laptop's
  `.env.local`, so compose refuses to start without it. It is the password for the containerised
  Postgres only — a fresh database the compose file creates — so any strong value works:

  ```
  openssl rand -base64 24
  ```

- **`DATABASE_URL` in the file is ignored for the containers.** `docker-compose.yml` overrides it to
  point at the `db` service. It still needs to be present and valid-looking.

### 3. Move your data across

The container starts with an **empty** database. To bring a year of categorised history with it:

```bash
# on the laptop
pg_dump -Fc -d b8_finance -f b8.dump

# on the server, after `docker compose up -d db`
docker compose cp b8.dump db:/tmp/b8.dump
docker compose exec db pg_restore -U b8 -d b8_finance --clean --if-exists /tmp/b8.dump
```

Do this **before** pointing anything at the new machine, and keep the laptop's database until you
have signed in on the server and seen your own numbers.

### 4. Install Tailscale on the server and on your phone

```bash
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up
```

Note the MagicDNS name it prints — something like `b8-server.tailnet-name.ts.net`.

### 5. Put that name in the host allowlist

`lib/hostGuard.ts` has:

```ts
export const TAILNET_HOSTNAME = 'b8.tailnet.ts.net';
```

Replace it with your real MagicDNS name. **This is deliberately one constant and not an environment
variable**: `lib/webauthnOrigins.ts` derives the WebAuthn expected-origin set from the allowlist
rather than copying it, so changing this literal moves both lists at once. A passkey registered
against the wrong origin will not work and the failure is opaque.

Rebuild after changing it.

### 6. Serve it over Tailscale, with TLS

```bash
sudo tailscale serve --bg 3000
# if that flag is not recognised on your version:
sudo tailscale serve https / http://127.0.0.1:3000
```

**Unverified command.** Tailscale is not installed on the laptop this was written on, so unlike
everything else in this document the exact flags were not run. The `serve` subcommand's syntax has
changed across releases; check `tailscale serve --help` on the machine and trust that over this
page.

What you are after, however it is spelled: the app published at `https://<your-magicdns-name>/`
inside your tailnet with a real certificate, while the container stays published only on
`127.0.0.1:3000`.

**Do not skip the TLS part and reach the app by IP and port.** Passkeys require a secure context, so
`http://100.x.y.z:3000` cannot complete a WebAuthn ceremony — you would be locked out of your own
app. `lib/webauthnOrigins.ts` already expects `https://` for every host but `localhost`, which is why
the app and `tailscale serve` agree by construction.

### 7. Register a passkey on the server

The first registration is open only while zero credentials exist, and closes permanently on the
first one. Your laptop's credential lives in the laptop's database, so:

- if you restored the dump in step 3, your existing passkey came with it, and you **sign in**;
- if you started empty, **register** — and do it before anyone else can reach the tailnet.

---

---

## The daily job, and why it is not the server's to run

**Fixed 2026-09-16, after the stale digest went out twice.**

The job — Plaid sync, net worth snapshot, digest — used to run on a timer registered inside the Next
server at boot. That timer's closure holds the module graph from the moment the server started, so
any code change afterwards is invisible to it. It sent a stale template on two consecutive mornings
while the correct code sat committed on disk, and "remember to restart the server" failed both times.

A process started per run has no such window. So:

```bash
npm run job:daily          # the whole job, once, then exits
```

On this laptop, launchd owns the schedule:

```bash
./ops/install-daily-job.sh
echo 'SCHEDULER_IN_PROCESS=false' >> .env.local   # or the job runs twice
```

**Both halves are required.** Installing the agent without setting `SCHEDULER_IN_PROCESS=false`
means two syncs a day; setting it without installing the agent means none at all. The in-process
timer defaults to ON precisely so that forgetting the second half is loud rather than silent.

**On the server, run it in the container**, not on the host — the host has no Node and no
dependencies:

```
0 6 * * *  cd /path/to/b8 && docker compose run --rm migrate npm run job:daily
```

The `migrate` service is the right target: it builds from the `builder` stage, which keeps the
devDependencies (`tsx` among them) that the pruned runtime image deliberately drops.

---

---

## Backups

**Done 2026-09-16.** `npm run backup`, and the launchd agent runs it before the daily job every
morning.

Each run dumps, **restores the dump into a scratch database and counts it against the source**, and
only then keeps the file. A restore rehearsed once by hand tells you about that day; what goes wrong
later is silent — a dump truncated because a disk filled, a `pg_dump` that starts failing after a
server upgrade — and every one of those leaves a directory full of files that look exactly like
backups. The output here is not "a backup was written", it is "a backup was written and it came
back".

- Written to `../backups/`, outside the repo, 30 kept (about 4 MB).
- The pruner only ever considers files matching its own naming pattern, so the dumps taken by hand
  before risky migrations are invisible to it.
- Written under a `.partial` name and renamed on success, so an interrupted dump can never be
  mistaken for a good one.
- Backup runs BEFORE the sync, so the dump is from before the day's mutations, and with `;` rather
  than `&&`, so a backup failure costs the backup and not the sync, the snapshot and the mail.

**Restoring for real**, which is the thing this rehearses:

```bash
createdb b8_restore_check
pg_restore -d b8_restore_check --no-owner ../backups/<newest>.dump
psql -d b8_restore_check -c 'SELECT count(*) FROM transactions;'
```

Never restore over `b8_finance` without taking a dump of it first.

---

## What this step does NOT give you
- **No process supervision beyond `restart: unless-stopped`.** If the machine reboots, Docker
  restarts the containers; if the app crashes in a loop, nothing tells you.
- **No EXTERNAL uptime check.** The local half is done — the dashboard and the digest both report a
  missed daily job, derived from `sync_log` — but a check running on the machine cannot speak while
  the machine is silent. The usual remedy is a third-party service expecting a ping, which is a new
  outbound destination and a §5.1 escalation nobody has made. Worth deciding once the server is real
  and "the machine is off" stops being something the owner already knows.
- **launchd only runs while the machine is awake and logged in.** It will run a missed job shortly
  after wake, which the in-process timer never did, but a laptop closed all day still misses that
  day. The always-on server is the fix for that, not this.

---

## If something does not start

- `ports are not available: 5432` — something already listens there. On the laptop that is the
  native Postgres; on the server it is likely nothing.
- `set POSTGRES_PASSWORD in .env.local` — step 2.
- `403` on every page — the `Host:` header does not match the allowlist. Step 5.
- A WebAuthn ceremony that fails with no useful message — almost certainly reached over `http`
  rather than through `tailscale serve`. Step 6.
