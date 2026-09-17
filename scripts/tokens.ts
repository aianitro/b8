/**
 * Mint, list and revoke personal tokens — the only way they are created.
 *
 *   npm run tokens -- create "eval runner" --read --days 90
 *   npm run tokens -- list
 *   npm run tokens -- revoke 3f9a1c2b
 *
 * Run over SSH on the server. There is deliberately no web endpoint for any of this: a minting
 * endpoint would let a compromised browser session create a durable credential for itself, and SSH
 * to the server is a stronger proof of being the owner than anything the app can check.
 *
 * The token is printed ONCE and never stored anywhere readable — the database holds only its hash.
 * Lose it and mint another.
 */
import db from '../lib/db';
import { createPersonalToken, listSessions, revokeByPrefix } from '../lib/authSession';

function usage(): never {
  console.error(
    'usage:\n' +
    '  npm run tokens -- create "<label>" [--read] [--days N]\n' +
    '  npm run tokens -- list\n' +
    '  npm run tokens -- revoke <first 8+ characters of the id>'
  );
  process.exit(2);
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);

  if (command === 'create') {
    const label = rest.find((a) => !a.startsWith('--'));
    if (!label) usage();
    const read = rest.includes('--read');
    const daysArg = rest[rest.indexOf('--days') + 1];
    const days = rest.includes('--days') ? Number(daysArg) : undefined;

    const minted = await createPersonalToken({ label, scope: read ? 'read' : 'full', days });
    console.log(`\nToken for "${label}" — ${read ? 'READ-ONLY' : 'FULL ACCESS'}, expires ${minted.expiresAt}`);
    console.log(`id: ${minted.tokenHash.slice(0, 12)}\n`);
    console.log(minted.token);
    console.log('\nThis is the only time it will be shown. Use it as:  Authorization: Bearer <token>\n');
    return;
  }

  if (command === 'list') {
    const rows = await listSessions();
    if (rows.length === 0) { console.log('no live sessions'); return; }
    console.log('id            kind      scope  label                 last used            expires');
    for (const r of rows) {
      console.log(
        `${r.tokenHash.slice(0, 12)}  ${r.kind.padEnd(8)}  ${r.scope.padEnd(5)}  ` +
        `${(r.label ?? '').slice(0, 20).padEnd(20)}  ${(r.lastUsedAt ?? 'never').slice(0, 19).padEnd(19)}  ${r.expiresAt.slice(0, 19)}`
      );
    }
    return;
  }

  if (command === 'revoke') {
    const outcome = await revokeByPrefix(rest[0] ?? '');
    const message = {
      revoked: 'revoked — it stops working on its next request',
      none: 'no live session has an id starting with that',
      ambiguous: 'more than one live session matches; give more characters of the id',
      'too-short': 'give at least 8 hexadecimal characters of the id, as shown by `list`',
    }[outcome];
    console.log(message);
    if (outcome !== 'revoked') process.exitCode = 1;
    return;
  }

  usage();
}

main()
  .catch((err) => { console.error(err instanceof Error ? err.message : String(err)); process.exitCode = 1; })
  .finally(() => db.end());
