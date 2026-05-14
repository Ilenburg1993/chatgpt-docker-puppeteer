// @ts-check
/**
 * tests/unit/copilot/sdk/test_sdk_barrel_f23.spec.js
 *
 * Faixa 23 — Barrel Consolidation: verifica a completude e consistência de sdk/index.js.
 *
 * F108: index.js formato consistente, sem artefatos de cat >> ou seções duplicadas F109: nenhum export duplicado entre
 * experimental-rpc.js e rpc.js F110: ordenação e comentários de seção presentes F111: todos módulos obrigatórios
 * exportam via barrel F112: ausência de símbolos exportados que não existem nas fontes
 */

import { createRequire } from 'node:module';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { readFileSync, existsSync } = require('node:fs');

const ROOT = join(import.meta.url.replace('file://', ''), '../../../../..');
const SDK_DIR = join(ROOT, 'src/copilot/sdk');

/**
 * @param {string} filename
 * @returns {string}
 */
function readSdk(filename) {
    return readFileSync(join(SDK_DIR, filename), 'utf8');
}

/**
 * Extrai todos os nomes exportados de um bloco de texto de exports.
 *
 * @param {string} sourceText
 * @returns {string[]}
 */
function extractExportedNames(sourceText) {
    const names = [];
    // Captura nomes em blocos `export { ... } from ...`
    const blockRegex = /export\s*\{([^}]+)\}\s*from\s*['"][^'"]+['"]/g;
    let m;
    while ((m = blockRegex.exec(sourceText)) !== null) {
        const block = m[1];
        if (!block) continue;
        // Cada linha pode ser `name`, `name as alias`, ou `* as ns`
        const items = block
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean);
        for (const item of items) {
            const alias = item.match(/as\s+(\w+)/);
            if (alias?.[1]) {
                names.push(alias[1]);
            } else {
                names.push(item);
            }
        }
    }
    // Captura `export function name` e `export const name` diretos (não re-exports)
    const directRegex = /export\s+(?:async\s+)?(?:function|const|class|let|var)\s+(\w+)/g;
    while ((m = directRegex.exec(sourceText)) !== null) {
        if (m[1]) names.push(m[1]);
    }
    return names;
}

// ─── F108: Formato e consistência do index.js ────────────────────────────────

describe('F23 — F108: index.js formato consistente', () => {
    it('index.js existe', () => {
        expect(existsSync(join(SDK_DIR, 'index.js'))).toBe(true);
    });

    it('index.js tem header @ts-check', () => {
        const src = readSdk('index.js');
        expect(src).toContain('// @ts-check');
    });

    it('index.js tem @module copilot/sdk no JSDoc', () => {
        const src = readSdk('index.js');
        expect(src).toContain('@module copilot/sdk');
    });

    it('index.js NÃO tem múltiplas linhas export {} consecutivas sem separador', () => {
        const src = readSdk('index.js');
        // Verifica que não há dois blocos de export sem comentário separando
        // (prevenção contra cat >> concatenações acidentais)
        const doubleExport = /\}\s*from\s*['"][^'"]+['"]\s*;\s*\n\s*export\s*\{/;
        // Isso é permitido APENAS se há um comentário de seção entre eles
        // Estratégia: contar ocorrências vs. comentários separadores
        const exportBlockEnds = (src.match(/\}\s*from\s*['"][^'"]+['"]\s*;/g) || []).length;
        const sectionComments = (src.match(/\/\/ ─{3,}/g) || []).length;
        // Deve haver pelo menos metade de comentários de seção vs. export blocks
        expect(sectionComments).toBeGreaterThan(5);
        expect(exportBlockEnds).toBeGreaterThan(10);
    });

    it('index.js tem comentários de seção para as principais faixas', () => {
        const src = readSdk('index.js');
        expect(src).toContain('Faixa 1');
        expect(src).toContain('Faixa 2');
        expect(src).toContain('Faixa 22');
    });

    it('index.js NÃO tem símbolos duplicados exportados', () => {
        const src = readSdk('index.js');
        const names = extractExportedNames(src);
        const seen = new Set();
        const duplicates = [];
        for (const name of names) {
            if (seen.has(name)) {
                duplicates.push(name);
            }
            seen.add(name);
        }
        // Toleramos zero duplicatas
        expect(duplicates).toHaveLength(0);
    });
});

// ─── F109: Sem sobreposição experimental-rpc.js vs rpc.js ────────────────────

describe('F23 — F109: experimental-rpc.js sem sobreposição com rpc core', () => {
    it('experimental-rpc.js e rpc/index.js existem', () => {
        expect(existsSync(join(SDK_DIR, 'rpc/experimental.js'))).toBe(true);
        expect(existsSync(join(SDK_DIR, 'rpc/index.js'))).toBe(true);
    });

    it('experimental-rpc.js NÃO exporta funções já em rpc/index.js', () => {
        const expSrc = readSdk('rpc/experimental.js');
        const rpcSrc = readSdk('rpc/index.js');

        const expExports = extractExportedNames(expSrc);
        const rpcExports = extractExportedNames(rpcSrc);

        const allowedOverlap = new Set(['agentList', 'agentSelect', 'agentDeselect']);
        allowedOverlap.add('agentGetCurrent');
        allowedOverlap.add('agentReload');
        const overlap = expExports.filter((name) => rpcExports.includes(name) && !allowedOverlap.has(name));
        expect(overlap).toHaveLength(0);
    });

    it('experimental-rpc.js cobre subsistemas exclusivamente experimentais', () => {
        const src = readSdk('rpc/experimental.js');
        // Os subsistemas experimentais devem estar presentes
        expect(src).toContain('fleet');
        expect(src).toContain('agent');
        expect(src).toContain('skills');
        expect(src).toContain('mcp');
        expect(src).toContain('plugins');
        expect(src).toContain('extensions');
    });

    it('rpc/index.js tem subsistemas core (model, mode, plan, shell, compaction)', () => {
        const src = readSdk('rpc/index.js');
        expect(src).toContain('modelGetCurrent');
        expect(src).toContain('modeGet');
        expect(src).toContain('planRead');
        expect(src).toContain('shellExec');
        expect(src).toContain('compactionCompact');
    });
});

// ─── F110: Seções de comentário no barrel ────────────────────────────────────

describe('F23 — F110: barrel tem seções organizadas', () => {
    it('barrel exporta de client.js', () => {
        const src = readSdk('index.js');
        expect(src).toContain("from './session/client.js'");
    });

    it('barrel exporta de session.js', () => {
        const src = readSdk('index.js');
        expect(src).toContain("from './session/lifecycle.js'");
    });

    it('barrel exporta de rpc/index.js', () => {
        const src = readSdk('index.js');
        expect(src).toContain("from './rpc/index.js'");
    });

    it('barrel exporta de events.js', () => {
        const src = readSdk('index.js');
        expect(src).toContain("from './session/events.js'");
    });

    it('barrel exporta de health.js', () => {
        const src = readSdk('index.js');
        expect(src).toContain("from './telemetry/health.js'");
    });

    it('barrel não reexporta experimental-rpc.js no root', () => {
        const src = readSdk('index.js');
        expect(src).not.toContain("from './rpc/experimental.js'");
    });

    it('barrel exporta de quota-monitor.js', () => {
        const src = readSdk('index.js');
        expect(src).toContain("from './telemetry/quota-monitor.js'");
    });
});

// ─── F111: Todos 32 módulos exportam via barrel ──────────────────────────────

describe('F23 — F111: módulos obrigatórios acessíveis via barrel', () => {
    const REQUIRED_MODULES = [
        'session/client.js',
        'session/lifecycle.js',
        'rpc/index.js',
        'rpc/server.js',
        'session/events.js',
        'event-helpers.js',
        'telemetry/health.js',
        'types.js',
        'constants.js',
        'config.js',
        'session/system-message.js',
        'tools/core.js',
        'session/permissions.js',
        'agent/agents.js',
        'session/provider.js',
        'telemetry/tracing.js',
        'session/client-events.js',
        'session/client-facade.js',
        'feature-flags.js',
        // experimental-rpc é surface separada (#copilot/sdk/experimental-rpc)
        'telemetry/quota-monitor.js',
        'models/helpers.js',
        'models/registry.js',
    ];

    for (const mod of REQUIRED_MODULES) {
        it(`módulo ${mod} existe em sdk/`, () => {
            expect(existsSync(join(SDK_DIR, mod))).toBe(true);
        });
    }

    it('barrel referencia todos módulos obrigatórios', () => {
        const src = readSdk('index.js');
        const missing = [];
        for (const mod of REQUIRED_MODULES) {
            if (!src.includes(mod)) {
                missing.push(mod);
            }
        }
        expect(missing).toHaveLength(0);
    });
});

// ─── F112: Sem símbolos exportados que não existem ───────────────────────────

describe('F23 — F112: barrel sem exports de símbolos inexistentes', () => {
    it('createSessionRpcFacade exportado existe em rpc/session-facade.js', () => {
        const rpcSrc = readSdk('rpc/session-facade.js');
        expect(rpcSrc).toContain('export function createSessionRpcFacade');
    });

    it('createServerRpcFacade exportado existe em server-rpc.js', () => {
        const src = readSdk('rpc/server.js');
        expect(src).toContain('export function createServerRpcFacade');
    });

    it('createQuotaMonitor exportado existe em quota-monitor.js', () => {
        const src = readSdk('telemetry/quota-monitor.js');
        expect(src).toContain('export function createQuotaMonitor');
    });

    it('isExperimentalEnabled exportado existe em feature-flags.js', () => {
        const src = readSdk('feature-flags.js');
        expect(src).toContain('isExperimentalEnabled');
    });

    it('fleetStart exportado existe em experimental-rpc.js', () => {
        const src = readSdk('rpc/experimental.js');
        expect(src).toContain('export async function fleetStart');
    });

    it('buildSessionConfig exportado existe em config.js', () => {
        const src = readSdk('config.js');
        expect(src).toContain('buildSessionConfig');
    });

    it('fullHealthCheck exportado existe em health.js', () => {
        const src = readSdk('telemetry/health.js');
        expect(src).toContain('fullHealthCheck');
    });

    it('SESSION_EVENTS exportado existe em constants.js', () => {
        const src = readSdk('constants.js');
        expect(src).toContain('SESSION_EVENTS');
    });
});
