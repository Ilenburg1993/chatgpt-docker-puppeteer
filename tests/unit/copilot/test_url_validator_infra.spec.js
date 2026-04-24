// @ts-check
/**
 * tests/unit/copilot/test_url_validator_infra.spec.js
 *
 * F71.4 — Testes unitários para url-validator.js (infra).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('#copilot/config/env', () => ({
    WEBHOOK_ALLOW_PRIVATE_HOSTS: false,
    NODE_ENV: 'test',
    COPILOT_LOG_DIR: '',
    COPILOT_LLM_PROVIDER: 'openai',
    COPILOT_LLM_MODEL: 'gpt-4o',
    OPENAI_API_KEY: 'sk-test',
    COPILOT_LOG_LEVEL: 'info',
    COPILOT_SESSION_DIR: '',
    COPILOT_PORT: 3099,
    COPILOT_SHUTDOWN_TIMEOUT_MS: 5000,
    LLM_RETRY_MAX: 3,
    LLM_RETRY_BASE_MS: 1000,

    COPILOT_MCP_SERVERS: '',
    COPILOT_CUSTOM_AGENTS: '',
    COPILOT_DISABLED_AGENTS: '',
}));

vi.mock('node:dns/promises', () => ({
    default: {
        lookup: vi.fn(),
    },
}));

import dns from 'node:dns/promises';
import { checkResolvedIp, isPrivateIp, validateWebhookUrl } from '../../../src/copilot/core/security/url-validator.js';

describe('url-validator (infra)', () => {
    beforeEach(() => {
        vi.mocked(dns.lookup).mockReset();
    });

    // ── isPrivateIp ──────────────────────────────────────────────────────

    describe('isPrivateIp()', () => {
        it('detecta 127.0.0.1 como privado', () => {
            expect(isPrivateIp('127.0.0.1')).toBe(true);
        });

        it('detecta 0.0.0.0 como privado', () => {
            expect(isPrivateIp('0.0.0.0')).toBe(true);
        });

        it('detecta 10.x.x.x como privado', () => {
            expect(isPrivateIp('10.0.0.1')).toBe(true);
        });

        it('detecta 172.16.x.x como privado', () => {
            expect(isPrivateIp('172.16.0.1')).toBe(true);
        });

        it('detecta 192.168.x.x como privado', () => {
            expect(isPrivateIp('192.168.1.1')).toBe(true);
        });

        it('detecta 169.254.x.x como privado', () => {
            expect(isPrivateIp('169.254.169.254')).toBe(true);
        });

        it('detecta ::1 como privado', () => {
            expect(isPrivateIp('::1')).toBe(true);
        });

        it('detecta fe80: (link-local IPv6) como privado', () => {
            expect(isPrivateIp('fe80::1')).toBe(true);
        });

        it('detecta fc/fd (ULA IPv6) como privado', () => {
            expect(isPrivateIp('fc00::1')).toBe(true);
            expect(isPrivateIp('fd12::1')).toBe(true);
        });

        it('detecta IPv4-mapped como privado', () => {
            expect(isPrivateIp('::ffff:127.0.0.1')).toBe(true);
            expect(isPrivateIp('::ffff:192.168.1.1')).toBe(true);
            expect(isPrivateIp('::ffff:7f00:1')).toBe(true);
            expect(isPrivateIp('::ffff:a00:1')).toBe(true);
        });

        it('retorna false para IP público', () => {
            expect(isPrivateIp('8.8.8.8')).toBe(false);
            expect(isPrivateIp('93.184.216.34')).toBe(false);
        });
    });

    // ── validateWebhookUrl ───────────────────────────────────────────────

    describe('validateWebhookUrl()', () => {
        it('aceita URL HTTPS pública', () => {
            expect(() => validateWebhookUrl('https://example.com/hook')).not.toThrow();
        });

        it('aceita URL HTTP pública', () => {
            expect(() => validateWebhookUrl('http://example.com/hook')).not.toThrow();
        });

        it('rejeita URL malformada', () => {
            expect(() => validateWebhookUrl('not-a-url')).toThrow(/URL inválida/);
        });

        it('rejeita protocolo não-HTTP', () => {
            expect(() => validateWebhookUrl('ftp://example.com')).toThrow(/Protocolo não permitido/);
            expect(() => validateWebhookUrl('file:///etc/passwd')).toThrow(/Protocolo não permitido/);
        });

        it('rejeita localhost', () => {
            expect(() => validateWebhookUrl('http://localhost:8080')).toThrow(/Host privado/);
        });

        it('rejeita IPs privados (127.x, 10.x, 192.168.x)', () => {
            expect(() => validateWebhookUrl('http://127.0.0.1')).toThrow(/Host privado/);
            expect(() => validateWebhookUrl('http://10.0.0.1')).toThrow(/Host privado/);
            expect(() => validateWebhookUrl('http://192.168.1.1')).toThrow(/Host privado/);
        });

        it('rejeita hosts de metadata cloud ja cobertos pelo validator funcional', () => {
            expect(() => validateWebhookUrl('http://metadata.google.internal')).toThrow(/Host privado/);
        });

        it('permite IPs privados com allowPrivate=true', () => {
            expect(() => validateWebhookUrl('http://localhost:8080', { allowPrivate: true })).not.toThrow();
            expect(() => validateWebhookUrl('http://10.0.0.1', { allowPrivate: true })).not.toThrow();
        });
    });

    // ── checkResolvedIp ──────────────────────────────────────────────────

    describe('checkResolvedIp()', () => {
        it('permite host que resolve para IP público', async () => {
            vi.mocked(dns.lookup).mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
            await expect(checkResolvedIp('example.com')).resolves.toBeUndefined();
        });

        it('rejeita host que resolve para IP privado (DNS rebinding)', async () => {
            vi.mocked(dns.lookup).mockResolvedValue([{ address: '127.0.0.1', family: 4 }]);
            await expect(checkResolvedIp('evil.com')).rejects.toThrow(/DNS rebinding/);
        });

        it('rejeita host que resolve para 10.x.x.x', async () => {
            vi.mocked(dns.lookup).mockResolvedValue([{ address: '10.0.0.5', family: 4 }]);
            await expect(checkResolvedIp('internal.test')).rejects.toThrow(/DNS rebinding/);
        });

        it('permite IPv6 público', async () => {
            vi.mocked(dns.lookup).mockResolvedValue([{ address: '2607:f8b0:4004:800::200e', family: 6 }]);
            await expect(checkResolvedIp('v6only.test')).resolves.toBeUndefined();
        });

        it('rejeita quando qualquer registro DNS é privado', async () => {
            vi.mocked(dns.lookup).mockResolvedValue([
                { address: '93.184.216.34', family: 4 },
                { address: '::ffff:7f00:1', family: 6 },
            ]);
            await expect(checkResolvedIp('mixed.test')).rejects.toThrow(/DNS rebinding/);
        });

        it('ignora DNS failure (ambos IPv4/IPv6 falham)', async () => {
            vi.mocked(dns.lookup).mockRejectedValue(new Error('ENOTFOUND'));
            await expect(checkResolvedIp('no-dns.test')).resolves.toBeUndefined();
        });

        it('permite host privado com allowPrivate=true', async () => {
            // Não deve sequer chamar dns.lookup
            await expect(checkResolvedIp('localhost', { allowPrivate: true })).resolves.toBeUndefined();
            expect(dns.lookup).not.toHaveBeenCalled();
        });
    });
});
