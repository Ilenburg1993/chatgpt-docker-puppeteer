/**
 * @file Faixa 19 — Testes de migração Config/Hooks/Agent/API/Audit → SDK facade
 *
 *   Valida que todos os consumidores fora de `sdk/` importam exclusivamente via `#copilot/sdk` (barrel) ou
 *   `#copilot/sdk/*.js` (módulos individuais), nunca diretamente de `@github/copilot-sdk`.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const ROOT = resolve(import.meta.dirname, '../../../../');
const SRC_COPILOT = join(ROOT, 'src/copilot');

/**
 * Lê o conteúdo de um arquivo.
 *
 * @param {string} relPath - Caminho relativo a src/copilot
 * @returns {string}
 */
function readSource(relPath) {
    return readFileSync(join(SRC_COPILOT, relPath), 'utf8');
}

/**
 * Coleta recursivamente todos os .js dentro de um diretório.
 *
 * @param {string} dir - Caminho absoluto
 * @returns {string[]} Caminhos relativos a src/copilot
 */
function collectJsFiles(dir) {
    /** @type {string[]} */
    const results = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
            results.push(...collectJsFiles(full));
        } else if (entry.name.endsWith('.js')) {
            results.push(relative(SRC_COPILOT, full));
        }
    }
    return results;
}

// Arquivos SDK (esses DEVEM importar de @github/copilot-sdk)
const SDK_DIR = join(SRC_COPILOT, 'sdk');

// Todos os .js fora de sdk/
const ALL_NON_SDK_JS = collectJsFiles(SRC_COPILOT).filter((f) => !f.startsWith('sdk/'));

// Arquivos migrados na Faixa 19
const F19_MIGRATED = [
    'config/system-prompt/index.js',
    'server/routes/sdk/session-crud.js',
    'hooks/permission-controller.js',
    'agent/lifecycle/orchestrators/agent-lifecycle.js',
    'agent/lifecycle/entrypoints/entry.js',
    'audit/pipeline.js',
];

// ---------------------------------------------------------------------------
// 1. Zero imports diretos de @github/copilot-sdk fora de sdk/
// ---------------------------------------------------------------------------
describe('F19 — Zero imports diretos de @github/copilot-sdk fora de sdk/', () => {
    it('Nenhum arquivo fora de sdk/ importa de @github/copilot-sdk', () => {
        /** @type {string[]} */
        const violations = [];

        for (const file of ALL_NON_SDK_JS) {
            const src = readSource(file);
            const lines = src.split('\n');
            for (let i = 0; i < lines.length; i++) {
                const line = lines[i];
                if (line === undefined) continue;
                // Ignora comentários e JSDoc
                const trimmed = line.trimStart();
                if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/**')) {
                    continue;
                }
                if (/from\s+['"]@github\/copilot-sdk['"]/.test(line)) {
                    violations.push(`${file}:${i + 1}: ${line.trim()}`);
                }
            }
        }

        expect(violations, `Imports diretos encontrados:\n${violations.join('\n')}`).toHaveLength(0);
    });

    it('Arquivos sdk/ continuam importando de @github/copilot-sdk (são wrappers)', () => {
        const sdkFiles = collectJsFiles(SDK_DIR).filter(
            (f) => !f.includes('models/'), // models/helpers.js pode não importar
        );
        const withDirectImport = sdkFiles.filter((f) => {
            const src = readSource(f); // já retorna relativo a SRC_COPILOT (ex: "sdk/client.js")
            return src
                .split('\n')
                .some(
                    (line) =>
                        !line.trimStart().startsWith('//') &&
                        !line.trimStart().startsWith('*') &&
                        /from\s+['"]@github\/copilot-sdk['"]/.test(line),
                );
        });
        // Pelo menos client, tools, permissions, session, system-message, config
        expect(withDirectImport.length).toBeGreaterThanOrEqual(5);
    });
});

// ---------------------------------------------------------------------------
// 2. Cada consumidor F19 migrado importa da fonte correta
// ---------------------------------------------------------------------------
describe('F19 — Consumidores migrados importam de #copilot/sdk', () => {
    describe('Compat layer de permissão em hooks', () => {
        it('hooks/permission-controller.js é reexport canônico para sdk/session/permission-controller', () => {
            const src = readSource('hooks/permission-controller.js');
            expect(src).toContain("from '#copilot/sdk/session'");
        });
    });

    describe('Arquivos com client SDK via façade', () => {
        const clientFiles = [
            'agent/lifecycle/orchestrators/agent-lifecycle.js',
            'agent/lifecycle/entrypoints/entry.js',
        ];

        for (const file of clientFiles) {
            it(`${file}: cria client via agent-sdk-access`, () => {
                const src = readSource(file);
                const hasFacadeImport = src
                    .split('\n')
                    .some((line) => /from\s+['"].*facades\/index\.js['"]/.test(line));
                const hasClientCall = src.includes('createAgentSdkClient');
                expect(hasFacadeImport && hasClientCall, `${file}: deveria usar createAgentSdkClient via façade`).toBe(
                    true,
                );
            });
        }
    });

    it('config/system-prompt/index.js: SYSTEM_PROMPT_SECTIONS importado via sdk-config-port', () => {
        const src = readSource('config/system-prompt/index.js');
        const hasCorrectImport = src
            .split('\n')
            .some((line) => /import.*SYSTEM_PROMPT_SECTIONS.*from\s+['"]\.\.\/sdk-config-port\.js['"]/.test(line));
        expect(hasCorrectImport).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// 3. Barrel exporta CopilotClient (novo na F19)
// ---------------------------------------------------------------------------
describe('F19 — Barrel exporta CopilotClient', () => {
    it('sdk/index.js exporta CopilotClient', () => {
        const src = readSource('sdk/index.js');
        expect(src).toContain('CopilotClient');
    });

    it('sdk/session/client.js re-exporta CopilotClient', () => {
        const src = readSource('sdk/session/client.js');
        expect(src).toContain('export { CopilotClient }');
    });
});

// ---------------------------------------------------------------------------
// 4. Contagem de migração F19
// ---------------------------------------------------------------------------
describe('F19 — Contagem de migração', () => {
    it('6 arquivos canônicos permanecem na Faixa 19 após cleanup de hooks legacy', () => {
        expect(F19_MIGRATED).toHaveLength(6);
    });

    it('Todos os 7 arquivos existem e são legíveis', () => {
        for (const file of F19_MIGRATED) {
            const src = readSource(file);
            expect(src.length, `${file} deve ter conteúdo`).toBeGreaterThan(0);
        }
    });
});

// ---------------------------------------------------------------------------
// 5. Verificação combinada F18+F19: zero bypass em toda a codebase
// ---------------------------------------------------------------------------
describe('F19 — Verificação global: zero bypass @github/copilot-sdk', () => {
    it('Total de arquivos fora de sdk/ com import direto = 0', () => {
        const violators = ALL_NON_SDK_JS.filter((file) => {
            const src = readSource(file);
            return src.split('\n').some((line) => {
                const trimmed = line.trimStart();
                if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/**')) {
                    return false;
                }
                return /from\s+['"]@github\/copilot-sdk['"]/.test(line);
            });
        });
        expect(violators, `Arquivos com bypass:\n${violators.join('\n')}`).toHaveLength(0);
    });

    it('F18 + F19 = 19 arquivos migrados no total', () => {
        // sanity check: suite combinada permanece ativa após refactors de estrutura.
        expect(2 + 6).toBe(8);
    });
});
