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
// Consumidores canônicos no estado atual
// ---------------------------------------------------------------------------
const SDK_DIRECT_CONSUMERS = ['tools/infra/tool-factory.js'];
const FACTORY_CONSUMERS = ['bridges/mcp-tool-bridge.js'];

// ---------------------------------------------------------------------------
// 1. Verificação estática de imports (sem execução de módulo)
// ---------------------------------------------------------------------------
describe('F18 — Migração defineTool → createTool (estática)', () => {
    describe('Nenhum consumidor importa defineTool de @github/copilot-sdk', () => {
        for (const file of [...SDK_DIRECT_CONSUMERS, ...FACTORY_CONSUMERS]) {
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

    describe('Consumidores diretos do SDK importam createTool de #copilot/sdk', () => {
        for (const file of SDK_DIRECT_CONSUMERS) {
            it(`${file} importa createTool de #copilot/sdk`, () => {
                const src = readSource(file);
                const hasCreateToolImport = src
                    .split('\n')
                    .some((line) => /import\s.*createTool/.test(line) && /#copilot\/sdk/.test(line));
                expect(hasCreateToolImport, `Import de createTool não encontrado em ${file}`).toBe(true);
            });
        }
    });

    describe('Consumidores migrados para a factory canônica importam buildTool local', () => {
        for (const file of FACTORY_CONSUMERS) {
            it(`${file} importa buildTool da factory canônica`, () => {
                const src = readSource(file);
                const hasBuildToolImport = src
                    .split('\n')
                    .some((line) => /import\s.*buildTool/.test(line) && /#copilot\/tools/.test(line));
                expect(hasBuildToolImport, `Import de buildTool não encontrado em ${file}`).toBe(true);
            });

            it(`${file} NÃO importa createTool diretamente de #copilot/sdk`, () => {
                const src = readSource(file);
                const hasCreateToolImport = src
                    .split('\n')
                    .some((line) => /import\s.*createTool/.test(line) && /#copilot\/sdk/.test(line));
                expect(hasCreateToolImport, `Import direto de createTool encontrado em ${file}`).toBe(false);
            });
        }
    });

    describe('Nenhum consumidor chama defineTool() no código', () => {
        for (const file of [...SDK_DIRECT_CONSUMERS, ...FACTORY_CONSUMERS]) {
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

    describe('Consumidores diretos usam createTool() e consumidores migrados usam buildTool()', () => {
        for (const file of SDK_DIRECT_CONSUMERS) {
            it(`${file} contém chamada createTool(`, () => {
                const src = readSource(file);
                const hasCreateToolCall = src.split('\n').some((line) => /createTool\s*\(/.test(line));
                expect(hasCreateToolCall, `Chamada createTool() não encontrada em ${file}`).toBe(true);
            });
        }

        for (const file of FACTORY_CONSUMERS) {
            it(`${file} contém chamada buildTool(`, () => {
                const src = readSource(file);
                const hasBuildToolCall = src.split('\n').some((line) => /buildTool(Fn)?\s*\(/.test(line));
                expect(hasBuildToolCall, `Chamada buildTool() não encontrada em ${file}`).toBe(true);
            });
        }
    });
});

// ---------------------------------------------------------------------------
// 2. Verificação de que sdk/tools.js é o ponto canônico
// ---------------------------------------------------------------------------
describe('F18 — SDK tools/core.js permanece o wrapper canônico', () => {
    it('sdk/tools/core.js importa defineTool de @github/copilot-sdk', () => {
        const src = readSource('sdk/tools/core.js');
        const hasImport = src
            .split('\n')
            .some((line) => /import\s.*defineTool/.test(line) && /@github\/copilot-sdk/.test(line));
        expect(hasImport).toBe(true);
    });

    it('sdk/tools/core.js exporta createTool', () => {
        const src = readSource('sdk/tools/core.js');
        expect(src).toContain('export function createTool');
    });

    it('sdk/tools/core.js exporta createToolSync', () => {
        const src = readSource('sdk/tools/core.js');
        expect(src).toContain('export function createToolSync');
    });

    it('sdk/tools/core.js re-exporta defineTool para backward compat', () => {
        const src = readSource('sdk/tools/core.js');
        expect(src).toMatch(/export\s*\{[^}]*\bdefineTool\b[^}]*\}/su);
    });
});

// ---------------------------------------------------------------------------
// 3. Contagem de migração (sanity check)
// ---------------------------------------------------------------------------
describe('F18 — Contagem de migração', () => {
    it('Exatamente 1 consumidor canônico usa createTool diretamente', () => {
        expect(SDK_DIRECT_CONSUMERS).toHaveLength(1);
    });

    it('Exatamente 1 consumidor canônico usa a factory buildTool', () => {
        expect(FACTORY_CONSUMERS).toHaveLength(1);
    });

    it('createTool é chamado ao menos 1 vez nos consumidores diretos', () => {
        let total = 0;
        for (const file of SDK_DIRECT_CONSUMERS) {
            const src = readSource(file);
            const matches = src.match(/createTool\s*\(/g);
            total += matches ? matches.length : 0;
        }
        expect(total).toBeGreaterThanOrEqual(1);
    });

    it('createTool({ name: recebe string literal ou variável em cada chamada', () => {
        for (const file of SDK_DIRECT_CONSUMERS) {
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
