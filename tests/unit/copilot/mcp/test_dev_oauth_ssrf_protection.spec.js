// @ts-check

import { describe, expect, it } from 'vitest';

import { devOAuthTestHarness } from '../../../../src/copilot/mcp/control-plane/dev-oauth.js';

describe('dev OAuth SSRF protection', () => {
    it.each([
        '127.0.0.1',
        '10.0.0.1',
        '169.254.169.254',
        '::1',
        '::ffff:169.254.169.254',
        '::ffff:a9fe:a9fe',
        '::ffff:172.16.0.1',
        '::ffff:100.64.0.1',
        'fe90::1',
        'febf::1',
        'ff02::1',
        '2001:db8::1',
    ])('classifies non-public address %s as private', (address) => {
        expect(devOAuthTestHarness.isPrivateIpAddress(address)).toBe(true);
    });

    it.each(['8.8.8.8', '1.1.1.1', '::ffff:8.8.8.8', '2606:4700:4700::1111'])(
        'keeps public address %s eligible',
        (address) => {
            expect(devOAuthTestHarness.isPrivateIpAddress(address)).toBe(false);
        },
    );

    it('rejects literal private and IPv4-mapped metadata hosts', () => {
        expect(devOAuthTestHarness.isAllowedClientMetadataUrl('https://127.0.0.1/client.json')).toBe(false);
        expect(
            devOAuthTestHarness.isAllowedClientMetadataUrl('https://[::ffff:169.254.169.254]/client.json'),
        ).toBe(false);
    });
});
