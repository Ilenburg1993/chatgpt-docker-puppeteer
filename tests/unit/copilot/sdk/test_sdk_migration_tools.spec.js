/**
 * @file Faixa 18 — Testes de migração defineTool → createTool
 *
 *   Valida que todos os consumidores de tools usam `createTool` do SDK wrapper e que nenhum importa `defineTool`
 *   diretamente de `@github/copilot-sdk`.
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const ROOT = resolve(import.meta.dirname, '../../../../');
const SRC_COPILOT = join(ROOT, 'src/copilot');

/**
 * Lê o conteúdo de um arquivo e retorna como string.
 *
 * @param {string} relPath - Caminho relativo a src/copilot
 * @returns {string}
 */
function readSource(relPath) {
    return readFileSync(join(SRC_COPILOT, relPath), 'utf8');
}

// ---------------------------------------------------------------------------
// Arquivos migrados (11 consumidores)
// ---------------------------------------------------------------------------
const MIGRATED_FILES = [
    'tools/git/index.js',
    'tools/session-rpc-tools.js',
    'tools/session-tools.js',
    'tools/task-tools.js',
    'tools/shell/index.js',
    'tools/introspection-tools.js',
    'tools/todo/crud-tools.js',
    'tools/todo/query-tools.js',
    'tools/todo/bulk-tools.js',
    'tools/tool-factory.js',
    'bridges/mcp-tool-bridge.js',
];

// ---------------------------------------------------------------------------
// 1. Verificação estática de imports (sem execução de módulo)
// ---------------------------------------------------------------------------
describe('F18 — Migração defineTool → createTool (estática)', () => {
    describe('Nenhum consumidor importa defineTool de @github/copilot-sdk', () => {
        for (const file of MIGRATED_FILES) {
            it(`${file} NÃO importa defineTool de @github/copilot-sdk`, () => {
                const src = readSource(file);
                // Aceita menções em comentários/JSDoc; proíbe import real
                const importLines = src
                    .split('\n')
                    .filter((line) => /import\s.*defineTool/.test(line) && /@github\/copilot-sdk/.test(line));
                expect(importLines, `Import proibido encontrado em ${file}`).toHaveLength(0);
            });
        }
    });

    describe('Todos os consumidores importam createTool de #copilot/sdk (barrel ou tools.js)', () => {
        for (const file of MIGRATED_FILES) {
            it(`${file} importa createTool de #copilot/sdk`, () => {
                const src = readSource(file);
                const hasCreateToolImport = src
                    .split('\n')
                    .some((line) => /import\s.*createTool/.test(line) && /#copilot\/sdk/.test(line));
                expect(hasCreateToolImport, `Import de createTool não encontrado em ${file}`).toBe(true);
            });
        }
    });

    describe('Nenhum consumidor chama defineTool() no código', () => {
        for (const file of MIGRATED_FILES) {
            it(`${file} NÃO contém chamada defineTool(`, () => {
                const src = readSource(file);
                // Remove linhas de comentário (// e * ) para não dar falso positivo
                const codeLines = src
                    .split('\n')
                    .filter(
                        (line) =>
                            !line.trimStart().startsWith('//') &&
                            !line.trimStart().startsWith('*') &&
                            !line.trimStart().startsWith('/**'),
                    );
                const hasDefineToolCall = codeLines.some((line) => /defineTool\s*\(/.test(line));
                expect(hasDefineToolCall, `Chamada defineTool() encontrada em ${file}`).toBe(false);
            });
        }
    });

    describe('Todos os consumidores usam createTool() no código', () => {
        for (const file of MIGRATED_FILES) {
            it(`${file} contém chamada createTool(`, () => {
                const src = readSource(file);
                const hasCreateToolCall = src.split('\n').some((line) => /createTool\s*\(/.test(line));
                expect(hasCreateToolCall, `Chamada createTool() não encontrada em ${file}`).toBe(true);
            });
        }
    });
});

// ---------------------------------------------------------------------------
// 2. Verificação de que sdk/tools.js é o ponto canônico
// ---------------------------------------------------------------------------
describe('F18 — SDK tools.js permanece o wrapper canônico', () => {
    it('sdk/tools.js importa defineTool de @github/copilot-sdk', () => {
        const src = readSource('sdk/tools.js');
        const hasImport = src
            .split('\n')
            .some((line) => /import\s.*defineTool/.test(line) && /@github\/copilot-sdk/.test(line));
        expect(hasImport).toBe(true);
    });

    it('sdk/tools.js exporta createTool', () => {
        const src = readSource('sdk/tools.js');
        expect(src).toContain('export function createTool');
    });

    it('sdk/tools.js exporta createToolSync', () => {
        const src = readSource('sdk/tools.js');
        expect(src).toContain('export function createToolSync');
    });

    it('sdk/tools.js re-exporta defineTool para backward compat', () => {
        const src = readSource('sdk/tools.js');
        expect(src).toContain('export { defineTool }');
    });
});

// ---------------------------------------------------------------------------
// 3. Contagem de migração (sanity check)
// ---------------------------------------------------------------------------
describe('F18 — Contagem de migração', () => {
    it('Exatamente 11 arquivos consumidores foram migrados', () => {
        expect(MIGRATED_FILES).toHaveLength(11);
    });

    it('createTool é chamado 49 vezes nos consumidores', () => {
        let total = 0;
        for (const file of MIGRATED_FILES) {
            const src = readSource(file);
            const matches = src.match(/createTool\s*\(/g);
            total += matches ? matches.length : 0;
        }
        // 49 chamadas totais (mesmo número que defineTool antes da migração)
        expect(total).toBe(49);
    });

    it('createTool({ name: recebe string literal ou variável em cada chamada', () => {
        for (const file of MIGRATED_FILES) {
            const src = readSource(file);
            const calls = src.match(/createTool\s*\(\s*\{/g);
            if (!calls) continue;
            // Cada chamada deve ter { name: ou { name, como primeiro campo
            const namePattern = /createTool\s*\(\s*\{\s*name[:\s,]/g;
            const nameMatches = src.match(namePattern);
            expect(nameMatches?.length ?? 0, `${file}: todas as chamadas devem ter name: como primeiro campo`).toBe(
                calls.length,
            );
        }
    });
});
