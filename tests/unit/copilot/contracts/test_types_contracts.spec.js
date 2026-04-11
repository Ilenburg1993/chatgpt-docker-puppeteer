// @ts-check
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// ─── Barrel imports ──────────────────────────────────────────────────────────
import {
    // DI tokens (re-exported from core/di-tokens)
    SHUTDOWN_LOGGER,
    DB_LOGGER,
    SDK_LOGGER,
    TOOLS_BUILDER,
    AUDIT_LOGGER,
    AUDIT_BUS,
    BRIDGE_AGENT,
    FALLBACK_AGENT,
    HUB,
    PERMISSION_AGENT,
    SESSION_RPC,
    NERV_BRIDGE_AGENT,
    // DI utilities (re-exported from core/di)
    createContainer,
    createToken,
    container,
    // Events
    EVENT_NAMES,
    EVENT_NAMESPACES,
} from '#copilot/types';

// ─── Direct imports ──────────────────────────────────────────────────────────
import {
    EVENT_NAMES as DirectEventNames,
    EVENT_NAMESPACES as DirectNamespaces,
} from '#copilot/types/events';

// ═════════════════════════════════════════════════════════════════════════════
// Tests
// ═════════════════════════════════════════════════════════════════════════════

describe('types/ barrel — DI re-exports', () => {
    it('re-exports all 12 DI tokens', () => {
        const tokens = [
            SHUTDOWN_LOGGER, DB_LOGGER, SDK_LOGGER, TOOLS_BUILDER,
            AUDIT_LOGGER, AUDIT_BUS, BRIDGE_AGENT, FALLBACK_AGENT,
            HUB, PERMISSION_AGENT, SESSION_RPC, NERV_BRIDGE_AGENT,
        ];
        for (const token of tokens) {
            assert.ok(token, 'token should be defined');
            assert.equal(typeof token.name, 'string');
            assert.equal(typeof token._id, 'symbol');
        }
    });

    it('re-exports createContainer and createToken', () => {
        assert.equal(typeof createContainer, 'function');
        assert.equal(typeof createToken, 'function');
    });

    it('re-exports global container singleton', () => {
        assert.ok(container);
        assert.equal(typeof container.register, 'function');
        assert.equal(typeof container.resolve, 'function');
    });
});

describe('types/ barrel — event exports', () => {
    it('EVENT_NAMESPACES has all 8 namespaces', () => {
        const expected = ['HOOK', 'SESSION', 'TOOL', 'SDK', 'AGENT', 'API', 'TERMINAL', 'AUDIT'];
        for (const ns of expected) {
            assert.ok(EVENT_NAMESPACES[ns], `missing namespace: ${ns}`);
        }
    });

    it('EVENT_NAMES has all namespace groups', () => {
        const groups = ['hook', 'session', 'tool', 'sdk', 'agent', 'api', 'terminal', 'audit'];
        for (const g of groups) {
            assert.ok(EVENT_NAMES[g], `missing event group: ${g}`);
        }
    });

    it('all event names follow namespace:action pattern', () => {
        for (const [group, events] of Object.entries(EVENT_NAMES)) {
            for (const [, value] of Object.entries(events)) {
                assert.match(String(value), /^[a-z]+:[a-z_]+$/,
                    `event "${value}" in group "${group}" does not match pattern`);
            }
        }
    });
});

describe('types/ direct imports', () => {
    it('#copilot/types/events resolves correctly', () => {
        assert.strictEqual(DirectEventNames, EVENT_NAMES);
        assert.strictEqual(DirectNamespaces, EVENT_NAMESPACES);
    });
});
