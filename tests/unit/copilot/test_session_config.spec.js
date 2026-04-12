// @ts-check
/**
 * tests/unit/copilot/test_session_config.spec.js
 *
 * Testes estruturais para src/copilot/config/session-config.js
 *
 * Estratégia: análise de source code para evitar inicialização do SDK.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';

const SRC = fs.readFileSync(path.resolve('src/copilot/config/session-config.js'), 'utf8');

describe('copilot/config/session-config.js — structural', () => {
    // ─── Exports ────────────────────────────────────────────────────────────────

    it('deve exportar buildAlwaysAliveConfig', () => {
        assert.ok(SRC.includes('export function buildAlwaysAliveConfig'));
    });

    it('deve exportar buildReadOnlyConfig', () => {
        assert.ok(SRC.includes('export function buildReadOnlyConfig'));
    });

    it('deve exportar buildFullAccessConfig', () => {
        assert.ok(SRC.includes('export function buildFullAccessConfig'));
    });

    it('deve exportar buildDiagnosticConfig', () => {
        assert.ok(SRC.includes('export function buildDiagnosticConfig'));
    });

    it('deve exportar DEFAULT_EXCLUDED_TOOLS', () => {
        assert.ok(SRC.includes('export const DEFAULT_EXCLUDED_TOOLS'));
    });

    // ─── BASE_CONFIG ────────────────────────────────────────────────────────────

    it('BASE_CONFIG deve ter streaming: true', () => {
        assert.ok(SRC.includes('streaming: true'));
    });

    it('BASE_CONFIG deve ter infiniteSessions habilitado', () => {
        assert.ok(SRC.includes('infiniteSessions'));
        assert.ok(SRC.includes('enabled: true'));
    });

    it('BASE_CONFIG deve ter backgroundCompactionThreshold', () => {
        assert.ok(SRC.includes('backgroundCompactionThreshold'));
    });

    // ─── DEFAULT_EXCLUDED_TOOLS ─────────────────────────────────────────────────

    it('deve excluir powershell por default', () => {
        assert.ok(SRC.includes("'powershell'"));
    });

    it('deve excluir web_fetch por default', () => {
        assert.ok(SRC.includes("'web_fetch'"));
    });

    it('deve excluir web_search por default', () => {
        assert.ok(SRC.includes("'web_search'"));
    });

    it('deve excluir memory por default', () => {
        // Verifica que 'memory' está na lista de exclusão
        const match = SRC.match(/DEFAULT_EXCLUDED_TOOLS\s*=\s*\[([^\]]+)\]/);
        assert.ok(match, 'DEFAULT_EXCLUDED_TOOLS deve ser um array');
        assert.ok(match[1].includes("'memory'"));
    });

    // ─── buildAlwaysAliveConfig ─────────────────────────────────────────────────

    it('AlwaysAlive deve usar gpt-4.1 como modelo default', () => {
        // Verifica o default no destructuring
        assert.ok(SRC.includes("model = 'gpt-4.1'"));
    });

    it('AlwaysAlive deve usar approveAll como permissionHandler default', () => {
        assert.ok(SRC.includes('approveAll'));
    });

    it('AlwaysAlive deve criar hooks com createHooks', () => {
        assert.ok(SRC.includes('createHooks'));
    });

    it('AlwaysAlive deve suportar hookContextContent para systemMessage', () => {
        assert.ok(SRC.includes('hookContextContent'));
        assert.ok(SRC.includes('buildHookContextAppendMessage'));
    });

    it('AlwaysAlive deve spread BASE_CONFIG', () => {
        assert.ok(SRC.includes('...BASE_CONFIG'));
    });

    // ─── buildReadOnlyConfig ────────────────────────────────────────────────────

    it('ReadOnly deve usar createAuditOnlyPermission', () => {
        assert.ok(SRC.includes('createAuditOnlyPermission'));
    });

    it('ReadOnly deve usar gpt-4.1 como modelo default', () => {
        // buildReadOnlyConfig has its own default
        const readOnlyFn = SRC.slice(SRC.indexOf('buildReadOnlyConfig'));
        assert.ok(readOnlyFn.includes("model = 'gpt-4.1'"));
    });

    // ─── buildFullAccessConfig ──────────────────────────────────────────────────

    it('FullAccess deve usar createSafePermission', () => {
        assert.ok(SRC.includes('createSafePermission'));
    });

    it('FullAccess deve suportar denyTools parameter', () => {
        assert.ok(SRC.includes('denyTools'));
    });

    // ─── buildDiagnosticConfig ──────────────────────────────────────────────────

    it('Diagnostic deve usar gpt-4.1-mini como modelo default', () => {
        assert.ok(SRC.includes("'gpt-4.1-mini'"));
    });

    it('Diagnostic deve desabilitar streaming', () => {
        const diagFn = SRC.slice(SRC.indexOf('buildDiagnosticConfig'));
        assert.ok(diagFn.includes('streaming: false'));
    });

    it('Diagnostic deve usar createApproveAllPermission', () => {
        assert.ok(SRC.includes('createApproveAllPermission'));
    });

    it('Diagnostic NÃO deve usar infiniteSessions (sem spread de BASE_CONFIG)', () => {
        // buildDiagnosticConfig não spread BASE_CONFIG
        const diagFn = SRC.slice(SRC.indexOf('function buildDiagnosticConfig'));
        const nextFn = diagFn.indexOf('\nexport');
        const body = nextFn > 0 ? diagFn.slice(0, nextFn) : diagFn;
        assert.ok(!body.includes('...BASE_CONFIG'), 'Diagnostic não deve herdar BASE_CONFIG');
    });

    // ─── JSDoc & types ──────────────────────────────────────────────────────────

    it('deve ter JSDoc completo para cada builder', () => {
        const builders = [
            'buildAlwaysAliveConfig',
            'buildReadOnlyConfig',
            'buildFullAccessConfig',
            'buildDiagnosticConfig',
        ];
        for (const name of builders) {
            const pattern = new RegExp(`function\\s+${name}`);
            const match = pattern.exec(SRC);
            assert.ok(match, `${name} deve existir`);
            // JSDoc @returns deve estar nas 1500 chars antes da declaração
            const before = SRC.slice(Math.max(0, match.index - 1500), match.index);
            assert.ok(before.includes('@returns'), `${name} deve ter @returns no JSDoc`);
            assert.ok(before.includes('@param'), `${name} deve ter @param no JSDoc`);
        }
    });

    it('deve importar de #copilot/lib/index', () => {
        assert.ok(SRC.includes("from '#copilot") || SRC.includes("from '../lib"));
    });

    it('deve importar approveAll do SDK', () => {
        assert.ok(SRC.includes("from '@github/copilot-sdk'") || SRC.includes("from '#copilot/sdk'"));
    });
});
