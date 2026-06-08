// @ts-check
/**
 * tests/unit/copilot/sdk/test_sdk_system_message.spec.js
 *
 * Testes para src/copilot/sdk/system-message.js (Faixa 3 / F11-F15).
 */

import { describe, expect, it, vi } from 'vitest';

// Mock do SDK
const mocks = vi.hoisted(() => ({
    SYSTEM_MESSAGE_SECTIONS: {
        identity: { description: 'Agent identity' },
        tone: { description: 'Communication tone' },
        tool_efficiency: { description: 'Tool usage guidelines' },
        environment_context: { description: 'Environment context' },
        code_change_rules: { description: 'Code change rules' },
        guidelines: { description: 'General guidelines' },
        safety: { description: 'Safety rules' },
        tool_instructions: { description: 'Tool instructions' },
        custom_instructions: { description: 'Custom instructions' },
        last_instructions: { description: 'Final instructions' },
    },
}));

vi.mock('@github/copilot-sdk', () => ({
    SYSTEM_MESSAGE_SECTIONS: mocks.SYSTEM_MESSAGE_SECTIONS,
    SYSTEM_PROMPT_SECTIONS: mocks.SYSTEM_MESSAGE_SECTIONS,
}));

import {
    SYSTEM_PROMPT_SECTIONS,
    appendSystemMessage,
    appendToGuidelines,
    customizeSystemMessage,
    getSectionDescription,
    getSectionNames,
    replaceIdentity,
    replaceSystemMessage,
    sectionOverride,
    supportsCustomizeMode,
    transformSection,
} from '../../../../src/copilot/sdk/session/system-message.js';

// ─── SYSTEM_PROMPT_SECTIONS re-export ─────────────────────────────────────────

describe('SYSTEM_PROMPT_SECTIONS re-export', () => {
    it('é um objeto com seções conhecidas', () => {
        expect(SYSTEM_PROMPT_SECTIONS).toBeDefined();
        expect(SYSTEM_PROMPT_SECTIONS.guidelines).toEqual({ description: 'General guidelines' });
    });

    it('contém 10 seções', () => {
        expect(Object.keys(SYSTEM_PROMPT_SECTIONS)).toHaveLength(10);
    });
});

// ─── supportsCustomizeMode ────────────────────────────────────────────────────

describe('supportsCustomizeMode()', () => {
    it('retorna true quando SYSTEM_PROMPT_SECTIONS está definido', () => {
        expect(supportsCustomizeMode()).toBe(true);
    });
});

// ─── appendSystemMessage ──────────────────────────────────────────────────────

describe('appendSystemMessage()', () => {
    it('retorna config com mode:append e content', () => {
        const config = appendSystemMessage('extra instructions');
        expect(config.mode).toBe('append');
        expect(config.content).toBe('extra instructions');
    });

    it('content default é string vazia', () => {
        const config = appendSystemMessage();
        expect(config.content).toBe('');
    });
});

// ─── replaceSystemMessage ─────────────────────────────────────────────────────

describe('replaceSystemMessage()', () => {
    it('retorna config com mode:replace e content', () => {
        const config = replaceSystemMessage('full system message');
        expect(config.mode).toBe('replace');
        expect(config.content).toBe('full system message');
    });

    it('lança TypeError se content não for string', () => {
        expect(() => replaceSystemMessage(/** @type {any} */ (42))).toThrow(TypeError);
    });
});

// ─── customizeSystemMessage ───────────────────────────────────────────────────

describe('customizeSystemMessage()', () => {
    it('retorna config com mode:customize quando SDK suporta', () => {
        const config = customizeSystemMessage({ guidelines: { action: 'append', content: 'extra' } }, 'tail content');
        expect(config).toEqual({
            mode: 'customize',
            sections: { guidelines: { action: 'append', content: 'extra' } },
            content: 'tail content',
        });
    });

    it('sem sections nem content retorna customize vazio', () => {
        const config = customizeSystemMessage();
        expect(config).toEqual({ mode: 'customize' });
    });

    it('aceita múltiplas seções', () => {
        const config = customizeSystemMessage({
            identity: { action: 'replace', content: 'New identity' },
            safety: { action: 'remove' },
            guidelines: { action: 'append', content: 'More rules' },
        });
        expect(/** @type {any} */ (config).sections).toHaveProperty('identity');
        expect(/** @type {any} */ (config).sections).toHaveProperty('safety');
        expect(/** @type {any} */ (config).sections).toHaveProperty('guidelines');
    });
});

// ─── sectionOverride ──────────────────────────────────────────────────────────

describe('sectionOverride()', () => {
    it('cria override com action e content', () => {
        const o = sectionOverride('append', 'Extra content');
        expect(o).toEqual({ action: 'append', content: 'Extra content' });
    });

    it('cria override com apenas action (sem content)', () => {
        const o = sectionOverride('remove');
        expect(o).toEqual({ action: 'remove' });
    });

    it('aceita replace', () => {
        const o = sectionOverride('replace', 'New content');
        expect(o.action).toBe('replace');
        expect(o.content).toBe('New content');
    });

    it('aceita prepend', () => {
        const o = sectionOverride('prepend', 'Before');
        expect(o.action).toBe('prepend');
    });

    it('aceita SectionTransformFn como action', () => {
        const fn = (/** @type {string} */ current) => `${current} + transformed`;
        const o = sectionOverride(fn);
        expect(typeof o.action).toBe('function');
    });

    it('SectionTransformFn produz resultado correto ao ser invocada', () => {
        const fn = (/** @type {string} */ current) => `PREFIXED: ${current}`;
        const o = sectionOverride(fn);
        expect(/** @type {Function} */ (o.action)('original content')).toBe('PREFIXED: original content');
    });

    it('transformSection cria override explícito para SectionTransformFn', () => {
        const o = transformSection((/** @type {string} */ current) => `${current}\nextra`);
        expect(typeof o.action).toBe('function');
        expect(/** @type {Function} */ (o.action)('base')).toBe('base\nextra');
    });

    it('SectionTransformFn async retorna Promise', async () => {
        const fn = async (/** @type {string} */ current) => `ASYNC: ${current}`;
        const o = sectionOverride(fn);
        const result = await /** @type {Function} */ (o.action)('test');
        expect(result).toBe('ASYNC: test');
    });

    it('customizeSystemMessage com SectionTransformFn produz config válida', () => {
        const fn = (/** @type {string} */ current) => current.toUpperCase();
        const config = customizeSystemMessage({ guidelines: sectionOverride(fn) });
        expect(/** @type {any} */ (config).mode).toBe('customize');
        expect(typeof (/** @type {any} */ (config).sections.guidelines.action)).toBe('function');
    });
});

// ─── appendToGuidelines ───────────────────────────────────────────────────────

describe('appendToGuidelines()', () => {
    it('cria customize config com guidelines append', () => {
        const config = appendToGuidelines('New guideline');
        expect(/** @type {any} */ (config).mode).toBe('customize');
        expect(/** @type {any} */ (config).sections.guidelines).toEqual({
            action: 'append',
            content: 'New guideline',
        });
    });
});

// ─── replaceIdentity ──────────────────────────────────────────────────────────

describe('replaceIdentity()', () => {
    it('cria customize config com identity replace', () => {
        const config = replaceIdentity('I am a custom agent');
        expect(/** @type {any} */ (config).mode).toBe('customize');
        expect(/** @type {any} */ (config).sections.identity).toEqual({
            action: 'replace',
            content: 'I am a custom agent',
        });
    });
});

// ─── getSectionNames ──────────────────────────────────────────────────────────

describe('getSectionNames()', () => {
    it('retorna array com 10 nomes de seção', () => {
        const names = getSectionNames();
        expect(names).toHaveLength(10);
        expect(names).toContain('identity');
        expect(names).toContain('guidelines');
        expect(names).toContain('last_instructions');
    });
});

// ─── getSectionDescription ────────────────────────────────────────────────────

describe('getSectionDescription()', () => {
    it('retorna descrição de uma seção existente', () => {
        expect(getSectionDescription('guidelines')).toBe('General guidelines');
    });

    it('retorna undefined para seção inexistente', () => {
        expect(getSectionDescription(/** @type {any} */ ('nonexistent'))).toBeUndefined();
    });
});

// ─── Barrel re-export ─────────────────────────────────────────────────────────

describe('sdk/index.js barrel re-exports system-message', () => {
    it('re-exporta todas as funções', async () => {
        const barrel = await import('../../../../src/copilot/sdk/index.js');
        expect(barrel.SYSTEM_PROMPT_SECTIONS).toBeDefined();
        expect(typeof barrel.appendSystemMessage).toBe('function');
        expect(typeof barrel.replaceSystemMessage).toBe('function');
        expect(typeof barrel.customizeSystemMessage).toBe('function');
        expect(typeof barrel.sectionOverride).toBe('function');
        expect(typeof barrel.transformSection).toBe('function');
        expect(typeof barrel.appendToGuidelines).toBe('function');
        expect(typeof barrel.replaceIdentity).toBe('function');
        expect(typeof barrel.getSectionNames).toBe('function');
        expect(typeof barrel.getSectionDescription).toBe('function');
        expect(typeof barrel.supportsCustomizeMode).toBe('function');
    });
});
