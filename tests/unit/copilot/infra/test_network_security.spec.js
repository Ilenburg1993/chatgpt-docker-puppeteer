// @ts-check
import {
    fetchPublicHttp as fetchPublicHttpWithPolicy,
    isPrivateIp,
    resolvePublicAddresses,
    validateUrl,
    validateUrlString,
} from '#copilot/infra/internal/platform/network';
import * as publicNetwork from '#copilot/infra/public/platform/network';
import assert from 'node:assert/strict';
import http from 'node:http';
import { afterEach, describe, it } from 'vitest';

const servers = /** @type {import('node:http').Server[]} */ ([]);
afterEach(async () => {
    await Promise.all(
        servers.splice(0).map((server) => new Promise((resolve) => server.close(() => resolve(undefined)))),
    );
});

describe('Infra public network security', () => {
    it('blocks local/private/reserved addresses, credentials and non-http schemes', () => {
        for (const value of [
            '127.0.0.1',
            '10.0.0.1',
            '172.16.0.1',
            '192.168.1.1',
            '169.254.169.254',
            '0.0.0.0',
            '::1',
            'fc00::1',
            'fe80::1',
            '192.0.2.1',
        ])
            assert.equal(isPrivateIp(value), true, value);
        assert.equal(isPrivateIp('8.8.8.8'), false);
        assert.equal(validateUrl(new URL('http://localhost')).safe, false);
        assert.equal(validateUrl(new URL('file:///etc/passwd')).safe, false);
        assert.equal(validateUrl(new URL('https://user:secret@example.com')).safe, false);
        assert.equal(validateUrlString('https://example.com/path').safe, true);
    });

    it('DNS is fail-closed and rejects a mixed public/private answer set', async () => {
        const failing = async () => {
            throw new Error('ENOTFOUND');
        };
        await assert.rejects(() => resolvePublicAddresses('missing.example', { resolver: failing }), /fail-closed/u);
        const mixed = async () => [
            { address: '93.184.216.34', family: 4 },
            { address: '127.0.0.1', family: 4 },
        ];
        await assert.rejects(() => resolvePublicAddresses('mixed.example', { resolver: mixed }), /não público/u);
    });

    it('socket lookup is the security boundary: private DNS cannot connect unless explicitly authorized', async () => {
        const server = http.createServer((_req, res) => {
            res.end('ok');
        });
        servers.push(server);
        await new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(undefined)));
        const address = server.address();
        assert.ok(address && typeof address === 'object');
        const resolver = async () => [{ address: '127.0.0.1', family: 4 }];
        const url = `http://public-looking.test:${address.port}/`;
        await assert.rejects(() => fetchPublicHttpWithPolicy(url, {}, { resolver }), /não público/u);
        const response = await fetchPublicHttpWithPolicy(url, {}, { resolver, allowPrivate: true });
        assert.equal(response.status, 200);
        assert.ok(response.body);
        const reader = response.body.getReader();
        const { value } = await reader.read();
        assert.equal(new TextDecoder().decode(value), 'ok');
        await reader.cancel();
    });
    it('runtime public membrane exposes no resolver/private-network policy override', async () => {
        assert.equal('resolvePublicAddresses' in publicNetwork, false);
        assert.equal('createPinnedPublicLookup' in publicNetwork, false);
        assert.equal(publicNetwork.validateUrlString('http://127.0.0.1').safe, false);
        const attemptedValidationOverride = /** @type {{safe:boolean}} */ (
            Reflect.apply(publicNetwork.validateUrlString, null, ['http://127.0.0.1', { allowPrivate: true }])
        );
        assert.equal(attemptedValidationOverride.safe, false);
        assert.throws(
            () => Reflect.apply(publicNetwork.fetchPublicHttp, null, ['http://127.0.0.1', {}, { allowPrivate: true }]),
            /privado|reservado|bloquead/iu,
        );
    });
});
