// P8-42d — the screenshot UI by source scan (U11–U13): the capture path, the form's wording and
// gating, and the "Needs a screenshot" section. No browser or jsdom here (SPEC.md T17); what the
// components render over real HTTP is the surface script's H16.
//
// Each check reads the component's own text, so it pins what the person sees and which condition
// shows it, not how the markup happens to be nested.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const WEB = fileURLToPath(new URL('../', import.meta.url));
const read = (f: string) => readFileSync(join(WEB, f), 'utf8');
const occurrences = (text: string, s: string) => text.split(s).length - 1;

const CAPTURE = 'components/LoyaltyScreenshotCapture.tsx';
const DUE = 'components/LoyaltyScreenshotDue.tsx';
const CLIENT = 'lib/loyaltyScreenshotClient.ts';

describe('the screenshot UI (P8-42d)', () => {
  it('T42d-U11: the capture path shrinks with the receipt encoder, sends one JPEG Blob to the membership\'s route, and keeps nothing', () => {
    const capture = read(CAPTURE);
    const client = read(CLIENT);
    const both = `${capture}\n${client}`;
    expect(both).toMatch(/import \{[^}]*\bshrinkReceipt\b[^}]*\} from '@\/lib\/receiptUpload'/);
    expect(client).toMatch(/await shrinkReceipt\(file\)/);
    expect(client).toMatch(/`\/api\/v1\/loyalty\/memberships\/\$\{membershipId\}\/screenshot`/);
    expect(client).toMatch(/method: 'POST', headers: \{ 'Content-Type': 'image\/jpeg' \}, body: image \}/);
    for (const banned of ['FormData', 'localStorage', 'sessionStorage', 'indexedDB', 'caches.', 'createImageBitmap', 'toBlob', 'getContext(', 'URL.createObjectURL']) {
      expect(both.includes(banned), banned).toBe(false);
    }
    // The file input is made inside the tap's handler, every tap; never a kept ref or a rendered input.
    expect(capture).toMatch(/function pick\(\) \{\s*const input = document\.createElement\('input'\);/);
    expect(capture).not.toMatch(/useRef|type="file"/);
    // No state holds an image: only the server's answer about it.
    expect(capture).not.toMatch(/useState<(Blob|File)/);
    expect(capture).not.toMatch(/set\w*\((file|image|blob)\)/i);
    expect(capture).toMatch(/import \{ readScreenshot, screenshotConfirmPath \} from '@\/lib\/loyaltyScreenshotClient'/);
    // Every membership line offers it.
    expect(read('components/LoyaltyMembershipLine.tsx')).toMatch(/<LoyaltyScreenshotCapture membershipId=\{m\.id\}/);
  });

  it('T42d-U12: the form\'s wording, its warnings and its one gated button', () => {
    const capture = read(CAPTURE);
    const both = `${capture}\n${read(DUE)}`;
    for (const s of [
      'Update from screenshot', 'Save balance', 'Save anyway',
      'The screenshot looks like a different program.',
      'The member number on the screenshot does not match this membership.',
      'The unit differs from the one on file.',
      'This is older than the balance on file. It will be recorded but will not replace it.',
      'Nothing could be read from that screenshot. Enter the balance by hand.',
      'Screenshot reading is not set up. Enter the balance by hand.',
      'The screenshot could not be read right now. Try again, or enter the balance by hand.',
    ]) expect(occurrences(both, s), s).toBe(1);
    // The older-than warning follows the reducer's rule, restated by screenshotStanding.
    expect(capture).toMatch(/import \{ screenshotStanding \} from '@\/lib\/domain\/loyaltyScreenshot'/);
    expect(capture).toMatch(/const standing = [^;]*screenshotStanding\(currentAsOf, asOf\)/);
    expect(capture).toMatch(/\{standing === 'recorded_only' && <p[^>]*>This is older than the balance on file\./);
    // Each warning is shown on its own mismatch, and "Save anyway" only when one of them is.
    expect(capture).toMatch(/\{read\.programCheck === 'mismatch' && <p[^>]*>The screenshot looks like a different program\./);
    expect(capture).toMatch(/\{read\.suffixCheck === 'mismatch' && <p[^>]*>The member number on the screenshot/);
    expect(capture).toMatch(/\{read\.unitCheck === 'mismatch' && <p[^>]*>The unit differs/);
    expect(capture).toMatch(/const disagrees = read\.programCheck === 'mismatch' \|\| read\.suffixCheck === 'mismatch' \|\| read\.unitCheck === 'mismatch';/);
    expect(capture).toMatch(/disagrees \? 'Save anyway' : 'Save balance'/);
    // A warning never disables the save: only saving does, so a second tap cannot write twice.
    expect(capture).toMatch(/<button type="submit" disabled=\{saving\}/);
    expect(capture).not.toMatch(/disabled=\{[^}]*(disagrees|mismatch)/);
    // A null balance is an empty field, never a zero.
    expect(capture).toMatch(/setBalance\(result\.read\.balance \?\? ''\)/);
    expect(capture).not.toMatch(/\?\?\s*'?0'?[^.\d]|\|\|\s*'?0'?[^.\d]/);
    // An absent as-of is this device's calendar day, from the shared helper.
    expect(capture).toMatch(/setAsOf\(result\.read\.asOf \?\? localIsoDate\(\)\)/);
  });

  it('T42d-U13: "Needs a screenshot" is its own section, shown only for a non-empty list, and the queue keeps its wording', () => {
    const due = read(DUE);
    expect(occurrences(due, 'Needs a screenshot')).toBe(1);
    expect(occurrences(due, 'The inbox is not bringing balances for this program.')).toBe(1);
    expect(due).toMatch(/const due = overview\.inboxRead\.screenshotDue;\s*if \(due\.length === 0\) return null;/);
    expect(due).toMatch(/<LoyaltyScreenshotCapture membershipId=\{m\.id\}/);
    expect(read('components/TravelBoard.tsx')).toMatch(/<LoyaltyScreenshotDue overview=\{overview\} \/>/);
    const panel = read('components/LoyaltyInboxReadPanel.tsx');
    expect(occurrences(panel, 'Needs attention: ')).toBe(1);
    expect(occurrences(panel, 'Nothing needs attention')).toBe(1);
    expect(panel).not.toMatch(/screenshotDue|LoyaltyScreenshotDue/);
    expect(panel).toMatch(/\{read\.needsAttentionTotal === 0 \? \(\s*<p[^>]*>Nothing needs attention<\/p>/);
  });
});
