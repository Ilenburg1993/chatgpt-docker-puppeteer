// @ts-check
/**
 * tests/unit/copilot/sdk/test_sdk_constants.spec.js
 *
 * Testes para src/copilot/sdk/constants.js — verifica que todas as constantes estão exportadas, imutáveis (const
 * assertion), e coerentes com o SDK.
 */

import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Mock SDK (necessário para barrel import que carrega system-message.js)
const mocks = vi.hoisted(() => ({
    SYSTEM_MESSAGE_SECTIONS: {
        preamble: { description: 'Preamble' },
        identity: { description: 'Identity' },
        tone: { description: 'Tone' },
        tool_efficiency: { description: 'Tool efficiency' },
        environment_context: { description: 'Environment' },
        code_change_rules: { description: 'Code changes' },
        guidelines: { description: 'Guidelines' },
        safety: { description: 'Safety' },
        tool_instructions: { description: 'Tool instructions' },
        custom_instructions: { description: 'Custom instructions' },
        runtime_instructions: { description: 'Runtime instructions' },
        last_instructions: { description: 'Last instructions' },
    },
}));

vi.mock('@github/copilot-sdk', () => ({
    SYSTEM_MESSAGE_SECTIONS: mocks.SYSTEM_MESSAGE_SECTIONS,
    SYSTEM_PROMPT_SECTIONS: mocks.SYSTEM_MESSAGE_SECTIONS,
    defineTool: vi.fn(),
    approveAll: vi.fn(),
}));

import {
    CONNECTION_STATES,
    INFINITE_SESSION_DEFAULTS,
    PERMISSION_COMPLETED_KINDS,
    PERMISSION_RESULTS,
    PROVIDER_TYPES,
    REASONING_EFFORTS,
    SECTION_ACTIONS,
    SESSION_EVENTS,
    SESSION_LIFECYCLE_EVENTS,
    SESSION_MODES,
    SYSTEM_PROMPT_SECTION_NAMES,
    TOOL_RESULT_TYPES,
} from '../../../../src/copilot/sdk/constants.js';

// ─── SESSION_MODES ────────────────────────────────────────────────────────────

describe('SESSION_MODES', () => {
    it('contém os 3 modos documentados', () => {
        expect(SESSION_MODES).toEqual({
            INTERACTIVE: 'interactive',
            PLAN: 'plan',
            AUTOPILOT: 'autopilot',
        });
    });

    it('todos os valores são strings', () => {
        for (const v of Object.values(SESSION_MODES)) {
            expect(typeof v).toBe('string');
        }
    });
});

// ─── REASONING_EFFORTS ────────────────────────────────────────────────────────

describe('REASONING_EFFORTS', () => {
    it('contém os 4 níveis', () => {
        expect(REASONING_EFFORTS).toEqual({
            LOW: 'low',
            MEDIUM: 'medium',
            HIGH: 'high',
            XHIGH: 'xhigh',
        });
    });
});

// ─── CONNECTION_STATES ────────────────────────────────────────────────────────

describe('CONNECTION_STATES', () => {
    it('contém todos os estados de conexão', () => {
        expect(CONNECTION_STATES).toEqual({
            DISCONNECTED: 'disconnected',
            CONNECTING: 'connecting',
            CONNECTED: 'connected',
            ERROR: 'error',
        });
    });
});

// ─── SYSTEM_PROMPT_SECTION_NAMES ──────────────────────────────────────────────

describe('SYSTEM_PROMPT_SECTION_NAMES', () => {
    it('contém as seções conhecidas do SDK 1.0', () => {
        expect(Object.keys(SYSTEM_PROMPT_SECTION_NAMES)).toHaveLength(12);
        expect(SYSTEM_PROMPT_SECTION_NAMES.PREAMBLE).toBe('preamble');
        expect(SYSTEM_PROMPT_SECTION_NAMES.IDENTITY).toBe('identity');
        expect(SYSTEM_PROMPT_SECTION_NAMES.RUNTIME_INSTRUCTIONS).toBe('runtime_instructions');
        expect(SYSTEM_PROMPT_SECTION_NAMES.LAST_INSTRUCTIONS).toBe('last_instructions');
    });
});

// ─── SECTION_ACTIONS ──────────────────────────────────────────────────────────

describe('SECTION_ACTIONS', () => {
    it('contém replace, remove, append, prepend', () => {
        expect(SECTION_ACTIONS).toEqual({
            REPLACE: 'replace',
            REMOVE: 'remove',
            APPEND: 'append',
            PREPEND: 'prepend',
        });
    });
});

// ─── PERMISSION_RESULTS ───────────────────────────────────────────────────────

describe('PERMISSION_RESULTS', () => {
    it('contém os decision kinds aceitos pelo PermissionHandler do SDK', () => {
        expect(Object.keys(PERMISSION_RESULTS)).toHaveLength(6);
        expect(PERMISSION_RESULTS.APPROVE_ONCE).toBe('approve-once');
        expect(PERMISSION_RESULTS.APPROVE_FOR_SESSION).toBe('approve-for-session');
        expect(PERMISSION_RESULTS.APPROVE_FOR_LOCATION).toBe('approve-for-location');
        expect(PERMISSION_RESULTS.REJECT).toBe('reject');
        expect(PERMISSION_RESULTS.USER_NOT_AVAILABLE).toBe('user-not-available');
        expect(PERMISSION_RESULTS.NO_RESULT).toBe('no-result');
    });
});

describe('PERMISSION_COMPLETED_KINDS', () => {
    it('contém os kinds emitidos em permission.completed', () => {
        expect(PERMISSION_COMPLETED_KINDS.APPROVED).toBe('approved');
        expect(PERMISSION_COMPLETED_KINDS.DENIED_BY_RULES).toBe('denied-by-rules');
        expect(PERMISSION_COMPLETED_KINDS.DENIED_INTERACTIVELY_BY_USER).toBe('denied-interactively-by-user');
    });
});

// ─── TOOL_RESULT_TYPES ────────────────────────────────────────────────────────

describe('TOOL_RESULT_TYPES', () => {
    it('contém success, failure, rejected, denied', () => {
        expect(TOOL_RESULT_TYPES).toEqual({
            SUCCESS: 'success',
            FAILURE: 'failure',
            REJECTED: 'rejected',
            DENIED: 'denied',
        });
    });
});

// ─── SESSION_LIFECYCLE_EVENTS ─────────────────────────────────────────────────

describe('SESSION_LIFECYCLE_EVENTS', () => {
    it('contém os 5 eventos de lifecycle', () => {
        expect(Object.keys(SESSION_LIFECYCLE_EVENTS)).toHaveLength(5);
        expect(SESSION_LIFECYCLE_EVENTS.CREATED).toBe('session.created');
        expect(SESSION_LIFECYCLE_EVENTS.DELETED).toBe('session.deleted');
    });
});

// ─── SESSION_EVENTS ───────────────────────────────────────────────────────────

describe('SESSION_EVENTS', () => {
    it('contém pelo menos 70 event types', () => {
        expect(Object.keys(SESSION_EVENTS).length).toBeGreaterThanOrEqual(70);
    });

    it('todos os valores são strings não-vazias', () => {
        for (const [key, value] of Object.entries(SESSION_EVENTS)) {
            expect(key.length).toBeGreaterThan(0);
            expect(typeof value).toBe('string');
            expect(value.length).toBeGreaterThan(0);
        }
    });

    it('categorias de evento session.* presentes', () => {
        const sessionEvents = Object.values(SESSION_EVENTS).filter((v) => v.startsWith('session.'));
        expect(sessionEvents.length).toBeGreaterThanOrEqual(20);
        expect(sessionEvents).toContain('session.start');
        expect(sessionEvents).toContain('session.idle');
        expect(sessionEvents).toContain('session.error');
        expect(sessionEvents).toContain('session.shutdown');
    });

    it('inclui capabilities.changed do SDK', () => {
        expect(SESSION_EVENTS.CAPABILITIES_CHANGED).toBe('capabilities.changed');
    });

    it('inclui sampling e auto_mode_switch do SDK', () => {
        expect(SESSION_EVENTS.SAMPLING_REQUESTED).toBe('sampling.requested');
        expect(SESSION_EVENTS.SAMPLING_COMPLETED).toBe('sampling.completed');
        expect(SESSION_EVENTS.AUTO_MODE_SWITCH_REQUESTED).toBe('auto_mode_switch.requested');
        expect(SESSION_EVENTS.AUTO_MODE_SWITCH_COMPLETED).toBe('auto_mode_switch.completed');
    });

    it('categorias de evento assistant.* presentes', () => {
        const assistantEvents = Object.values(SESSION_EVENTS).filter((v) => v.startsWith('assistant.'));
        expect(assistantEvents.length).toBeGreaterThanOrEqual(8);
        expect(assistantEvents).toContain('assistant.turn_start');
        expect(assistantEvents).toContain('assistant.turn_end');
        expect(assistantEvents).toContain('assistant.message');
    });

    it('categorias de evento tool.* presentes', () => {
        const toolEvents = Object.values(SESSION_EVENTS).filter((v) => v.startsWith('tool.'));
        expect(toolEvents.length).toBeGreaterThanOrEqual(4);
        expect(toolEvents).toContain('tool.execution_start');
        expect(toolEvents).toContain('tool.execution_complete');
    });

    it('categorias de evento subagent.* presentes', () => {
        const subagentEvents = Object.values(SESSION_EVENTS).filter((v) => v.startsWith('subagent.'));
        expect(subagentEvents.length).toBeGreaterThanOrEqual(4);
    });

    it('chaves não têm duplicatas', () => {
        const keys = Object.keys(SESSION_EVENTS);
        expect(new Set(keys).size).toBe(keys.length);
    });

    it('valores não têm duplicatas', () => {
        const values = Object.values(SESSION_EVENTS);
        expect(new Set(values).size).toBe(values.length);
    });

    it('cobre todos os event types gerados pelo @github/copilot-sdk 1.0', () => {
        const sessionEventsDts = readFileSync(
            resolve(process.cwd(), 'node_modules/@github/copilot-sdk/dist/generated/session-events.d.ts'),
            'utf8',
        );
        const generated = [
            ...new Set(
                [...sessionEventsDts.matchAll(/export interface \w+Event \{[\s\S]*?\n\}/g)].flatMap((eventBlock) =>
                    [...eventBlock[0].matchAll(/\n\s*type:\s*"([^"]+)"/g)].map((match) => match[1] ?? ''),
                ),
            ),
        ].sort();
        const local = [...new Set(Object.values(SESSION_EVENTS))].sort();
        const localSet = new Set(/** @type {string[]} */ (local));
        const missing = generated.filter((eventType) => !localSet.has(eventType));

        expect(generated).toHaveLength(113);
        expect(missing).toEqual([]);
        expect(local).toContain('custom');
    });
});

// ─── INFINITE_SESSION_DEFAULTS ────────────────────────────────────────────────

describe('INFINITE_SESSION_DEFAULTS', () => {
    it('expõe apenas os thresholds oficiais sem aliases duplicados', () => {
        expect(Object.keys(INFINITE_SESSION_DEFAULTS).sort()).toEqual([
            'BACKGROUND_COMPACTION_THRESHOLD',
            'BUFFER_EXHAUSTION_THRESHOLD',
        ]);
    });

    it('thresholds são números entre 0 e 1', () => {
        expect(INFINITE_SESSION_DEFAULTS.BACKGROUND_COMPACTION_THRESHOLD).toBeGreaterThan(0);
        expect(INFINITE_SESSION_DEFAULTS.BACKGROUND_COMPACTION_THRESHOLD).toBeLessThan(1);
        expect(INFINITE_SESSION_DEFAULTS.BUFFER_EXHAUSTION_THRESHOLD).toBeGreaterThan(0);
        expect(INFINITE_SESSION_DEFAULTS.BUFFER_EXHAUSTION_THRESHOLD).toBeLessThan(1);
    });

    it('buffer > compaction threshold', () => {
        expect(INFINITE_SESSION_DEFAULTS.BUFFER_EXHAUSTION_THRESHOLD).toBeGreaterThan(
            INFINITE_SESSION_DEFAULTS.BACKGROUND_COMPACTION_THRESHOLD,
        );
    });
});

// ─── SDK Type Contract Guards ────────────────────────────────────────────────

describe('SDK 1.0 type contracts', () => {
    it('ToolBinaryResult.type permanece restrito a image/resource no SDK vendor', () => {
        const typesDts = readFileSync(
            resolve(process.cwd(), 'node_modules/@github/copilot-sdk/dist/types.d.ts'),
            'utf8',
        );

        expect(typesDts).toMatch(/export type ToolBinaryResult = \{\s*data: string;\s*mimeType: string;\s*type: "image" \| "resource";/u);
    });
});

// ─── PROVIDER_TYPES ───────────────────────────────────────────────────────────

describe('PROVIDER_TYPES', () => {
    it('contém os 3 providers suportados', () => {
        expect(PROVIDER_TYPES).toEqual({
            OPENAI: 'openai',
            AZURE: 'azure',
            ANTHROPIC: 'anthropic',
        });
    });
});

// ─── Barrel re-export ─────────────────────────────────────────────────────────

describe('sdk/index.js barrel re-exports constants', () => {
    it('re-exporta todas as constantes', async () => {
        const barrel = await import('../../../../src/copilot/sdk/index.js');
        expect(barrel.SESSION_EVENTS).toBeDefined();
        expect(barrel.SESSION_MODES).toBeDefined();
        expect(barrel.REASONING_EFFORTS).toBeDefined();
        expect(barrel.CONNECTION_STATES).toBeDefined();
        expect(barrel.PERMISSION_RESULTS).toBeDefined();
        expect(barrel.SECTION_ACTIONS).toBeDefined();
        expect(barrel.TOOL_RESULT_TYPES).toBeDefined();
        expect(barrel.SESSION_LIFECYCLE_EVENTS).toBeDefined();
        expect(barrel.SYSTEM_PROMPT_SECTION_NAMES).toBeDefined();
        expect(barrel.INFINITE_SESSION_DEFAULTS).toBeDefined();
        expect(barrel.PROVIDER_TYPES).toBeDefined();
    });
});
