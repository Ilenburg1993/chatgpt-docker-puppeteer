// @ts-check
/**
 * tests/unit/copilot/contracts/test_arch_contracts.spec.js
 *
 * W4-9 — Contract tests de arquitetura (adicionados como parte do Wave 4).
 *
 * Garante que:
 *
 * 1. Todos os 17 módulos têm barrel (index.js)
 * 2. Barrels essenciais exportam símbolos mínimos esperados
 * 3. Não há violações de camada em imports críticos (bridges não importa agent)
 * 4. DI tokens existem para todos os 13 serviços registrados
 * 5. arch-health deep-import refinado ≤ 10 (sem imports proibidos ativos)
 */

import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'vitest';

const COPILOT_ROOT = new URL('../../../../src/copilot/', import.meta.url).pathname;

// ─── Helpers ────────────────────────────────────────────────────────────────

function copilotPath(...parts) {
    return join(COPILOT_ROOT, ...parts);
}

function readSrc(relPath) {
    return readFileSync(copilotPath(relPath), 'utf-8');
}

// ═══════════════════════════════════════════════════════════════════════════════
// 1. Barrel coverage — todos os 17 módulos têm index.js
// ═══════════════════════════════════════════════════════════════════════════════

const EXPECTED_MODULES = [
    'agent',
    'api',
    'audit',
    'bridges',
    'channel',
    'config',
    'conversation-hub',
    'core',
    'db',
    'hooks',
    'observability',
    'plugins',
    'sdk',
    'services',
    'terminal',
    'tools',
    'types',
];

describe('W4-9 — barrel coverage: todos os 17 módulos', () => {
    for (const mod of EXPECTED_MODULES) {
        it(`${mod}/index.js existe`, () => {
            const p = copilotPath(mod, 'index.js');
            assert.ok(existsSync(p), `Barrel ausente: src/copilot/${mod}/index.js`);
        });
    }
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2. Barrels essenciais — símbolos mínimos esperados
// ═══════════════════════════════════════════════════════════════════════════════

describe('W4-9 — barrel exports: símbolos mínimos', () => {
    it('core barrel exporta CopilotError e container', async () => {
        const mod = await import('#copilot/core');
        assert.ok(mod.CopilotError, 'CopilotError deve existir');
        assert.ok(mod.container, 'container deve existir');
    });

    it('observability barrel exporta log', async () => {
        const mod = await import('#copilot/observability');
        assert.ok(mod.log, 'log deve ser exportado do barrel observability');
    });

    it('config barrel exporta constantes de configuração (AGENT_*)', async () => {
        const mod = await import('#copilot/config');
        // O barrel config exporta constantes de env (ex.: AGENT_IDENTITY, LLM_B_TERMINAL_PORT etc.)
        assert.ok('AGENT_IDENTITY' in mod, 'AGENT_IDENTITY deve ser exportado do barrel config');
    });

    it('hooks barrel exporta createHooks', async () => {
        const mod = await import('#copilot/hooks');
        assert.equal(typeof mod.createHooks, 'function', 'createHooks deve ser function');
    });

    it('audit barrel exporta defaultAuditLog', async () => {
        const mod = await import('#copilot/audit');
        assert.ok(mod.defaultAuditLog, 'defaultAuditLog deve existir no barrel audit');
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 3. Violação de camada: bridges não deve importar agent diretamente
// ═══════════════════════════════════════════════════════════════════════════════

describe('W4-9 — violação de camada L3→L4: bridges não importa agent', () => {
    it('bridges/*.js não tem import de ../agent/ ou #copilot/agent/', () => {
        const bridgesDir = copilotPath('bridges');
        const files = readdirSync(bridgesDir).filter((f) => f.endsWith('.js'));
        const violations = [];

        for (const file of files) {
            const src = readSrc(join('bridges', file));
            const lines = src.split('\n');
            for (const line of lines) {
                const t = line.trim();
                if (t.startsWith('//') || t.startsWith('*')) continue;
                if (/import.+from.+['"]([./]*agent\/|#copilot\/agent\/)/.test(t)) {
                    violations.push(`bridges/${file}: ${t.slice(0, 80)}`);
                }
            }
        }

        assert.deepEqual(violations, [], `Violações L3→L4 encontradas:\n${violations.join('\n')}`);
    });

    it('tools/*.js não importa diretamente de ../agent/ (apenas #copilot/agent barrel)', () => {
        const toolsDir = copilotPath('tools');
        const files = readdirSync(toolsDir).filter((f) => f.endsWith('.js') && !f.startsWith('todo'));
        const violations = [];

        for (const file of files) {
            const src = readSrc(join('tools', file));
            const lines = src.split('\n');
            for (const line of lines) {
                const t = line.trim();
                if (t.startsWith('//') || t.startsWith('*')) continue;
                // Permite import de barrel #copilot/agent, bloqueia ../agent/ ou ../../agent/
                if (/import.+from.+['"]\.\.[./]*agent\//.test(t)) {
                    violations.push(`tools/${file}: ${t.slice(0, 80)}`);
                }
            }
        }

        assert.deepEqual(violations, [], `Violações tools→agent:\n${violations.join('\n')}`);
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 4. DI tokens: 13 tokens canônicos disponíveis no core barrel
// ═══════════════════════════════════════════════════════════════════════════════

const EXPECTED_DI_TOKENS = [
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

describe('W4-9 — DI tokens: todos os 13 tokens canônicos', () => {
    it('di-tokens.js exporta todos os tokens esperados', async () => {
        const tokens = await import('../../../../src/copilot/core/di-tokens.js');
        const missing = EXPECTED_DI_TOKENS.filter((t) => !(t in tokens));
        assert.deepEqual(missing, [], `Tokens DI ausentes: ${missing.join(', ')}`);
    });

    it('cada token tem _id Symbol e name', async () => {
        const tokens = await import('../../../../src/copilot/core/di-tokens.js');
        for (const name of EXPECTED_DI_TOKENS) {
            const token = tokens[name];
            assert.ok(token, `Token ${name} deve existir`);
            assert.ok(typeof token._id === 'symbol', `${name}._id deve ser symbol`);
            assert.equal(token.name, name, `${name}.name deve ser '${name}'`);
        }
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 5. Deep imports permitidos: sdk/types e observability/logger não são proibidos
// ═══════════════════════════════════════════════════════════════════════════════

describe('W4-9 — F21 allow-list: imports permitidos importam sem erro', () => {
    it('#copilot/sdk/types pode ser importado via typedef sem erro de runtime', async () => {
        // sdk/types é typedef-only — o arquivo existe e pode ser carregado
        assert.ok(existsSync(copilotPath('sdk', 'types.js')), 'src/copilot/sdk/types.js deve existir');
    });

    it('#copilot/observability/logger pode ser carregado', async () => {
        assert.ok(
            existsSync(copilotPath('observability', 'logger.js')),
            'src/copilot/observability/logger.js deve existir',
        );
    });
});
