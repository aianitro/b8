import { describe, it, expect } from 'vitest';
import { smtpSettings, alertsEnabled, describeSmtp, type MailEnv } from './mailConfig';

// `E` is a complete, valid environment, written as a literal here.
//
// IT IS NOT A CREDENTIAL. Every value is fabricated, the hosts are `.test` names reserved by RFC
// 2606 for exactly this, and the password is a string chosen to be obviously fake and to be
// greppable if it ever escaped into a message it should not be in — which is what F-M6 below
// checks. Nothing in this file reads the owner's real environment file — acceptance #43 greps every
// test in the repo for its name and expects zero hits, so it is not even named here. The real keys
// are the owner's to add, to a gitignored file, and no agent invents one.
//
// The absence in this file is as load-bearing as anything in it: nothing here constructs a
// transport, opens a socket, or contacts a host. `mailConfig` is a pure function of this object,
// which is the entire reason the TLS rules can be asserted at all.
const E: MailEnv = {
  SMTP_HOST: 'smtp.provider.test',
  SMTP_PORT: '465',
  SMTP_USER: 'alerts@provider.test',
  SMTP_PASSWORD: 'S3cret-Value-Not-Real',
  ALERT_EMAIL_TO: 'owner@example.test',
  ALERT_EMAIL_FROM: 'alerts@provider.test',
};

/** `E` with stated differences, so every fixture varies from the base in named ways only. */
function env(patch: MailEnv): MailEnv {
  return { ...E, ...patch };
}

describe('smtpSettings — TLS is mandatory, and a bad configuration is a stated failure', () => {
  it('port 465 is accepted as implicit TLS', () => {
    const settings = smtpSettings(E);

    expect(settings.secure).toBe(true);
    expect(settings.secure).not.toBe(false);
    expect(settings.port).toBe(465);
    expect(settings.host).toBe('smtp.provider.test');
  });

  it('port 587 is accepted only with STARTTLS required', () => {
    // `secure: false` alone is not a finding — 587 is a plaintext connection that UPGRADES. What
    // makes it safe is `requireTLS`, without which the session silently stays in the clear when
    // the server declines to upgrade, and authenticates anyway.
    const settings = smtpSettings(env({ SMTP_PORT: '587' }));

    expect(settings.secure).toBe(false);
    expect(settings.requireTLS).toBe(true);
    expect(settings.requireTLS).not.toBe(false);
  });

  it('port 25 is rejected, because plaintext SMTP would put these figures on the wire in clear', () => {
    const bad = env({ SMTP_PORT: '25' });

    expect(() => smtpSettings(bad)).toThrow(/25/);
    expect(() => smtpSettings(bad)).toThrow(/TLS/);
  });

  it('a configuration disabling certificate verification is rejected, since an unverified peer is plaintext with extra steps', () => {
    expect(() => smtpSettings(env({ SMTP_TLS_REJECT_UNAUTHORIZED: 'false' }))).toThrow();
  });

  it('a missing credential names the key that is missing and never substitutes a default', () => {
    const missing = env({});
    delete missing.SMTP_PASSWORD;

    expect(() => smtpSettings(missing)).toThrow(/SMTP_PASSWORD/);
    // Not a configuration carrying an empty-string password, which would reach the provider and be
    // refused there — a slower and much less legible way to learn the same thing.
    expect(() => smtpSettings(missing)).toThrow();
  });

  it('a rejection message never contains the password it was handed', () => {
    // The realistic failure: a parser that reports the environment it could not parse. It reads as
    // helpful and it writes an SMTP password into a structured log line, which is BUILD.md §5.4's
    // prohibition in its purest form. Serialising the environment into the message fails here.
    let thrown = '';
    try {
      smtpSettings(env({ SMTP_PORT: '25' }));
    } catch (err) {
      thrown = err instanceof Error ? err.message : String(err);
    }

    expect(thrown).not.toBe('');
    expect(thrown).not.toContain('S3cret-Value-Not-Real');
  });

  it('a recipient that is not an address is rejected rather than handed to the transport', () => {
    expect(() => smtpSettings(env({ ALERT_EMAIL_TO: 'not-an-address' }))).toThrow(/ALERT_EMAIL_TO/);
  });

  it('the sender is validated on the same rule as the recipient, since a malformed from has no local symptom at all', () => {
    // Added after a mutation sweep: deleting the sender check left this suite green, because the
    // fixture above only corrupts the recipient. The recipient failing is at least visible as a
    // message that never arrives; a malformed sender is refused at the provider, days later, with
    // nothing on this side to look at.
    expect(() => smtpSettings(env({ ALERT_EMAIL_FROM: 'not-an-address' }))).toThrow(/ALERT_EMAIL_FROM/);
  });
});

describe('the enable flag and the loggable description', () => {
  it('sending is disabled unless the enable flag is exactly the string true, so an unset, mistyped or merely truthy value all mean off', () => {
    expect(alertsEnabled({})).toBe(false);
    expect(alertsEnabled({ ALERTS_ENABLED: 'TRUE' })).toBe(false);
    expect(alertsEnabled({ ALERTS_ENABLED: '1' })).toBe(false);
    expect(alertsEnabled({ ALERTS_ENABLED: 'yes' })).toBe(false);
    expect(alertsEnabled({ ALERTS_ENABLED: 'true' })).toBe(true);

    // Stated as four separate refusals as well, because "off by default" is the property that
    // matters and `'false'` is a truthy string in JavaScript.
    expect(alertsEnabled({})).not.toBe(true);
    expect(alertsEnabled({ ALERTS_ENABLED: 'TRUE' })).not.toBe(true);
    expect(alertsEnabled({ ALERTS_ENABLED: '1' })).not.toBe(true);
    expect(alertsEnabled({ ALERTS_ENABLED: 'yes' })).not.toBe(true);
  });

  it('the loggable description of a mail configuration carries the host and the port and never the password', () => {
    const described = describeSmtp(smtpSettings(E));

    expect(described).toContain('smtp.provider.test');
    expect(described).toContain('465');
    expect(described).not.toContain('S3cret-Value-Not-Real');

    // The USER is left out too, and that was unpinned until a mutation sweep found that adding it
    // back kept the suite green. It is half of the credential, it helps diagnose nothing, and this
    // exact string is what reaches lib/logger.ts and therefore whatever a log ends up pasted into.
    expect(described).not.toContain('alerts@provider.test');
    expect(described).not.toContain('owner@example.test');
  });
});
