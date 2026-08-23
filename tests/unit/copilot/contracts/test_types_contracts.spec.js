// @ts-check
import { EVENT_NAMES as DirectEventNames, EVENT_NAMESPACES as DirectNamespaces } from '#copilot/events';
import { EVENT_NAMES, EVENT_NAMESPACES } from '#copilot/types';
import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

describe('types/ light event contracts', () => {
    it('projects the event-name SSOT without runtime EventBus authority', async () => {
        assert.strictEqual(DirectEventNames, EVENT_NAMES);
        assert.strictEqual(DirectNamespaces, EVENT_NAMESPACES);
        const types = /** @type {Record<string, unknown>} */ (await import('#copilot/types'));
        for (const forbidden of [
            'EventBus',
            'createEventBus',
            'container',
            'createContainer',
            'createToken',
            'EVENT_BUS',
        ]) {
            assert.equal(types[forbidden], undefined, forbidden);
        }
    });

    it('keeps namespace groups and event names structurally valid', () => {
        for (const ns of ['HOOK', 'SESSION', 'TOOL', 'SDK', 'AGENT', 'API', 'TERMINAL', 'AUDIT']) {
            assert.ok(/** @type {Record<string, unknown>} */ (EVENT_NAMESPACES)[ns], ns);
        }
        for (const [group, events] of Object.entries(EVENT_NAMES)) {
            for (const value of Object.values(events)) {
                assert.match(String(value), /^[a-z]+:[a-z_]+$/, `${group}:${value}`);
            }
        }
    });
});
