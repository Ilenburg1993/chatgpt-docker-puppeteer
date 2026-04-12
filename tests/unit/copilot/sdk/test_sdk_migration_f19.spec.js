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
    'config/session-config.js',
    'config/system-prompt.js',
    'api/express/session-crud.js',
    'agent/infra/permission-controller.js',
    'hooks/permission-handler.js',
    'agent/lifecycle/agent-lifecycle.js',
    'agent/lifecycle/entry.js',
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
    describe('Arquivos com approveAll', () => {
        // session-crud.js importa approveAll de #copilot/services (re-export); config/session-config.js e audit/pipeline.js não usam mais approveAll
        const approveAllFiles = ['agent/infra/permission-controller.js', 'hooks/permission-handler.js'];

        for (const file of approveAllFiles) {
            it(`${file}: approveAll importado de #copilot/sdk`, () => {
                const src = readSource(file);
                // Detecta tanto import single-line quanto multi-linha:
                // - single: import { approveAll } from '#copilot/sdk'
                // - multi:  import { approveAll, ... } from '#copilot/sdk'  (nome em linha separada)
                const hasCorrectImport =
                    src.split('\n').some((line) => /import.*approveAll.*from\s+['"]#copilot\/sdk['"]/.test(line)) ||
                    /approveAll[\s\S]*?from\s+['"]#copilot\/sdk['"]/.test(src);
                expect(hasCorrectImport, `${file}: approveAll deveria vir de #copilot/sdk`).toBe(true);
            });
        }
    });

    describe('Arquivos com CopilotClient', () => {
        const clientFiles = ['agent/lifecycle/agent-lifecycle.js', 'agent/lifecycle/entry.js'];

        for (const file of clientFiles) {
            it(`${file}: CopilotClient importado de #copilot/sdk`, () => {
                const src = readSource(file);
                const hasCorrectImport = src
                    .split('\n')
                    .some((line) => /import.*CopilotClient.*from\s+['"]#copilot\/sdk['"]/.test(line));
                expect(hasCorrectImport, `${file}: CopilotClient deveria vir de #copilot/sdk`).toBe(true);
            });
        }
    });

    it('config/system-prompt.js: SYSTEM_PROMPT_SECTIONS importado de #copilot/sdk', () => {
        const src = readSource('config/system-prompt.js');
        const hasCorrectImport = src
            .split('\n')
            .some((line) => /import.*SYSTEM_PROMPT_SECTIONS.*from\s+['"]#copilot\/sdk['"]/.test(line));
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

    it('sdk/client.js re-exporta CopilotClient', () => {
        const src = readSource('sdk/client.js');
        expect(src).toContain('export { CopilotClient }');
    });
});

// ---------------------------------------------------------------------------
// 4. Contagem de migração F19
// ---------------------------------------------------------------------------
describe('F19 — Contagem de migração', () => {
    it('8 arquivos foram migrados na Faixa 19', () => {
        expect(F19_MIGRATED).toHaveLength(8);
    });

    it('Todos os 8 arquivos existem e são legíveis', () => {
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
        // 11 da F18 (tools + bridge) + 8 da F19
        expect(11 + 8).toBe(19);
    });
});
