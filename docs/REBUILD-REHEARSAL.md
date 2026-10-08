# Rebuild rehearsal — the server is gone, now what

The plan for ROADMAP's "[P1] Rehearse a full rebuild onto replacement hardware". The server runs to
failure by decision (2026-09-25), which makes the rebuild path the whole of the mitigation — and it
has never been run. The data half is proven: a dump decrypted with the password-manager key alone and
restored with matching row counts. **Everything around the data is not.**

**The deliverable is the list of gaps, plus one number: how long it took.** A second working server is
not the goal and is torn down at the end.

---

## The premise

Both machines in the flat are gone — the server *and* the laptop. What survives:

- the password manager,
- the phone (passkeys, authenticator app, Tailscale),
- the public GitHub repo,
- the B2 bucket.

The rehearsal runs on the laptop, because that is the hardware available, but it must not *use*
anything the premise says is lost. If a step only works because the laptop still has something, that
is a gap: write it down, then use it and carry on.

**Off-limits during the rehearsal:** `~/.config/b8/backup-key.txt`, `~/.config/rclone/rclone.conf`,
`~/b8-backups/`, the laptop's checkout and its `.env.local`, SSH to the server, and the server itself.

---

## Ground rules — the rehearsal must not touch real things

A restored `.env.local` holds working production credentials, and a restored database holds live
Plaid access tokens. Started as-is, the rehearsal copy is a second production instance. It would sync
the banks, send the morning digest, and push to the phone. Four overrides prevent that, and they are
applied **before the app first starts**, not after:

| Variable | Rehearsal value | Stops |
|---|---|---|
| `SCHEDULER_IN_PROCESS` | `false` | The in-process daily job. **It defaults to ON** (`lib/scheduler.ts`), and the compose path has no OS timer to defer to |
| `PLAID_SECRET` | empty | Any sync, from the scheduler or a click |
| `ALERTS_ENABLED`, `SMTP_PASSWORD` | empty | The digest and alert mail |
| `VAPID_PRIVATE_KEY` | empty | Web push to the registered phone |

Also:

- **The live server is read-only to this exercise.** The one permitted contact is a read-only row
  count to compare against (step 7), and it is optional.
- **Plaintext real data lands on the laptop's disk** in steps 3–6: a decrypted dump and a `.env`.
  Keep both in one directory outside `~/Documents` (iCloud syncs that, see DEPLOY.md), and delete the
  directory in step 11.

---

## Before the rehearsal — owner, about 30 minutes

**1. Check the password manager holds everything on this list.** Each missing row is a gap found
cheaply, before the clock starts.

| Item | Why | Known state |
|---|---|---|
| age private key | Decrypts every backup | ✅ rehearsed 2026-09-25 |
| Backblaze account login (+ how its 2FA is satisfied) | Only route to the bucket once the laptop's rclone key is gone | ✅ in the password manager (confirmed 2026-10-08). The second factor is a code sent by email, so the route to the bucket also depends on reaching that mailbox from the phone. Step 1 tests it |
| Tailscale account login | Admitting a new node; removing the dead one | ? |
| The server's MagicDNS name | Passkeys are bound to it (see 2) | ✅ captured 2026-10-08. Kept out of the repo deliberately, because the repo is public |
| Plaid dashboard login | Re-linking, if restored access tokens turn out not to work | ? |
| A full-scope personal token | Data access without a browser (see 3) | ✅ minted 2026-10-08, with a one-year expiry. Rotate it before it lapses |

**2. Decide on hostname reuse, because the passkeys hinge on it.** WebAuthn credentials restore from
the dump bound to the old hostname's RP ID. A replacement that keeps the **same** MagicDNS name keeps
every passkey working. Remove the dead node in the Tailscale admin console first, or the new one is
suffixed `-1`. A different name makes every restored passkey fail.

The rehearsal **cannot** reuse the name: the live server still holds it. So it takes a different name
and deliberately walks the failure path. That is the more useful half to rehearse anyway.

**3. Mint the break-glass token, and know what it does NOT do.** The roadmap item proposes it as "a
sign-in path that does not depend on passkeys". It is less than that:

- It **does** give full API access by bearer header, regardless of hostname, because `auth_sessions`
  restores from the dump.
- It **cannot enrol a passkey.** `sessionMayEnrol` in `lib/registrationGate.ts` admits only `browser`
  and `device` sessions, deliberately, so a token cannot outlive its own revocation. **It does not get
  you back into the web UI.**

The real way back into the UI is the database. Remove the restored `webauthn_credentials` rows, which
reopens the bootstrap window, and register from the phone straight away. Step 8 rehearses exactly
that.

Mint it on the server with an expiry long enough to matter:
`npm run tokens -- create "break-glass" --days 365`. Store it in the password manager, and put
"rotate the break-glass token" on the calendar for its expiry date.

---

## The rehearsal

Write the clock time at the start of each step. The total, from step 1 to a signed-in dashboard, is
the recovery-time number this exercise exists to produce.

**Target: Docker Compose on the laptop.** That is the path a mini-PC replacement would actually take:
the withdrawn hardware item named a mini-PC, and compose is the documented path that runs on one. The
server's native-macOS setup, with tarballs in `~/opt`, `tailscaled` built from source, and launchd
daemons, only matters if the replacement is another Mac. If it is, rehearse that path separately; it
has more gaps, not fewer.

1. **Get the backups.** Sign in to Backblaze **in a browser**, using only the password manager.
   Download the newest `b8_*.dump.age` and `b8_env_*.env.age`. *Record:* did sign-in need anything
   that is not in the premise?
2. **Get the code.** `git clone https://github.com/aianitro/b8.git` into the rehearsal directory.
   `main` is correct even if it is ahead of the dump: migrations are forward-only, and step 6 applies
   whatever the dump is missing. *Record:* which commit was the dead server running? That answer is in
   `~/b8-logs/deploy.log` on the dead machine, so expect "unknown".
3. **Decrypt.** Save the age key from the password manager into the rehearsal directory, then:
   ```
   age -d -i key.txt -o b8.dump  <dump>.dump.age
   age -d -i key.txt -o env.txt  <env>.env.age
   ```
4. **Write the rehearsal `.env.local`** from `env.txt`. Apply the four ground-rule overrides, then set
   `B8_TAILNET_HOSTNAME` to the laptop's MagicDNS name and `POSTGRES_PASSWORD` to a fresh value
   (`openssl rand -base64 24`). *Expected gap, to confirm:* `docker-compose.yml` still reads
   `env_file: .env.local` at the **repo root**, while P1-10a moved the file to `apps/web/.env.local`.
   Note which location compose and the app each actually read.
5. **Database.** Start Docker Desktop, then `docker compose up -d db`. Copy the dump in and
   `pg_restore --no-owner -d b8_finance` (DEPLOY.md step 3 has the commands). *Record:* any error, and
   whether the `vector` extension came with the image.
6. **App.** `docker compose up -d migrate app`. Confirm the log line
   `in-process scheduler disabled` before anything else. If it is missing, **stop the app at once**,
   because the ground rules did not take.
7. **Prove the data.** Count rows in `transactions`, `accounts`, `budget_categories`,
   `account_valuations` and `net_worth_snapshots`, and compare them against a read-only count on the
   live server. *Expected gap:* under the real premise there is nothing to compare against. The
   backup's own `restore rehearsed` log line carries these counts, but that log lived on the dead
   machine. Then make the host-guard check from DEPLOY.md's table: the tailnet name and `localhost`
   get 200, any other `Host:` gets 403.
8. **Get back in.** Run `tailscale serve` on the laptop, pointing at `127.0.0.1:3000` (the HTTPS
   requirement is in DEPLOY.md step 6).
   - Open the tailnet URL on the phone. **Expect sign-in to fail**, and record exactly how: the message
     shown and the server log line. On a real migration day this is the moment of "it's broken", so
     the symptom is worth being able to recognise.
   - Recover through the database. Export `webauthn_credentials` and the `browser`/`device` rows of
     `auth_sessions` to a file, delete them, and **leave the `personal` rows**, so the break-glass
     token survives. Then register a passkey from the phone at once. Anyone on the tailnet who reaches
     the page first gets the bootstrap slot, and on this tailnet that is only you.
   - Check the break-glass token too: `curl -H "Authorization: Bearer …" https://<laptop>.ts.net/api/v1/overview`.
9. **Prove the app.** Check that the dashboard renders and that its headline matches what the live
   server showed on the dump's date. Check that `/net-worth` and a property page load. Then run
   `npm run backup` inside the app container: on a real replacement, the backup chain is the first
   thing that must work again. *Expected gap, to confirm:* the compose path has **no scheduled backup,
   daily job or deploy poller**. On the server those are launchd's job (`ops/server/*.plist`), and
   nothing in compose replaces them.
10. **Stop the clock.**
11. **Tear down — and check it.**
    - `docker compose down -v` to remove the volume and the database with it.
    - `tailscale serve reset` on the laptop.
    - Delete the rehearsal directory: dump, env, key file and clone.
    - Delete the rehearsal passkey from the phone's password manager. It is bound to the laptop's
      hostname and would otherwise sit there looking real.
    - Check no `b8.dump` or `env.txt` survives anywhere: `find ~ -name 'b8.dump' -o -name 'env.txt'`.

---

## After — write it down while it is fresh

- **The time** from step 1 to step 10, and which step took longest.
- **Every gap**, one line each, written into the ROADMAP item as its result, with each one marked
  *fixed now*, *scheduled*, or *accepted*. Things already expected:
  - the compose `env_file` path (step 4);
  - no scheduler, backup or deploy in the compose path (step 9);
  - the running commit is unknowable (step 2);
  - outside every backup: the Postgres role and cluster settings, the Tailscale node identity and its
    `serve` config, the toolchain in `~/opt`, the SSH key to the server;
  - the laptop's hourly backup pull (`ops/laptop/pull-backups.sh`) defaults to the old server's
    tailnet address, so after a migration the laptop and offsite copies stop being added to until it
    is re-pointed (its fallen-behind alarm should fire, and that is worth confirming too).
- **Update DEPLOY.md** wherever a command in it was wrong, as this document did for the outage claim.
- **Re-run it** after any change to auth, backup, the compose file or the server layout, and at least
  once a year. Like the backup that restores itself, it is evidence only for the day it ran.
