// @ts-check
import assert from 'node:assert/strict';
import http from 'node:http';
import { describe, it } from 'vitest';

import { httpRequest } from '../../../../src/copilot/sdk/http-request.js';
import { resolvePersistentConfigFile } from '../../../../src/copilot/sdk/persistent-paths.js';

describe('sdk/http-request hardening', () => {
    it('rejeita protocolos que não sejam http/https', async () => {
        await assert.rejects(() => httpRequest('GET', 'file:///etc/passwd'), /protocolo não suportado/);
    });

    it('rejeita URL inválida', async () => {
        await assert.rejects(() => httpRequest('GET', 'not-a-url'), /URL inválida/);
    });

    it('mantém suporte a http loopback interno', async () => {
        const server = http.createServer((_req, res) => {
            res.end('ok');
        });
        await new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(undefined)));
        try {
            const address = server.address();
            assert.ok(address && typeof address === 'object');
            const result = await httpRequest('GET', `http://127.0.0.1:${address.port}/health`);
            assert.equal(result.statusCode, 200);
            assert.equal(result.body, 'ok');
        } finally {
            await new Promise((resolve) => server.close(() => resolve(undefined)));
        }
    });

    it('rejeita resposta acima do budget e UTF-8 inválido', async () => {
        const oversized = http.createServer((_req, res) => {
            res.writeHead(200, { 'Content-Length': '10' });
            res.end('ok');
        });
        const invalid = http.createServer((_req, res) => {
            res.end(Buffer.from([0xff]));
        });
        await Promise.all([
            new Promise((resolve) => oversized.listen(0, '127.0.0.1', () => resolve(undefined))),
            new Promise((resolve) => invalid.listen(0, '127.0.0.1', () => resolve(undefined))),
        ]);
        try {
            const oversizedAddress = oversized.address();
            const invalidAddress = invalid.address();
            assert.ok(oversizedAddress && typeof oversizedAddress === 'object');
            assert.ok(invalidAddress && typeof invalidAddress === 'object');
            await assert.rejects(
                httpRequest('GET', `http://127.0.0.1:${oversizedAddress.port}/`, null, 5_000, 4),
                /excede limite de 4 bytes/u,
            );
            await assert.rejects(
                httpRequest('GET', `http://127.0.0.1:${invalidAddress.port}/`),
                /contains invalid UTF-8/u,
            );
        } finally {
            await Promise.all([
                new Promise((resolve) => oversized.close(() => resolve(undefined))),
                new Promise((resolve) => invalid.close(() => resolve(undefined))),
            ]);
        }
    });
});

describe('sdk/persistent-paths hardening', () => {
    it('resolve nomes simples dentro do workspace', () => {
        assert.match(resolvePersistentConfigFile('custom-tools.json'), /custom-tools\.json$/);
    });

    it('bloqueia path traversal e caminhos absolutos', () => {
        assert.throws(() => resolvePersistentConfigFile('../secret.json'), /name inválido/);
        assert.throws(() => resolvePersistentConfigFile('/tmp/secret.json'), /name inválido/);
        assert.throws(() => resolvePersistentConfigFile('nested/secret.json'), /name inválido/);
        assert.throws(() => resolvePersistentConfigFile('nested\\secret.json'), /name inválido/);
    });
});
