/**
 * The mail configuration, parsed and validated as a pure function of an environment object.
 *
 * It takes the environment as a PARAMETER rather than reading `process.env` itself, and that is the
 * whole reason any of these rules can be tested at all. The rules below — TLS is mandatory, a
 * missing key names itself, sending is off unless explicitly on — are exactly the ones whose only
 * other proof would be to configure a real provider and send a real message, which is the one thing
 * nothing in this repo is allowed to do.
 *
 * Nothing here constructs a transport or opens a socket. This module answers "would this
 * configuration be safe to use, and what would it be?" and stops there; `lib/breachAlert.ts` is the
 * only file in the repo that turns the answer into a connection.
 *
 * ─── The credential rule, and why it shapes every error message below ─────────────────────────
 *
 * `BUILD.md` §5.4: secrets never land in the repo, and real data never leaves into logs. A config
 * parser is where that gets broken by accident, because the natural thing to write when a
 * configuration is bad is to print the configuration. `throw new Error(\`bad config: ${...env}\`)`
 * puts an SMTP password into a structured log line, on disk, in a scrollback, and eventually in a
 * report. So no value read out of `env` is ever interpolated into a thrown message except the port
 * number, which is not a secret and is the one thing a reader needs in order to fix a port error.
 * Key NAMES are interpolated freely — a missing key has to say which key.
 */

/** The environment as this module reads it: names to values, some of them absent. */
export type MailEnv = Record<string, string | undefined>;

/**
 * A validated configuration, in the shape a transport takes.
 *
 * `secure` and `requireTLS` are both present and both meaningful, because the two ports express
 * TLS in different ways and collapsing them into one flag is how a plaintext fallback gets shipped:
 * `secure` is TLS from the first byte, `requireTLS` is "upgrade before authenticating, and fail if
 * the server will not". A 587 configuration with neither set will happily authenticate in the
 * clear if the server declines to upgrade, and nothing about that looks like an error.
 */
export interface SmtpSettings {
  host: string;
  port: number;
  /** Implicit TLS — port 465, encrypted before the first SMTP verb. */
  secure: boolean;
  /** STARTTLS is required rather than merely attempted — port 587. */
  requireTLS: boolean;
  auth: { user: string; pass: string };
  from: string;
  to: string;
}

/** The keys that must be present and non-empty for a configuration to exist at all. */
const REQUIRED = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASSWORD', 'ALERT_EMAIL_TO', 'ALERT_EMAIL_FROM'] as const;

/**
 * The two ports this app will speak on, and there is no third.
 *
 *   465 — implicit TLS: the connection is encrypted before any SMTP verb is exchanged.
 *   587 — STARTTLS, REQUIRED: the session upgrades before authenticating or it fails.
 *
 * 25 is rejected outright rather than defaulted-from, and that rejection is the point. A parser
 * that derives `secure` from the port without refusing 25 hands a working configuration to a
 * transport that will connect in the clear, putting the owner's category names and dollar figures
 * on the wire in plaintext along with the credentials used to send them. The library will not stop
 * this; nothing stops it except a rule written here.
 */
const TLS_PORTS: Record<number, { secure: boolean; requireTLS: boolean }> = {
  465: { secure: true, requireTLS: false },
  587: { secure: false, requireTLS: true },
};

/**
 * Deliberately minimal: one `@`, something either side, a dot in the domain, no whitespace.
 *
 * Not an attempt at RFC 5321 — a full address grammar here would be a second, wrong copy of a
 * standard. What this exists to catch is the shape that actually occurs, which is a key holding a
 * name, a placeholder, or an empty-ish fragment because the example file was copied and half
 * filled in. Handing that to a transport turns a configuration mistake into a connection attempt
 * and a provider-side rejection, which is a slower and much less legible way to learn the same
 * thing.
 */
const ADDRESS = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Whether this process is allowed to send at all.
 *
 * EXACTLY the string `true`. Not case-folded, not coerced, not "truthy" — and each of those is a
 * real failure rather than a hypothetical. `Boolean(env.ALERTS_ENABLED)` is `true` for the string
 * `'false'`, which means every developer checkout that copied the example file and typed the
 * obvious thing starts sending. `'TRUE'`, `'1'` and `'yes'` all read as OFF here on purpose: this
 * is the switch on the app's only outbound surface, and the failure mode of being too strict is
 * that the owner has to fix one character, while the failure mode of being too lax is a message
 * nobody decided to send.
 *
 * `.env.local.example` ships this key with an empty value (SPEC.md #75), so a fresh checkout is
 * off by construction rather than by convention.
 */
export function alertsEnabled(env: MailEnv): boolean {
  return env.ALERTS_ENABLED === 'true';
}

/**
 * A validated configuration, or a thrown error naming what is wrong without quoting what is secret.
 *
 * Total in the sense that matters: it either returns a configuration that is safe to hand to a
 * transport, or it returns nothing at all. There is no partially-valid result and no defaulting —
 * a default here would be this module inventing a value nobody configured, on the one surface where
 * the cost of a guess is a message sent to the wrong place or sent in the clear.
 */
export function smtpSettings(env: MailEnv): SmtpSettings {
  for (const key of REQUIRED) {
    const value = env[key];
    if (value === undefined || value.trim() === '') {
      // The key name, never the value: this message is going to a log.
      throw new Error(`mailConfig: ${key} is not set, and there is no default for it`);
    }
  }

  // Read after the presence loop, so the non-null assertions below are ones the loop has already
  // established rather than ones this function is hoping for.
  const host = env.SMTP_HOST!.trim();
  const user = env.SMTP_USER!.trim();
  const pass = env.SMTP_PASSWORD!;
  const from = env.ALERT_EMAIL_FROM!.trim();
  const to = env.ALERT_EMAIL_TO!.trim();

  const port = Number(env.SMTP_PORT);
  if (!Number.isInteger(port)) {
    throw new Error('mailConfig: SMTP_PORT is not a whole number');
  }

  // An explicit opt-out of certificate verification is refused rather than honoured. An unverified
  // peer is plaintext with extra steps: the session is encrypted to whoever answered, which is
  // exactly the property TLS exists to establish and the only one that matters here. Any value
  // other than `true` is rejected, so a typo cannot become a silent downgrade either.
  const verify = env.SMTP_TLS_REJECT_UNAUTHORIZED;
  if (verify !== undefined && verify !== 'true') {
    throw new Error(
      'mailConfig: SMTP_TLS_REJECT_UNAUTHORIZED must be true or unset; an unverified peer is not a TLS guarantee'
    );
  }

  const tls = TLS_PORTS[port];
  if (tls === undefined) {
    throw new Error(
      `mailConfig: SMTP_PORT ${port} is not a TLS port; only 465 (implicit TLS) and 587 (STARTTLS required) are accepted`
    );
  }

  if (!ADDRESS.test(to)) {
    throw new Error('mailConfig: ALERT_EMAIL_TO is not an address, and is not handed to a transport');
  }
  if (!ADDRESS.test(from)) {
    throw new Error('mailConfig: ALERT_EMAIL_FROM is not an address, and is not handed to a transport');
  }

  return { host, port, secure: tls.secure, requireTLS: tls.requireTLS, auth: { user, pass }, from, to };
}

/**
 * What may be written to a log line about a configuration.
 *
 * This exact string is what reaches `lib/logger.ts`, so it is built by naming three safe fields
 * rather than by serialising the object — the object holds a password, and a serialiser would ship
 * it the moment somebody logged the settings instead of the description. The addresses and the
 * SMTP user are left out as well: neither helps diagnose a delivery, and the user is one half of
 * the credential.
 */
export function describeSmtp(settings: SmtpSettings): string {
  const mode = settings.secure ? 'implicit TLS' : 'STARTTLS required';
  return `${settings.host}:${settings.port} (${mode})`;
}
