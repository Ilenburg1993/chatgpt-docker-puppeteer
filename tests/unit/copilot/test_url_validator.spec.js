// @ts-check
import assert from 'node:assert/strict';
import { validateUrl, validateUrlString } from '#copilot/sdk/url-validator';

describe('url-validator', () => {
    describe('validateUrl()', () => {
        it('aceita URLs HTTPS públicas', () => {
            const result = validateUrl(new URL('https://example.com/page'));
            assert.strictEqual(result.safe, true);
            assert.strictEqual(result.reason, undefined);
        });

        it('aceita URLs HTTP públicas', () => {
            const result = validateUrl(new URL('http://example.com'));
            assert.strictEqual(result.safe, true);
        });

        it('bloqueia file: scheme', () => {
            const result = validateUrl(new URL('file:///etc/passwd'));
            assert.strictEqual(result.safe, false);
            assert.match(result.reason ?? '', /bloqueado/i);
        });

        it('bloqueia ftp: scheme', () => {
            const result = validateUrl(new URL('ftp://evil.com'));
            assert.strictEqual(result.safe, false);
        });

        it('bloqueia data: scheme', () => {
            const result = validateUrl(new URL('data:text/html,<h1>hi</h1>'));
            assert.strictEqual(result.safe, false);
        });

        it('bloqueia javascript: scheme', () => {
            const result = validateUrl(new URL('javascript:alert(1)'));
            assert.strictEqual(result.safe, false);
        });

        it('bloqueia localhost', () => {
            const result = validateUrl(new URL('http://localhost:8080'));
            assert.strictEqual(result.safe, false);
            assert.match(result.reason ?? '', /privado/i);
        });

        it('bloqueia 127.0.0.1', () => {
            const result = validateUrl(new URL('http://127.0.0.1'));
            assert.strictEqual(result.safe, false);
        });

        it('bloqueia 10.x.x.x (rede privada)', () => {
            const result = validateUrl(new URL('http://10.0.0.1'));
            assert.strictEqual(result.safe, false);
        });

        it('bloqueia 172.16-31.x.x (rede privada)', () => {
            const result = validateUrl(new URL('http://172.16.0.1'));
            assert.strictEqual(result.safe, false);
        });

        it('bloqueia 192.168.x.x (rede privada)', () => {
            const result = validateUrl(new URL('http://192.168.1.1'));
            assert.strictEqual(result.safe, false);
        });

        it('bloqueia 169.254.x.x (link-local / cloud IMDS)', () => {
            const result = validateUrl(new URL('http://169.254.169.254/metadata'));
            assert.strictEqual(result.safe, false);
        });

        it('bloqueia 0.0.0.0', () => {
            const result = validateUrl(new URL('http://0.0.0.0'));
            assert.strictEqual(result.safe, false);
        });

        it('bloqueia metadata.google.internal', () => {
            const result = validateUrl(new URL('http://metadata.google.internal'));
            assert.strictEqual(result.safe, false);
        });

        it('bloqueia IPv6 loopback ::1', () => {
            const result = validateUrl(new URL('http://[::1]'));
            assert.strictEqual(result.safe, false);
        });

        it('aceita IP público válido', () => {
            const result = validateUrl(new URL('http://8.8.8.8'));
            assert.strictEqual(result.safe, true);
        });

        it('aceita 172.32.x.x (fora do range privado)', () => {
            const result = validateUrl(new URL('http://172.32.0.1'));
            assert.strictEqual(result.safe, true);
        });
    });

    describe('validateUrlString()', () => {
        it('retorna parsed URL em resultado safe', () => {
            const result = validateUrlString('https://example.com/test');
            assert.strictEqual(result.safe, true);
            assert.ok(result.parsed instanceof URL);
            assert.strictEqual(result.parsed.hostname, 'example.com');
        });

        it('rejeita string URL inválida', () => {
            const result = validateUrlString('not-a-url');
            assert.strictEqual(result.safe, false);
            assert.match(result.reason ?? '', /inválida/i);
        });

        it('rejeita host privado via string', () => {
            const result = validateUrlString('http://localhost:3000/api');
            assert.strictEqual(result.safe, false);
        });

        it('rejeita string vazia', () => {
            const result = validateUrlString('');
            assert.strictEqual(result.safe, false);
        });
    });
});
