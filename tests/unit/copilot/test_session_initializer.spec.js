// @ts-check
/**
 * tests/unit/copilot/test_session_initializer.spec.js
 *
 * Testes unitários para src/copilot/agent/session-initializer.js.
 *
 * Cobre:
 *
 * - G2-TEST-16: buildHookSystemContextSafe() com conteúdo > 8KB → resultado truncado com aviso
 * - buildHookSystemContextSafe() com conteúdo pequeno → sem truncamento
 * - buildHookSystemContext() lê session-briefing.md quando disponível
 */

import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'vitest';

// Mesmo path que session-initializer.js usa internamente:
// resolve(import.meta.dirname, '../../../../') relativo a src/copilot/agent/session/ = project root
const PROJECT_ROOT = resolve(import.meta.dirname, '../../../');
const ACTUAL_STATE_DIR = join(PROJECT_ROOT, '.github', 'hooks', 'state');
const BRIEFING_FILE = join(ACTUAL_STATE_DIR, 'session-briefing.md');
const SESSION_JSON_FILE = join(ACTUAL_STATE_DIR, 'session.json');

// Definir limite baixo para facilitar teste (default: 8KB, vamos usar 512 bytes para testar truncamento)
const SMALL_LIMIT = 512;
process.env.AGENT_HOOK_CONTEXT_MAX_BYTES = String(SMALL_LIMIT);

const { buildHookSystemContext, buildHookSystemContextSafe } =
    await import('../../../src/copilot/agent/session/initializer.js');

describe('session-initializer', () => {
    /** @type {string | null} */
    let _savedBriefing = null;
    /** @type {string | null} */
    let _savedSessionJson = null;

    beforeEach(() => {
        mkdirSync(ACTUAL_STATE_DIR, { recursive: true });
        // Salvar conteúdo original (se existir) para restaurar depois
        _savedBriefing = existsSync(BRIEFING_FILE) ? readFileSync(BRIEFING_FILE, 'utf8') : null;
        _savedSessionJson = existsSync(SESSION_JSON_FILE) ? readFileSync(SESSION_JSON_FILE, 'utf8') : null;
        // Remover session.json para isolar os testes
        if (existsSync(SESSION_JSON_FILE)) rmSync(SESSION_JSON_FILE);
    });

    afterEach(() => {
        // Restaurar estado anterior
        if (_savedBriefing !== null) {
            writeFileSync(BRIEFING_FILE, _savedBriefing, 'utf8');
        } else if (existsSync(BRIEFING_FILE)) {
            rmSync(BRIEFING_FILE);
        }
        if (_savedSessionJson !== null) {
            writeFileSync(SESSION_JSON_FILE, _savedSessionJson, 'utf8');
        } else if (existsSync(SESSION_JSON_FILE)) {
            rmSync(SESSION_JSON_FILE);
        }
    });

    // ---------------------------------------------------------------------------
    // buildHookSystemContext() — lê briefing
    // ---------------------------------------------------------------------------
    describe('buildHookSystemContext()', () => {
        it('retorna string com conteúdo do briefing quando arquivo existe', async () => {
            writeFileSync(BRIEFING_FILE, '# Test Briefing\nHello World', 'utf8');
            const result = await buildHookSystemContext();
            assert.ok(result.includes('Hello World'), 'deve conter o conteúdo do briefing');
            assert.ok(result.includes('Contexto da Sessão'), 'deve conter o header de contexto');
        });

        it('retorna string (possivelmente com stats runtime) quando nenhum arquivo state existe', async () => {
            if (existsSync(BRIEFING_FILE)) rmSync(BRIEFING_FILE);
            const result = await buildHookSystemContext();
            // Pode retornar string vazia ou com stats runtime (uptime, turns, tokens, TODOs)
            // — ambos são comportamentos válidos dependendo da versão
            assert.strictEqual(typeof result, 'string', 'deve retornar string');
        });
    });

    // ---------------------------------------------------------------------------
    // G2-TEST-16: buildHookSystemContextSafe() com conteúdo > limite
    // ---------------------------------------------------------------------------
    describe('buildHookSystemContextSafe() (G2-TEST-16)', () => {
        it('trunca conteúdo quando excede HOOK_CONTEXT_MAX_BYTES e inclui aviso', async () => {
            // Criar briefing grande (> SMALL_LIMIT = 512 bytes)
            const bigContent = 'A'.repeat(2000);
            writeFileSync(BRIEFING_FILE, bigContent, 'utf8');

            const result = await buildHookSystemContextSafe();

            // O resultado deve estar truncado
            assert.ok(
                Buffer.byteLength(result, 'utf8') <= SMALL_LIMIT + 200,
                'resultado deve ser aproximadamente do tamanho do limite + aviso de truncamento',
            );
            assert.ok(result.includes('contexto truncado'), 'deve conter aviso de truncamento');
        });

        it('não trunca conteúdo quando dentro do limite', async () => {
            const smallContent = 'B'.repeat(100);
            writeFileSync(BRIEFING_FILE, smallContent, 'utf8');

            const result = await buildHookSystemContextSafe();

            assert.ok(!result.includes('contexto truncado'), 'não deve conter aviso de truncamento');
            assert.ok(result.includes(smallContent), 'deve conter o conteúdo original');
        });

        it('truncamento preserva caracteres UTF-8 multibyte', async () => {
            // Caractere '中' ocupa 3 bytes em UTF-8
            const utf8Content = '中'.repeat(300); // 900 bytes > 512 limite
            writeFileSync(BRIEFING_FILE, utf8Content, 'utf8');

            const result = await buildHookSystemContextSafe();

            // Não deve conter replacement character (U+FFFD) — o truncamento é seguro
            assert.ok(!result.includes('\uFFFD'), 'não deve conter U+FFFD (caractere de substituição)');
            assert.ok(result.includes('contexto truncado'), 'deve estar truncado');
        });
    });
});
