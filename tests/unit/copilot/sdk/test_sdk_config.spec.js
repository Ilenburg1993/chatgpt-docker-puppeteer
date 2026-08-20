// @ts-check
/**
 * Verifica a nova fronteira canônica de configuração: o SDK root não carrega mais `sdk/config.js`; configuração de
 * sessão pertence a `#copilot/config`.
 */

import { describe, expect, it } from 'vitest';

import { SessionConfigBuilder } from '#copilot/config/session-config';
import { DEFAULT_DIAGNOSTIC_MODEL, DEFAULT_MODEL, INFINITE_SESSION_DEFAULTS } from '#copilot/sdk/constants';

describe('Config constants', () => {
    it('DEFAULT_MODEL é auto', () => {
        expect(DEFAULT_MODEL).toBe('auto');
    });

    it('DEFAULT_DIAGNOSTIC_MODEL é gpt-4.1-mini', () => {
        expect(DEFAULT_DIAGNOSTIC_MODEL).toBe('gpt-4.1-mini');
    });

    it('INFINITE_SESSION_DEFAULTS expõe thresholds canônicos do SDK', () => {
        expect(INFINITE_SESSION_DEFAULTS.BACKGROUND_COMPACTION_THRESHOLD).toBe(0.8);
        expect(INFINITE_SESSION_DEFAULTS.BUFFER_EXHAUSTION_THRESHOLD).toBe(0.95);
    });
});

describe('SessionConfigBuilder canônico', () => {
    it('monta config com defaults mínimos e onPermissionRequest', () => {
        const cfg = new SessionConfigBuilder().build();
        expect(cfg.streaming).toBe(true);
        expect(typeof cfg.onPermissionRequest).toBe('function');
    });

    it('aplica overrides explicitamente sem passar pelo SDK root', () => {
        /** @type {import('#copilot/sdk/types').PermissionHandler} */
        const handler = async () => ({ kind: 'approve-once' });
        const cfg = new SessionConfigBuilder()
            .sessionId('test-123')
            .model('gpt-4.1')
            .streaming(false)
            .tools([/** @type {any} */ ({ name: 'myTool' })])
            .availableTools(['myTool'])
            .excludedTools(['powershell'])
            .workingDirectory('/tmp')
            .onPermissionRequest(handler)
            .build();

        expect(cfg.sessionId).toBe('test-123');
        expect(cfg.model).toBe('gpt-4.1');
        expect(cfg.streaming).toBe(false);
        expect(cfg.tools).toHaveLength(1);
        expect(cfg.availableTools).toEqual(['myTool']);
        expect(cfg.onPermissionRequest).toBe(handler);
    });

    it('normaliza infiniteSessions pelo builder canônico', () => {
        const cfg = new SessionConfigBuilder().infiniteSessions({ enabled: false }).build();
        expect(cfg.infiniteSessions).toEqual({
            enabled: false,
            backgroundCompactionThreshold: 0.8,
        });
    });
});

describe('sdk/index.js não reexporta config de produto', () => {
    it('mantém config fora do SDK root', async () => {
        const barrel = await import('#copilot/sdk');
        expect(barrel).not.toHaveProperty('buildSessionConfig');
        expect(barrel).not.toHaveProperty('getProjectDefaults');
        expect(barrel).not.toHaveProperty('mergeTools');
        expect(barrel).not.toHaveProperty('mergeExcludedTools');
    });
});
