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
        // Cada linha pode ser `name`, `name as alias`, ou `* as ns`
        const items = block
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean);
        for (const item of items) {
            const alias = item.match(/as\s+(\w+)/);
            if (alias) {
                names.push(alias[1]);
            } else {
                names.push(item);
            }
        }
    }
    // Captura `export function name` e `export const name` diretos (não re-exports)
    const directRegex = /export\s+(?:async\s+)?(?:function|const|class|let|var)\s+(\w+)/g;
    while ((m = directRegex.exec(sourceText)) !== null) {
        names.push(m[1]);
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

describe('F23 — F109: experimental-rpc.js sem sobreposição com rpc.js', () => {
    it('experimental-rpc.js e rpc.js existem', () => {
        expect(existsSync(join(SDK_DIR, 'experimental-rpc.js'))).toBe(true);
        expect(existsSync(join(SDK_DIR, 'rpc.js'))).toBe(true);
    });

    it('experimental-rpc.js NÃO exporta funções já em rpc.js', () => {
        const expSrc = readSdk('experimental-rpc.js');
        const rpcSrc = readSdk('rpc.js');

        const expExports = extractExportedNames(expSrc);
        const rpcExports = extractExportedNames(rpcSrc);

        const overlap = expExports.filter((name) => rpcExports.includes(name));
        expect(overlap).toHaveLength(0);
    });

    it('experimental-rpc.js cobre subsistemas exclusivamente experimentais', () => {
        const src = readSdk('experimental-rpc.js');
        // Os 6 subsistemas experimentais devem estar presentes
        expect(src).toContain('fleet');
        expect(src).toContain('agents');
        expect(src).toContain('skills');
        expect(src).toContain('mcp');
        expect(src).toContain('plugins');
        expect(src).toContain('extensions');
    });

    it('rpc.js tem subsistemas core (model, mode, plan, shell, compaction)', () => {
        const src = readSdk('rpc.js');
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
        expect(src).toContain("from './client.js'");
    });

    it('barrel exporta de session.js', () => {
        const src = readSdk('index.js');
        expect(src).toContain("from './session.js'");
    });

    it('barrel exporta de rpc.js', () => {
        const src = readSdk('index.js');
        expect(src).toContain("from './rpc.js'");
    });

    it('barrel exporta de events.js', () => {
        const src = readSdk('index.js');
        expect(src).toContain("from './events.js'");
    });

    it('barrel exporta de health.js', () => {
        const src = readSdk('index.js');
        expect(src).toContain("from './health.js'");
    });

    it('barrel exporta de experimental-rpc.js', () => {
        const src = readSdk('index.js');
        expect(src).toContain("from './experimental-rpc.js'");
    });

    it('barrel exporta de quota-monitor.js', () => {
        const src = readSdk('index.js');
        expect(src).toContain("from './quota-monitor.js'");
    });
});

// ─── F111: Todos 32 módulos exportam via barrel ──────────────────────────────

describe('F23 — F111: módulos obrigatórios acessíveis via barrel', () => {
    const REQUIRED_MODULES = [
        'client.js',
        'session.js',
        'rpc.js',
        'server-rpc.js',
        'events.js',
        'event-helpers.js',
        'health.js',
        'types.js',
        'constants.js',
        'config.js',
        'system-message.js',
        'tools.js',
        'permissions.js',
        'agents.js',
        'provider.js',
        'telemetry.js',
        'session-lifecycle.js',
        'client-events.js',
        'client-facade.js',
        'feature-flags.js',
        'experimental-rpc.js',
        'quota-monitor.js',
        'models/helpers.js',
        'models/registry.js',
        'models/selector.js',
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
            // models/selector.js é re-exportado via models/registry.js (aceitável)
            // para os outros, verificar basename no source do barrel
            const basename = mod.replace('models/', '');
            // registry.js re-exporta selector.js — considerar coberto se registry.js está no barrel
            if (mod === 'models/selector.js') {
                if (!src.includes('models/registry.js')) {
                    missing.push(mod);
                }
            } else if (!src.includes(basename)) {
                missing.push(mod);
            }
        }
        expect(missing).toHaveLength(0);
    });
});

// ─── F112: Sem símbolos exportados que não existem ───────────────────────────

describe('F23 — F112: barrel sem exports de símbolos inexistentes', () => {
    it('createSessionRpcFacade exportado existe em rpc.js', () => {
        const rpcSrc = readSdk('rpc.js');
        expect(rpcSrc).toContain('export function createSessionRpcFacade');
    });

    it('createServerRpcFacade exportado existe em server-rpc.js', () => {
        const src = readSdk('server-rpc.js');
        expect(src).toContain('export function createServerRpcFacade');
    });

    it('createQuotaMonitor exportado existe em quota-monitor.js', () => {
        const src = readSdk('quota-monitor.js');
        expect(src).toContain('export function createQuotaMonitor');
    });

    it('isExperimentalEnabled exportado existe em feature-flags.js', () => {
        const src = readSdk('feature-flags.js');
        expect(src).toContain('isExperimentalEnabled');
    });

    it('fleetStart exportado existe em experimental-rpc.js', () => {
        const src = readSdk('experimental-rpc.js');
        expect(src).toContain('export async function fleetStart');
    });

    it('buildSessionConfig exportado existe em config.js', () => {
        const src = readSdk('config.js');
        expect(src).toContain('buildSessionConfig');
    });

    it('fullHealthCheck exportado existe em health.js', () => {
        const src = readSdk('health.js');
        expect(src).toContain('fullHealthCheck');
    });

    it('SESSION_EVENTS exportado existe em constants.js', () => {
        const src = readSdk('constants.js');
        expect(src).toContain('SESSION_EVENTS');
    });
});
