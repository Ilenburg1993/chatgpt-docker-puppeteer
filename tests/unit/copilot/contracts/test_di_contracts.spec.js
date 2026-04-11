// @ts-check
/**
 * tests/unit/copilot/contracts/test_di_contracts.spec.js
 *
 * FK-7 — Contract tests — DI container exports e tokens.
 *
 * Garante que:
 * 1. O barrel core/index.js exporta createContainer, createToken, container
 * 2. Todos os tokens DI canônicos estão exportados
 * 3. Cada token tem nome e _id symbol
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import * as core from '../../../../src/copilot/core/index.js';

// ─── K-7a: DI container exports ──────────────────────────────────────────────

describe('FK-7 — core barrel DI exports', () => {
    it('exporta createContainer', () => {
        assert.equal(typeof core.createContainer, 'function');
    });

    it('exporta createToken', () => {
        assert.equal(typeof core.createToken, 'function');
    });

    it('exporta container singleton', () => {
        assert.ok(core.container);
        assert.equal(typeof core.container.register, 'function');
        assert.equal(typeof core.container.resolve, 'function');
        assert.equal(typeof core.container.has, 'function');
        assert.equal(typeof core.container.fork, 'function');
        assert.equal(typeof core.container.dispose, 'function');
        assert.equal(typeof core.container.tokens, 'function');
    });

    it('exporta EventBus e createEventBus', () => {
        assert.equal(typeof core.EventBus, 'function');
        assert.equal(typeof core.createEventBus, 'function');
    });
});

// ─── K-7b: DI token exports ─────────────────────────────────────────────────

const EXPECTED_TOKENS = [
    'SHUTDOWN_LOGGER',
    'DB_LOGGER',
    'SDK_LOGGER',
    'TOOLS_BUILDER',
    'AUDIT_LOGGER',
    'AUDIT_BUS',
    'BRIDGE_AGENT',
    'FALLBACK_AGENT',
    'HUB',
    'PERMISSION_AGENT',
    'SESSION_RPC',
    'NERV_BRIDGE_AGENT',
    'EVENT_BUS',
];

describe('FK-7 — DI tokens canônicos', () => {
    for (const tokenName of EXPECTED_TOKENS) {
        it(`exporta token ${tokenName} com nome e _id`, () => {
            const token = core[tokenName];
            assert.ok(token, `Token ${tokenName} não encontrado no barrel core`);
            assert.equal(token.name, tokenName);
            assert.equal(typeof token._id, 'symbol');
        });
    }

    it('todos tokens são distintos (sem colisão de _id)', () => {
        const ids = new Set(EXPECTED_TOKENS.map((n) => core[n]._id));
        assert.equal(ids.size, EXPECTED_TOKENS.length);
    });
});
