// @ts-check
/**
 * tests/unit/copilot/test_session_config.spec.js
 *
 * Testes estruturais para DEFAULT_EXCLUDED_TOOLS (config/index.js) e session profile builders
 * (hooks/presets/profiles.js).
 *
 * Estratégia: análise de source code para evitar inicialização do SDK.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'vitest';

const CONFIG_SRC = fs.readFileSync(path.resolve('src/copilot/config/index.js'), 'utf8');
const PROFILES_SRC = fs.readFileSync(path.resolve('src/copilot/hooks/presets/profiles.js'), 'utf8');

describe('copilot/config — DEFAULT_EXCLUDED_TOOLS structural', () => {
    it('deve exportar DEFAULT_EXCLUDED_TOOLS', () => {
        assert.ok(CONFIG_SRC.includes('export const DEFAULT_EXCLUDED_TOOLS'));
    });

    it('não deve excluir nenhuma tool por default', () => {
        const match = CONFIG_SRC.match(/DEFAULT_EXCLUDED_TOOLS[\s\S]*?\[([^\]]*)\]/);
        assert.ok(match, 'DEFAULT_EXCLUDED_TOOLS deve ser um array');
        const values =
            match[1]
                ?.split(',')
                .map((part) => part.trim())
                .filter(Boolean)
                .filter((part) => !part.startsWith('//')) ?? [];
        assert.equal(values.length, 0);
    });
});

describe('copilot/hooks/presets/profiles.js — structural', () => {
    it('deve exportar buildAlwaysAliveConfig', () => {
        assert.ok(PROFILES_SRC.includes('export function buildAlwaysAliveConfig'));
    });

    it('deve exportar buildReadOnlyConfig', () => {
        assert.ok(PROFILES_SRC.includes('export function buildReadOnlyConfig'));
    });

    it('deve exportar buildFullAccessConfig', () => {
        assert.ok(PROFILES_SRC.includes('export function buildFullAccessConfig'));
    });

    it('deve exportar buildDiagnosticConfig', () => {
        assert.ok(PROFILES_SRC.includes('export function buildDiagnosticConfig'));
    });

    it('AlwaysAlive deve usar approveAll como permissionHandler default', () => {
        assert.ok(PROFILES_SRC.includes('approveAll'));
    });

    it('ReadOnly deve usar createAuditOnlyPermission', () => {
        assert.ok(PROFILES_SRC.includes('createAuditOnlyPermission'));
    });

    it('FullAccess deve usar createSafePermission', () => {
        assert.ok(PROFILES_SRC.includes('createSafePermission'));
    });

    it('deve ter JSDoc completo para cada builder', () => {
        const builders = [
            'buildAlwaysAliveConfig',
            'buildReadOnlyConfig',
            'buildFullAccessConfig',
            'buildDiagnosticConfig',
        ];
        for (const name of builders) {
            const pattern = new RegExp(`function\\s+${name}`);
            const match = pattern.exec(PROFILES_SRC);
            assert.ok(match, `${name} deve existir`);
            const before = PROFILES_SRC.slice(Math.max(0, match.index - 1500), match.index);
            assert.ok(before.includes('@returns'), `${name} deve ter @returns no JSDoc`);
            assert.ok(before.includes('@param'), `${name} deve ter @param no JSDoc`);
        }
    });
});
