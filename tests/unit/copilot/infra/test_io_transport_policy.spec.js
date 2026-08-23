// @ts-check
import { sanitizeIoTextOutput } from '#copilot/infra/public/observability/redaction';
import { IO_POLICY_VERSION } from '#copilot/infra/public/operations/contracts';
import { evaluatePublicHttpUrlPolicy, IO_URL_MAX_REDIRECTS } from '#copilot/infra/public/platform/network';
import { describe, expect, it } from 'vitest';

describe('Infra IO transport policy', () => {
    it('uses one IO policy version across URL and output contracts', () => {
        const decision = evaluatePublicHttpUrlPolicy({ input: 'https://example.com/docs' });
        expect(decision).toMatchObject({
            ok: true,
            policyVersion: IO_POLICY_VERSION,
            maxRedirects: IO_URL_MAX_REDIRECTS,
        });
        expect(sanitizeIoTextOutput({ text: 'hello' }).policyVersion).toBe(IO_POLICY_VERSION);
    });
    it('runtime URL policy keeps redirect options effective while private overrides fail closed', () => {
        expect(evaluatePublicHttpUrlPolicy({ input: 'http://127.0.0.1' }).ok).toBe(false);
        expect(evaluatePublicHttpUrlPolicy({ input: 'https://user:pass@example.com' }).ok).toBe(false);
        const attemptedPrivateOverride = /** @type {{ok:boolean}} */ (
            Reflect.apply(evaluatePublicHttpUrlPolicy, null, [
                { input: 'http://127.0.0.1', allowPrivateNetworks: true, allowLocalhost: true },
            ])
        );
        expect(attemptedPrivateOverride.ok).toBe(false);
        expect(evaluatePublicHttpUrlPolicy({ input: 'https://example.com', maxRedirects: 0 })).toMatchObject({
            ok: true,
            maxRedirects: 0,
        });
    });
    it('output redaction covers bearer/api keys/github tokens', () => {
        const output = sanitizeIoTextOutput({
            text: 'Authorization: Bearer abcdefghijklmnop api_key=abcdefghijk ghp_abcdefghijklmnopqrstuvwxyz',
        });
        expect(output.sanitized).toBe(true);
        expect(output.redactions).toBeGreaterThan(0);
        expect(output.text).not.toContain('abcdefghijklmnop');
    });
});
