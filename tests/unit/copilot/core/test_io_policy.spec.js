// @ts-check

import { describe, expect, it } from 'vitest';
import {
    evaluateIoUrlPolicy,
    IO_URL_MAX_REDIRECTS,
    resolveIoAdvisoryLimits,
    sanitizeIoTextOutput,
} from '../../../../src/copilot/core/io-policy.js';

describe('core/io-policy pure kernel', () => {
    it('accepts public https URL and rejects localhost/private URLs by default', () => {
        const allowed = evaluateIoUrlPolicy({ input: 'https://example.com/docs' });
        expect(allowed.ok).toBe(true);
        if (allowed.ok) expect(allowed.url?.hostname).toBe('example.com');

        expect(evaluateIoUrlPolicy({ input: 'http://127.0.0.1:3000' })).toMatchObject({
            ok: false,
            code: 'URL_BLOCKED',
        });
        expect(evaluateIoUrlPolicy({ input: 'http://192.168.1.1/admin' })).toMatchObject({
            ok: false,
            code: 'URL_BLOCKED',
        });
    });

    it('bounds redirect metadata without forcing redirect execution', () => {
        expect(IO_URL_MAX_REDIRECTS).toBeGreaterThan(0);
        const defaults = evaluateIoUrlPolicy({ input: 'https://example.com/page' });
        const custom = evaluateIoUrlPolicy({ input: 'https://example.com/page', maxRedirects: 2 });
        const disabled = evaluateIoUrlPolicy({ input: 'https://example.com/page', maxRedirects: 0 });
        expect(defaults.ok && defaults.maxRedirects).toBe(IO_URL_MAX_REDIRECTS);
        expect(custom.ok && custom.maxRedirects).toBe(2);
        expect(disabled.ok && disabled.maxRedirects).toBe(0);
    });

    it('keeps advisory IO limits explicitly non-blocking and caller-overridable', () => {
        const read = resolveIoAdvisoryLimits({ operation: 'read' });
        expect(read).toMatchObject({ operation: 'read', advisory: true });
        expect(read.maxBytes).toBeGreaterThan(0);
        expect(read.maxLines).toBeGreaterThan(0);

        expect(resolveIoAdvisoryLimits({ operation: 'scan', maxLines: 20 })).toMatchObject({
            operation: 'scan',
            maxLines: 20,
            advisory: true,
        });
    });

    it('sanitizes sensitive textual output without filesystem authority', () => {
        const redacted = sanitizeIoTextOutput({ text: 'Authorization: Bearer abcdefghijklmnop' });
        expect(redacted.sanitized).toBe(true);
        expect(redacted.redactions).toBeGreaterThan(0);
        expect(redacted.text).toContain('Bearer [redacted]');

        expect(sanitizeIoTextOutput({ text: 'hello world' })).toMatchObject({
            text: 'hello world',
            sanitized: false,
            redactions: 0,
        });
    });
});
