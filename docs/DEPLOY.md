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

### 5. Put that name in the server's `.env.local`

```
B8_TAILNET_HOSTNAME=<your-magicdns-name>
```

The trailing dot `tailscale status` prints is fine; it is stripped.

This used to be a hard-coded constant in `lib/hostGuard.ts`. It moved to the environment on
2026-09-17 because the real name carries the owner's machine name and tailnet id, and the repo is
public. **The derivation is unchanged:** the host allowlist and the WebAuthn origins are both still
computed from this one value, so setting it moves both at once.

The app also picks the passkey relying-party id per request now — the tailnet name when the page was
served there, `localhost` otherwise — always from that fixed set and never from the raw header. A
browser refuses a ceremony whose relying party is not the page's own domain, so without this every
sign-in over the tailnet would fail before reaching the server.

Restart the web service after changing it.

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

**Done 2026-09-17, and the way it had to be done is worth knowing.** A passkey belongs to the domain
it was registered on. The restored database carried the laptop's passkey, registered at `localhost`,
which a browser on the tailnet will never offer — and because one passkey existed, registration was
closed. So nobody could sign in. The fix was to remove that one row from the SERVER's database only,
saved first, which reopened registration, and to register from the phone at the tailnet address
immediately.

**This changes cutover.** A fresh copy of the laptop's data must leave out `webauthn_credentials`
and `auth_sessions`, or it will overwrite the tailnet passkey with the unusable `localhost` one:

```bash
pg_dump -Fc -d b8_finance \
  --exclude-table-data=webauthn_credentials --exclude-table-data=auth_sessions -f b8.dump
```

The original guidance, kept for a fresh install:

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

## Cutover — done 2026-09-17

The home server is the source of truth. What was done, in this order, so there was never a morning
with two emails or none:

1. The laptop's daily job was DISABLED (`launchctl disable`, which persists across reboots) and
   its `ALERTS_ENABLED` emptied. Nothing on the laptop writes on a schedule any more.
2. A final verified backup on the laptop, then a dump with the passkey and session DATA excluded.
3. Restored on the server into a NEW database, `b8_finance_new`, with the server's own tailnet
   passkey and sessions copied in, and every count compared against the laptop.
4. Swapped: connections refused, the live database renamed to `b8_finance_pre_cutover` and kept,
   the new one renamed into place. Nothing was dropped.
5. Mail and the daily job enabled on the server. The morning run — backup, sync, snapshot, digest —
   runs as `com.b8.daily`, a system daemon, at 06:00.

**The laptop's database is now stale.** Use `https://<machine>.ts.net` on the laptop too. The laptop's
copy is kept as a fallback, not a second place to file transactions.

**To roll back:** re-enable the laptop's job and alerts, and on the server rename the databases back.

---

## Tokens for a script or a phone — `npm run tokens`

The app answers a `Authorization: Bearer <token>` header as well as a browser cookie. Two kinds,
both rows in the same `auth_sessions` table:

- **A device session** is what the phone app will get from the passkey ceremony it already uses.
  Nothing to mint by hand — it arrives in the sign-in response, lasts 30 days, and every use pushes
  that out, so an app in daily use never signs itself out. A BROWSER can never be given one.
- **A personal token** is for a script of your own. It is minted here on the server, over SSH, and
  there is no HTTP endpoint that mints one — a credential that a request can create is a credential
  a stolen request can create.

> **P1-10a moved the tree (2026-09-21).** The repo is now an npm workspace: the Next app lives at
> `apps/web`, the shared schemas at `packages/contracts`, and `migrations/` and `db/` stay at the
> root. Three consequences for this machine, all of which must happen in the same deploy:
>
> 1. **`.env.local` moves to `apps/web/.env.local`.** Next loads it from the app root, and so do
>    `npm run tokens`, `npm run backup` and the daily job. Move it before restarting anything, or
>    every one of them starts without a database URL.
> 2. **The standalone output nests.** `outputFileTracingRoot` is the repo root, so the entry point
>    is now `apps/web/.next/standalone/apps/web/server.js` with `node_modules` hoisted beside it at
>    `apps/web/.next/standalone/node_modules`. `ops/server/start-web.sh` already reflects this and
>    the plists need no change — they call the script, not the path.
> 3. **Root commands still work unchanged.** `npm run build`, `npm test`, `npm run tokens -- ...`
>    all delegate to the right workspace from `~/b8`, argument passthrough included (verified).
>    `npm ci` at the root installs all three packages.
>
> **DONE 2026-09-21, and it took the app down for two minutes.** This list was written from reading
> the code and it was INCOMPLETE. Two defects, both in paths, neither findable without deploying:
>
> - **`npm run migrate:up` still passed `--envPath .env.local`.** Every local test had supplied
>   `DATABASE_URL` explicitly and bypassed the flag, so the move was never exercised. Fixed to
>   `--envPath apps/web/.env.local`.
> - **`ops/server/start-web.sh` still passed `--env-file="$APP/.env.local"`** on its last line. The
>   standalone path two lines above HAD been updated; its twin was missed in the same file. launchd
>   restarted the service every ten seconds and node exited each time with `.env.local: not found`.
>
> **The check that would have caught both in five seconds, and was not run:**
>
> ```sh
> grep -rn '\.env\.local' ops/ package.json apps/*/package.json
> ```
>
> Run that after any change to where configuration lives. A path is not covered by a typecheck, a
> test suite, or a careful reading of the file you are editing.

```bash
ssh -i ~/.ssh/b8_server aanpilogov@<server>
export PATH=$HOME/opt/node/bin:$HOME/opt/pg16/bin:$PATH
cd ~/b8

npm run tokens -- create "eval runner" --read --days 30   # --read is optional; default is full
npm run tokens -- list                                     # id, kind, scope, label, last use, expiry
npm run tokens -- revoke <id>                              # the short id from create or list
```

**The token is printed once and never again** — only its hash is stored, so `list` cannot show it
and neither can anybody who reads the database. Lost it, mint another and revoke the old one.

`--read` is worth using for anything that only reads: a read token may GET anything and POST only
`/api/v1/chat`, and every write comes back 403 `INSUFFICIENT_SCOPE`. It also cannot enrol a passkey
— a read-only credential that could enrol would not be read-only, and neither can a full personal
token, because the passkey would outlive revoking the token that made it. Enrolling is for the
browser you are signed in to and for the phone.

Use it against the tailnet name, not the LAN address:

```bash
curl -s -H "Authorization: Bearer $TOKEN" https://<machine>.ts.net/api/v1/overview
```

---

## Deploying a change — `com.b8.deploy`

The server polls `origin/main` every two minutes and deploys what it finds. **Pushing is the
deploy**; there is nothing to run.

```
git push          # ...and within two minutes the server is on it
tail -f ~/b8-logs/deploy.log     # on the server, to watch a deploy happen
```

Each pass: `git fetch`, and exit if the commit has not moved. Otherwise reset to it, `npm ci` only
if the lockfile changed, build, migrate, restart, then poll `/login` for a 200. **If no 200 arrives
within 45 seconds it resets to the commit that was serving, rebuilds and restarts it**, and logs
which commit was bad.

Build before migrate, so a commit that does not compile never reaches the database. Migrate before
restart, so the new code never starts against the old schema.

**The app returns 500 for the duration of the build**, roughly twenty seconds, not just across the
restart: `npm run build` writes into `.next` while the standalone server is serving out of it.
Building to a side directory and renaming it in does not fix this — Next bakes the directory's name
into the standalone output, so the server would then look for its static assets under the old name
and every chunk would 404. The real fix is to run the app from a copy of the standalone tree, which
is a change to `start-web.sh` too. Until then: push when you are not reading the app.

### Why it pulls rather than being pushed to

Three constraints, and together they leave one answer.

- **The runners cannot reach this machine.** It is behind NAT and published only inside the tailnet
  — `tailscale serve status` says "tailnet only", Funnel is off, and step 6 above keeps it that way
  on purpose.
- **The build has to happen here.** Darwin x86_64, resolving `sharp-darwin-x64`; GitHub has retired
  its x86_64 macOS runners, so no hosted runner can produce a `.next` this machine can load.
- **The machine sleeps.** A push-based deploy fails whenever the lid is down. A pull catches up on
  wake, unattended.

It needs no credential and opens no port: the repo is public, so `git fetch` is unauthenticated,
and nothing here adds a secret to GitHub or a listener to this machine.

### The tree is a git clone now

`~/b8` has a `.git` and is reset `--hard` on every deploy, so the only honest answer to "what is
running" is a commit. Untracked files are never touched — `.env.local`, `apps/backups/` and
`node_modules/` all survive, which is why it is a reset and never a `clean`.

`ops/deploy.sh` (rsync from a laptop) still exists for the two cases this cannot serve: trying
something uncommitted, and rescuing a machine whose `.git` has gone wrong. Anything sent that way
that is not committed is overwritten within two minutes.

### If a deploy fails

`~/b8-logs/deploy.log` names the commit and the step. A rolled-back deploy leaves the previous
commit serving and says so; the fix is another commit, not another deploy.

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
