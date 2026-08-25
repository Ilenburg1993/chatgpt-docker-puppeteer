// @ts-check
/** Generation-local DPoP replay/nonce state for the built-in development OAuth issuer. */

import { readDevOAuthProcessConfig, readMcpAuthConfig } from '#copilot/mcp/public/auth';
import { createDevOAuthDpopRuntime } from '#copilot/testing/mcp/auth';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

/** @returns {(replayKey:string, expiresAtMs:number)=>{available:boolean;replay:boolean}} */
function createMemoryReplay() {
    const entries = new Set();
    return (replayKey) => {
        const replay = entries.has(replayKey);
        entries.add(replayKey);
        return { available: true, replay };
    };
}

/** @param {string} proof */
function dpopRequest(proof) {
    return /** @type {import('node:http').IncomingMessage} */ ({
        method: 'POST',
        headers: { dpop: proof },
    });
}

/**
 * @param {{ privateKey: CryptoKey; publicJwk: Record<string, unknown>; resource: string; jti: string; nonce?: string }} options
 */
async function signDpopProof(options) {
    const now = Math.floor(Date.now() / 1000);
    return new SignJWT({
        htm: 'POST',
        htu: `${options.resource}/oauth/token`,
        ...(options.nonce ? { nonce: options.nonce } : {}),
    })
        .setProtectedHeader({ alg: 'ES256', typ: 'dpop+jwt', jwk: options.publicJwk })
        .setIssuedAt(now)
        .setExpirationTime(now + 120)
        .setJti(options.jti)
        .sign(options.privateKey);
}

describe('Dev OAuth DPoP runtime generation ownership', () => {
    it('keeps nonce and in-memory replay state isolated across concurrent runtime instances', async () => {
        const authConfig = readMcpAuthConfig({
            COPILOT_MCP_AUTH_MODE: 'oauth',
            COPILOT_MCP_PUBLIC_URL: 'https://mcp.example.test/mcp',
        });
        const issuerConfig = readDevOAuthProcessConfig({
            COPILOT_MCP_DEV_OAUTH_REQUIRE_DPOP_NONCE: 'true',
        });
        const keyPair = await generateKeyPair('ES256');
        const publicJwk = /** @type {Record<string, unknown>} */ (await exportJWK(keyPair.publicKey));
        const runtimeA = createDevOAuthDpopRuntime({ rememberReplay: createMemoryReplay() });
        const runtimeB = createDevOAuthDpopRuntime({ rememberReplay: createMemoryReplay() });

        const nonceA = runtimeA.issueNonce();
        const proofA = await signDpopProof({
            privateKey: keyPair.privateKey,
            publicJwk,
            resource: authConfig.resource,
            jti: 'generation-a-proof',
            nonce: nonceA,
        });
        const acceptedA = await runtimeA.resolveBindingForRequest(dpopRequest(proofA), authConfig, issuerConfig);
        assert.equal(acceptedA.ok, true);
        assert.deepEqual(runtimeA.state(), { replayEntries: 1, nonceEntries: 1 });
        assert.deepEqual(runtimeB.state(), { replayEntries: 0, nonceEntries: 0 });

        const rejectedByB = await runtimeB.resolveBindingForRequest(dpopRequest(proofA), authConfig, issuerConfig);
        assert.equal(rejectedByB.ok, false);
        if (rejectedByB.ok) assert.fail('runtime B unexpectedly accepted runtime A nonce');
        assert.equal(rejectedByB.errorCode, 'use_dpop_nonce');
        assert.deepEqual(runtimeB.state(), { replayEntries: 0, nonceEntries: 0 });

        const replayedA = await runtimeA.resolveBindingForRequest(dpopRequest(proofA), authConfig, issuerConfig);
        assert.equal(replayedA.ok, false);
        if (replayedA.ok) assert.fail('runtime A unexpectedly accepted an in-memory replay');
        assert.equal(replayedA.error, 'DPoP proof replay detected.');

        const nonceB = runtimeB.issueNonce();
        const proofB = await signDpopProof({
            privateKey: keyPair.privateKey,
            publicJwk,
            resource: authConfig.resource,
            jti: 'generation-b-proof',
            nonce: nonceB,
        });
        const acceptedB = await runtimeB.resolveBindingForRequest(dpopRequest(proofB), authConfig, issuerConfig);
        assert.equal(acceptedB.ok, true);
        assert.deepEqual(runtimeB.state(), { replayEntries: 1, nonceEntries: 1 });

        runtimeA.reset();
        assert.deepEqual(runtimeA.state(), { replayEntries: 0, nonceEntries: 0 });
        assert.deepEqual(runtimeB.state(), { replayEntries: 1, nonceEntries: 1 });
    });

    it('fails closed before populating local replay state when persistent replay protection is unavailable', async () => {
        const authConfig = readMcpAuthConfig({
            COPILOT_MCP_AUTH_MODE: 'oauth',
            COPILOT_MCP_PUBLIC_URL: 'https://mcp.example.test/mcp',
        });
        const issuerConfig = readDevOAuthProcessConfig({
            COPILOT_MCP_DEV_OAUTH_REQUIRE_DPOP_NONCE: 'false',
        });
        const keyPair = await generateKeyPair('ES256');
        const publicJwk = /** @type {Record<string, unknown>} */ (await exportJWK(keyPair.publicKey));
        const runtime = createDevOAuthDpopRuntime({
            rememberReplay: () => ({ available: false, replay: false }),
        });
        const proof = await signDpopProof({
            privateKey: keyPair.privateKey,
            publicJwk,
            resource: authConfig.resource,
            jti: 'persistent-replay-unavailable',
        });

        const result = await runtime.resolveBindingForRequest(dpopRequest(proof), authConfig, issuerConfig);
        assert.equal(result.ok, false);
        if (result.ok) assert.fail('DPoP unexpectedly succeeded without persistent replay protection');
        assert.equal(result.error, 'Persistent DPoP replay protection is unavailable.');
        assert.deepEqual(runtime.state(), { replayEntries: 0, nonceEntries: 0 });
    });
});
