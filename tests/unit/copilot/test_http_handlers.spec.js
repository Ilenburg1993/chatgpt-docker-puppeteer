// @ts-check
/**
 * tests/unit/copilot/test_http_handlers.spec.js
 *
 * Testes estruturais e de contrato para src/copilot/terminal/http-handlers.js
 *
 * Estratégia: análise estática do código-fonte (sem importar o módulo) para evitar a inicialização do SDK/SQLite via
 * singletons. Valida contratos de validação, exports, padrões de segurança e estrutura dos handlers.
 *
 * Cobre:
 *
 * - Exports públicos: todos os handlers esperados estão exportados
 * - handlePipeline: MAX_PIPELINE_STEPS, steps validation, ALLOWED_FROM
 * - handleInject: message validation, from field, context_files/attachments limits
 * - handleSetInfiniteSessionConfig: threshold validation (0.1–1.0)
 * - handleSetSkills: paths validation (string[])
 * - handleSetToolsConfig: allowlist/denylist validation
 * - handleRegisterCustomTool: name/description/handlerId validation (3 guards)
 * - handleDeleteCustomTool: name validation
 * - handleStoreMemory: content validation
 * - handleMetrics: Prometheus format
 * - Segurança: sem eval/Function, sem hardcoded secrets
 */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { before, describe, it } from 'node:test';

// ─── Source loading (sem import do módulo) ────────────────────────────────────

/** @type {string} */
let src = '';

before(async () => {
    src = await readFile(new URL('../../../src/copilot/terminal/http-handlers.js', import.meta.url), 'utf-8');
});

// ═══════════════════════════════════════════════════════════════════════════════
// Exports & Estrutura Geral
// ═══════════════════════════════════════════════════════════════════════════════

describe('http-handlers › exports & estrutura', () => {
    const expectedExports = [
        'handleHealth',
        'handleGetContext',
        'handleStoreMemory',
        'handleRecallMemories',
        'handleDeleteMemory',
        'handlePipeline',
        'handleInject',
        'handleGhIssues',
        'handleGhPrs',
        'handleGhCi',
        'handleGetConfig',
        'handleSetInfiniteSessionConfig',
        'handleGetSkills',
        'handleSetSkills',
        'handleGetToolsConfig',
        'handleSetToolsConfig',
        'handleGetCustomTools',
        'handleRegisterCustomTool',
        'handleDeleteCustomTool',
        'handleMetrics',
    ];

    for (const name of expectedExports) {
        it(`exporta ${name}`, () => {
            assert.match(src, new RegExp(`export\\s+(?:async\\s+)?function\\s+${name}\\b`));
        });
    }

    it('não usa eval nem Function()', () => {
        // Exclui comentários (linhas que começam com * ou //)
        const codeLines = src.split('\n').filter((l) => !l.trim().startsWith('*') && !l.trim().startsWith('//'));
        const code = codeLines.join('\n');
        assert.doesNotMatch(code, /\beval\s*\(/);
        assert.doesNotMatch(code, /\bnew\s+Function\s*\(/);
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// handlePipeline — contratos de validação
// ═══════════════════════════════════════════════════════════════════════════════

describe('http-handlers › handlePipeline contratos', () => {
    it('define MAX_PIPELINE_STEPS = 20', () => {
        assert.match(src, /MAX_PIPELINE_STEPS\s*=\s*20/);
    });

    it('valida Array.isArray(steps)', () => {
        assert.match(src, /Array\.isArray\(.*steps/);
    });

    it('valida steps.length === 0', () => {
        assert.match(src, /steps\.length\s*===?\s*0/);
    });

    it('valida steps.length > MAX_PIPELINE_STEPS', () => {
        assert.match(src, /steps\.length\s*>\s*MAX_PIPELINE_STEPS/);
    });

    it('retorna status 400 para steps inválidos', () => {
        // Extrai a função handlePipeline
        const fnMatch = src.match(/export\s+async\s+function\s+handlePipeline[\s\S]*?\n\}/);
        assert.ok(fnMatch, 'handlePipeline encontrado');
        assert.match(fnMatch[0], /status:\s*400/);
    });

    it('define ALLOWED_FROM como Set de strings válidas', () => {
        assert.match(src, /ALLOWED_FROM\s*=\s*new\s+Set\(/);
        assert.match(src, /'user'/);
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// handleInject — contratos de validação
// ═══════════════════════════════════════════════════════════════════════════════

describe('http-handlers › handleInject contratos', () => {
    it('valida message obrigatório', () => {
        // Extrai a função handleInject
        const fnMatch = src.match(/export\s+async\s+function\s+handleInject[\s\S]*?\n\}/);
        assert.ok(fnMatch, 'handleInject encontrado');
        const fn = fnMatch[0];
        assert.match(fn, /message/);
        assert.match(fn, /status:\s*400/);
    });

    it('valida message.trim()', () => {
        assert.match(src, /message.*\.trim\(\)/);
    });

    it('define MAX_EMBED_BYTES para limitar attachments', () => {
        assert.match(src, /MAX_EMBED_BYTES/);
    });

    it('valida context_files é array quando presente', () => {
        const fnMatch = src.match(/export\s+async\s+function\s+handleInject[\s\S]*?\n\}/);
        assert.ok(fnMatch);
        assert.match(fnMatch[0], /context_files/);
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// handleSetInfiniteSessionConfig — contratos de validação
// ═══════════════════════════════════════════════════════════════════════════════

describe('http-handlers › handleSetInfiniteSessionConfig contratos', () => {
    /** @type {string} */
    let fn = '';

    before(() => {
        const match = src.match(/export\s+function\s+handleSetInfiniteSessionConfig[\s\S]*?\n\}/);
        assert.ok(match, 'handler encontrado');
        fn = match[0];
    });

    it('valida threshold >= 0.1 e <= 1.0', () => {
        assert.match(fn, /0\.1/);
        assert.match(fn, /1\.0|1(?!\.\d)/);
    });

    it('rejeita threshold fora do range com 400', () => {
        assert.match(fn, /status:\s*400/);
    });

    it('valida typeof threshold === number', () => {
        assert.match(fn, /typeof.*backgroundCompactionThreshold.*!==?\s*'number'/);
    });

    it('retorna 200 e ok:true no path válido', () => {
        assert.match(fn, /status:\s*200/);
        assert.match(fn, /ok:\s*true/);
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// handleSetSkills — contratos de validação
// ═══════════════════════════════════════════════════════════════════════════════

describe('http-handlers › handleSetSkills contratos', () => {
    /** @type {string} */
    let fn = '';

    before(() => {
        const match = src.match(/export\s+function\s+handleSetSkills[\s\S]*?\n\}/);
        assert.ok(match, 'handler encontrado');
        fn = match[0];
    });

    it('valida Array.isArray(paths)', () => {
        assert.match(fn, /Array\.isArray/);
    });

    it('valida some(p => typeof p !== string)', () => {
        assert.match(fn, /\.some\(/);
        assert.match(fn, /typeof\s+\w+\s*!==?\s*'string'/);
    });

    it('retorna 400 para paths inválido', () => {
        assert.match(fn, /status:\s*400/);
    });

    it('retorna 200 para paths válido', () => {
        assert.match(fn, /status:\s*200/);
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// handleSetToolsConfig — contratos de validação
// ═══════════════════════════════════════════════════════════════════════════════

describe('http-handlers › handleSetToolsConfig contratos', () => {
    /** @type {string} */
    let fn = '';

    before(() => {
        const match = src.match(/export\s+function\s+handleSetToolsConfig[\s\S]*?\n\}/);
        assert.ok(match, 'handler encontrado');
        fn = match[0];
    });

    it('valida allowlist', () => {
        assert.match(fn, /allowlist/);
    });

    it('valida denylist', () => {
        assert.match(fn, /denylist/);
    });

    it('aceita null para ambas listas', () => {
        assert.match(fn, /!==\s*null|!= null/);
    });

    it('valida Array.isArray para listas', () => {
        assert.match(fn, /Array\.isArray/);
    });

    it('valida some() para rejeitar não-strings', () => {
        assert.match(fn, /\.some\(/);
    });

    it('retorna 400 e 200', () => {
        assert.match(fn, /status:\s*400/);
        assert.match(fn, /status:\s*200/);
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// handleRegisterCustomTool — contratos de validação
// ═══════════════════════════════════════════════════════════════════════════════

describe('http-handlers › handleRegisterCustomTool contratos', () => {
    /** @type {string} */
    let fn = '';

    before(() => {
        const match = src.match(/export\s+function\s+handleRegisterCustomTool[\s\S]*?\n\}/);
        assert.ok(match, 'handler encontrado');
        fn = match[0];
    });

    it('valida name (string obrigatório)', () => {
        assert.match(fn, /typeof\s+body\.name\s*!==?\s*'string'/);
    });

    it('valida description (string obrigatória)', () => {
        assert.match(fn, /typeof\s+body\.description\s*!==?\s*'string'/);
    });

    it('valida handlerId (string obrigatório)', () => {
        assert.match(fn, /typeof\s+body\.handlerId\s*!==?\s*'string'/);
    });

    it('retorna 400 para cada campo inválido', () => {
        // Deve ter pelo menos 3 returns com 400 (name, description, handlerId)
        const matches = fn.match(/status:\s*400/g);
        assert.ok(matches && matches.length >= 3, `Expected >=3 validation returns, got ${matches?.length}`);
    });

    it('retorna 201 com cors:true no sucesso', () => {
        assert.match(fn, /status:\s*201/);
        assert.match(fn, /cors:\s*true/);
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// handleDeleteCustomTool — contratos de validação
// ═══════════════════════════════════════════════════════════════════════════════

describe('http-handlers › handleDeleteCustomTool contratos', () => {
    it('valida name obrigatório', () => {
        const match = src.match(/export\s+function\s+handleDeleteCustomTool[\s\S]*?\n\}/);
        assert.ok(match, 'handler encontrado');
        assert.match(match[0], /!name/);
        assert.match(match[0], /status:\s*400/);
    });

    it('retorna 404 para tool não encontrada', () => {
        const match = src.match(/export\s+function\s+handleDeleteCustomTool[\s\S]*?\n\}/);
        assert.ok(match);
        assert.match(match[0], /status:\s*404/);
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// handleStoreMemory — contratos de validação
// ═══════════════════════════════════════════════════════════════════════════════

describe('http-handlers › handleStoreMemory contratos', () => {
    /** @type {string} */
    let fn = '';

    before(() => {
        const match = src.match(/export\s+function\s+handleStoreMemory[\s\S]*?\n\}/);
        assert.ok(match, 'handler encontrado');
        fn = match[0];
    });

    it('valida content obrigatório', () => {
        assert.match(fn, /body\?\.content|!body\.content/);
    });

    it('retorna 400 com mensagem sobre content', () => {
        assert.match(fn, /status:\s*400/);
        assert.match(fn, /content/i);
    });

    it('retorna 201 no sucesso', () => {
        assert.match(fn, /status:\s*201/);
    });

    it('default tag = geral', () => {
        assert.match(fn, /tag.*'geral'|"geral"/);
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// handleMetrics — formato Prometheus
// ═══════════════════════════════════════════════════════════════════════════════

describe('http-handlers › handleMetrics contratos', () => {
    /** @type {string} */
    let fn = '';

    before(() => {
        const match = src.match(/export\s+function\s+handleMetrics[\s\S]*?\n\}/);
        assert.ok(match, 'handler encontrado');
        fn = match[0];
    });

    it('gera métricas no formato Prometheus (# TYPE)', () => {
        assert.match(fn, /# TYPE/);
    });

    it('expõe llmb_agent_status', () => {
        assert.match(fn, /llmb_agent_status/);
    });

    it('expõe llmb_queue_size', () => {
        assert.match(fn, /llmb_queue_size/);
    });

    it('expõe llmb_send_count_total', () => {
        assert.match(fn, /llmb_send_count_total/);
    });

    it('expõe llmb_sse_clients', () => {
        assert.match(fn, /llmb_sse_clients/);
    });

    it('expõe llmb_context_tokens', () => {
        assert.match(fn, /llmb_context_tokens/);
    });

    it('retorna contentType text/plain', () => {
        assert.match(fn, /text\/plain/);
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Segurança
// ═══════════════════════════════════════════════════════════════════════════════

describe('http-handlers › segurança', () => {
    it('não contém secrets hardcoded', () => {
        const codeLines = src.split('\n').filter((l) => !l.trim().startsWith('*') && !l.trim().startsWith('//'));
        const code = codeLines.join('\n');
        assert.doesNotMatch(code, /password\s*=\s*['"][^'"]+['"]/i);
        assert.doesNotMatch(code, /secret\s*=\s*['"][^'"]+['"]/i);
        assert.doesNotMatch(code, /api[_-]?key\s*=\s*['"][^'"]+['"]/i);
    });

    it('não contém process.exit()', () => {
        assert.doesNotMatch(src, /process\.exit\s*\(/);
    });

    it('handlers de input retornam status numéricos válidos', () => {
        const statuses = [...src.matchAll(/status:\s*(\d+)/g)].map((m) => Number(m[1]));
        for (const s of statuses) {
            assert.ok(s >= 200 && s < 600, `status ${s} fora do range HTTP`);
        }
    });
});
