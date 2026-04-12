// @ts-check
/**
 * tests/unit/copilot/sdk/test_sdk_config.spec.js
 *
 * Testes para src/copilot/sdk/config.js (Faixa 4 — Unified Config Builder).
 */

import { describe, expect, it, vi } from 'vitest';

// Mock do SDK
vi.mock('@github/copilot-sdk', () => ({
    approveAll: Object.assign(async () => ({ kind: 'approved' }), { _isMockApproveAll: true }),
    SYSTEM_PROMPT_SECTIONS: {
        identity: { description: 'Identity' },
        tone: { description: 'Tone' },
        tool_efficiency: { description: 'Tool efficiency' },
        environment_context: { description: 'Environment' },
        code_change_rules: { description: 'Code changes' },
        guidelines: { description: 'Guidelines' },
        safety: { description: 'Safety' },
        tool_instructions: { description: 'Tool instructions' },
        custom_instructions: { description: 'Custom instructions' },
        last_instructions: { description: 'Last instructions' },
    },
    defineTool: vi.fn(),
}));

// builders de perfil movidos para hooks/presets/profiles.js — mock não necessário aqui

import {
    buildSessionConfig,
    DEFAULT_DIAGNOSTIC_MODEL,
    DEFAULT_INFINITE_SESSION,
    DEFAULT_MODEL,
    getProjectDefaults,
    mergeExcludedTools,
    mergeTools,
} from '../../../../src/copilot/sdk/config.js';

// ─── Constants ────────────────────────────────────────────────────────────────

describe('Config constants', () => {
    it('DEFAULT_MODEL é gpt-4.1', () => {
        expect(DEFAULT_MODEL).toBe('gpt-4.1');
    });

    it('DEFAULT_DIAGNOSTIC_MODEL é gpt-4.1-mini', () => {
        expect(DEFAULT_DIAGNOSTIC_MODEL).toBe('gpt-4.1-mini');
    });

    // DEFAULT_EXCLUDED_TOOLS removido de sdk/config.js — importar de '#copilot/config/session-config'

    it('DEFAULT_INFINITE_SESSION tem enabled e threshold', () => {
        expect(DEFAULT_INFINITE_SESSION.enabled).toBe(true);
        expect(DEFAULT_INFINITE_SESSION.backgroundCompactionThreshold).toBe(0.75);
        expect(Object.isFrozen(DEFAULT_INFINITE_SESSION)).toBe(true);
    });
});

// ─── getProjectDefaults ───────────────────────────────────────────────────────

describe('getProjectDefaults()', () => {
    it('retorna Partial<SessionConfig> com defaults canônicos', () => {
        const d = getProjectDefaults();
        expect(d.model).toBe('gpt-4.1');
        expect(d.streaming).toBe(true);
        expect(d.infiniteSessions).toEqual({ enabled: true, backgroundCompactionThreshold: 0.75 });
        expect(/** @type {any} */ (d.onPermissionRequest)._isMockApproveAll).toBe(true);
    });

    it('retorna novo objeto a cada chamada (sem referência compartilhada)', () => {
        const a = getProjectDefaults();
        const b = getProjectDefaults();
        expect(a).not.toBe(b);
        expect(a.infiniteSessions).not.toBe(b.infiniteSessions);
    });
});

// ─── buildSessionConfig ───────────────────────────────────────────────────────

describe('buildSessionConfig()', () => {
    it('sem argumentos retorna config com defaults', () => {
        const cfg = buildSessionConfig();
        expect(cfg.model).toBe('gpt-4.1');
        expect(cfg.streaming).toBe(true);
        expect(/** @type {any} */ (cfg.onPermissionRequest)._isMockApproveAll).toBe(true);
    });

    it('input sobrescreve defaults', () => {
        const cfg = buildSessionConfig({ model: 'claude-4' });
        expect(cfg.model).toBe('claude-4');
        expect(cfg.streaming).toBe(true); // default preservado
    });

    it('defaults sobrescrevem project defaults', () => {
        const cfg = buildSessionConfig({}, { model: 'custom-model' });
        expect(cfg.model).toBe('custom-model');
    });

    it('input tem prioridade sobre defaults', () => {
        const cfg = buildSessionConfig({ model: 'input-model' }, { model: 'defaults-model' });
        expect(cfg.model).toBe('input-model');
    });

    it('faz shallow merge de infiniteSessions', () => {
        const cfg = buildSessionConfig({ infiniteSessions: /** @type {any} */ ({ enabled: false }) }, {});
        // enabled do input, threshold do project default
        expect(cfg.infiniteSessions).toEqual({
            enabled: false,
            backgroundCompactionThreshold: 0.75,
        });
    });

    it('garante onPermissionRequest sempre presente', () => {
        const cfg = buildSessionConfig({ onPermissionRequest: undefined });
        expect(/** @type {any} */ (cfg.onPermissionRequest)._isMockApproveAll).toBe(true);
    });

    it('aceita todos os campos SessionConfig', () => {
        const handler = vi.fn();
        const cfg = buildSessionConfig({
            sessionId: 'test-123',
            model: 'claude-4',
            streaming: false,
            tools: [/** @type {any} */ ({ name: 'myTool' })],
            availableTools: ['myTool'],
            excludedTools: ['powershell'],
            workingDirectory: '/tmp',
            onPermissionRequest: handler,
        });
        expect(cfg.sessionId).toBe('test-123');
        expect(cfg.tools).toHaveLength(1);
        expect(cfg.availableTools).toEqual(['myTool']);
        expect(cfg.onPermissionRequest).toBe(handler);
    });
});

// ─── mergeTools ───────────────────────────────────────────────────────────────

describe('mergeTools()', () => {
    it('combina duas listas sem duplicatas', () => {
        const base = [
            /** @type {any} */ ({ name: 'a', handler: 'base_a' }),
            /** @type {any} */ ({ name: 'b', handler: 'base_b' }),
        ];
        const extra = [
            /** @type {any} */ ({ name: 'b', handler: 'extra_b' }),
            /** @type {any} */ ({ name: 'c', handler: 'extra_c' }),
        ];
        const merged = mergeTools(base, extra);
        expect(merged).toHaveLength(3);
        expect(merged.find((t) => t.name === 'b')?.handler).toBe('extra_b');
    });

    it('retorna array vazio para inputs vazios', () => {
        expect(mergeTools([], [])).toEqual([]);
    });

    it('ignora itens sem nome', () => {
        const result = mergeTools(
            [/** @type {any} */ ({ name: 'a' }), /** @type {any} */ ({})],
            [/** @type {any} */ (null)],
        );
        expect(result).toHaveLength(1);
    });
});

// ─── mergeExcludedTools ───────────────────────────────────────────────────────

describe('mergeExcludedTools()', () => {
    it('combina sem duplicatas', () => {
        const result = mergeExcludedTools(['a', 'b'], ['b', 'c']);
        expect(result).toEqual(expect.arrayContaining(['a', 'b', 'c']));
        expect(result).toHaveLength(3);
    });

    it('retorna array vazio para inputs vazios', () => {
        expect(mergeExcludedTools([], [])).toEqual([]);
    });
});

// Profile builders movidos para src/copilot/hooks/presets/profiles.js — testes lá.

// ─── Barrel re-export ─────────────────────────────────────────────────────────

describe('sdk/index.js barrel re-exports config', () => {
    it('re-exporta funções e constantes que permanecem no barrel', async () => {
        const barrel = await import('../../../../src/copilot/sdk/index.js');
        expect(barrel.DEFAULT_MODEL).toBe('gpt-4.1');
        expect(barrel.DEFAULT_DIAGNOSTIC_MODEL).toBe('gpt-4.1-mini');
        expect(barrel.DEFAULT_INFINITE_SESSION).toBeDefined();
        expect(typeof barrel.getProjectDefaults).toBe('function');
        expect(typeof barrel.buildSessionConfig).toBe('function');
        expect(typeof barrel.mergeTools).toBe('function');
        expect(typeof barrel.mergeExcludedTools).toBe('function');
        // DEFAULT_EXCLUDED_TOOLS e build*Config movidos — não re-exportados no barrel
    });
});
