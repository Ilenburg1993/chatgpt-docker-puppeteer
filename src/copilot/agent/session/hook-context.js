// @ts-check
/**
 * src/copilot/agent/session/hook-context.js
 *
 * Construção do contexto do hook system para injeção em sessões SDK.
 *
 * Centraliza a leitura de `session-briefing.md`, `session.json`, skills e estado runtime, com validação Zod e
 * sanitização anti-injection.
 *
 * Extraído de `initializer.js` (F58) para reduzir responsabilidade daquele módulo.
 *
 * @module copilot/agent/session/hook-context
 * @see module:copilot/agent/session/initializer
 */

import { log } from '#copilot/observability/logger';
import { defaultMetrics } from '#copilot/observability/metrics';
import { readStore as _readTodoStore } from '#copilot/tools/todo/store';
import { access, open, readdir, readFile, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { z } from 'zod';
import { safeJsonParse } from '../../core/safe-json.js';
import { HOOK_CONTEXT_MAX_BYTES as _HOOK_CONTEXT_MAX_BYTES } from '../config.js';

// ─── Paths ───────────────────────────────────────────────────────────────────

const PROJECT_ROOT = resolve(import.meta.dirname, '../../../../');
export const BRIEFING_FILE = join(PROJECT_ROOT, '.github', 'hooks', 'state', 'session-briefing.md');
export const SESSION_JSON_FILE = join(PROJECT_ROOT, '.github', 'hooks', 'state', 'session.json');

// ─── F5.1 (ARCH-01): Schema Zod para session.json ───────────────────────────

/**
 * Schema Zod para validação de session.json do hook system.
 *
 * Usa .passthrough() para tolerar campos adicionais de outras versões do hook.
 */
export const SessionJsonSchema = z
    .object({
        close_key: z
            .string()
            .regex(/^[a-zA-Z0-9_-]{1,64}$/)
            .optional(),
        strict_turn_close: z.boolean().optional(),
        current_turn: z
            .object({
                number: z.number().int().min(0),
            })
            .passthrough()
            .optional(),
        compliance: z
            .object({
                consecutive_unauthorized: z.number().int().min(0).max(9999),
            })
            .passthrough()
            .optional(),
    })
    .passthrough();

// ─── buildHookSystemContext ──────────────────────────────────────────────────

/**
 * Lê o session-briefing.md e session.json e constrói o conteúdo de systemMessage para injetar o contexto do hook system
 * em sessões SDK.
 *
 * Convertida para `async` para evitar bloqueio do event loop em I/O lento (ex.: containers Docker com volumes NFS).
 *
 * @returns {Promise<string>} Conteúdo markdown com contexto operacional do hook system
 */
export async function buildHookSystemContext() {
    const parts = [];

    try {
        await access(BRIEFING_FILE);
        // G2-SEC-02: verificar tamanho antes de readFile para evitar consumo de memória excessivo.
        // Limite: 16KB máximo antes de truncar na leitura.
        const SEC02_READ_LIMIT = 16 * 1024;
        const fileStat = await stat(BRIEFING_FILE);
        let content;
        if (fileStat.size > SEC02_READ_LIMIT) {
            log(
                'WARN',
                `[session-initializer] session-briefing.md excede limite (${fileStat.size} bytes > ${SEC02_READ_LIMIT}) — lendo apenas os primeiros ${SEC02_READ_LIMIT} bytes.`,
            );
            const fh = await open(BRIEFING_FILE, 'r');
            const buf = Buffer.alloc(SEC02_READ_LIMIT);
            await fh.read(buf, 0, SEC02_READ_LIMIT, 0);
            await fh.close();
            content =
                new TextDecoder('utf-8', { fatal: false }).decode(buf).replace(/\uFFFD+$/, '') +
                '\n\n⚠️ [briefing truncado: arquivo excede 16KB]';
        } else {
            content = await readFile(BRIEFING_FILE, 'utf8');
        }
        parts.push('## Contexto da Sessão (Hook System)\n\n' + content);
    } catch (/** @type {any} */ e) {
        log('DEBUG', `[hook-context] briefing indisponível: ${e?.code ?? e?.message ?? 'unknown'}`);
    }

    try {
        await access(SESSION_JSON_FILE);
        const raw = await readFile(SESSION_JSON_FILE, 'utf8');
        // F5.1 (ARCH-01): valida session.json com schema Zod para detectar corrupcao precocemente
        const jsonResult = safeJsonParse(raw, '[hook-context/session.json]');
        if (!jsonResult.ok) {
            log('WARN', `[hook-context] session.json corrompido (JSON inválido)`);
        }
        const parseResult = jsonResult.ok ? SessionJsonSchema.safeParse(jsonResult.data) : { success: false, error: null, data: null };
        if (jsonResult.ok && !parseResult.success) {
            log('WARN', `[session-manager] session.json com estrutura inválida: ${parseResult.error?.message}`);
        }
        const state = parseResult.success ? parseResult.data : (jsonResult.ok ? jsonResult.data : {});
        // SEC-VULN-03 (fix): validar e sanitizar todos os valores de session.json
        // antes de usá-los no system prompt para prevenir prompt injection
        const rawConsecutive = state?.compliance?.consecutive_unauthorized;
        const consecutive =
            typeof rawConsecutive === 'number' && Number.isFinite(rawConsecutive)
                ? Math.min(Math.max(0, Math.trunc(rawConsecutive)), 9999)
                : 0;
        const rawTurnNum = state?.current_turn?.number;
        const turnNum =
            typeof rawTurnNum === 'number' && Number.isFinite(rawTurnNum) ? Math.max(0, Math.trunc(rawTurnNum)) : 0;
        const rawCloseKey = state?.close_key ?? 'N/A';
        // SEC-N07 (fix): sanitizar close_key — limitar a alfanuméricos para evitar prompt injection
        const closeKey =
            typeof rawCloseKey === 'string' && /^[a-zA-Z0-9_-]{1,64}$/.test(rawCloseKey) ? rawCloseKey : 'INVALID_KEY';
        const strictClose =
            state?.strict_turn_close === true || state?.strict_turn_close === false ? state.strict_turn_close : true;
        parts.push(
            [
                '\n## Estado de Compliance Atual',
                `- Turno atual: #${turnNum}`,
                `- Consecutivos sem vscode_askQuestions: ${consecutive}`,
                // G2-SEC-03: close_key em bloco de código fenced para evitar que um valor
                // com caracteres markdown especiais seja interpretado como instrução ativa.
                `- close_key: \`\`${closeKey}\`\``,
                `- strict_turn_close: ${strictClose}`,
                '',
                '**Protocolo obrigatório**: Encerre cada turno com `vscode_askQuestions`.',
                'Não inicie task_complete sem chamar vscode_askQuestions antes.',
            ].join('\n'),
        );
    } catch (/** @type {any} */ e) {
        log('DEBUG', `[hook-context] session.json indisponível: ${e?.code ?? e?.message ?? 'unknown'}`);
    }

    // F5.3: skills disponíveis no diretório .github/skills/
    try {
        const skillsDir = join(resolve(import.meta.dirname, '../../'), '.github', 'skills');
        const entries = await readdir(skillsDir, { withFileTypes: true });
        const skillNames = entries
            .filter((e) => e.isDirectory())
            .map((e) => e.name)
            .sort();
        if (skillNames.length > 0) {
            parts.push('\n## Skills Disponíveis\n\n' + skillNames.map((s) => `- \`${s}\``).join('\n'));
        }
    } catch (/** @type {any} */ e) {
        log('DEBUG', `[hook-context] skills indisponíveis: ${e?.code ?? e?.message ?? 'unknown'}`);
    }

    // F5.2: estado runtime do agente SDK (in-memory, sem I/O de arquivo)
    try {
        const summary = defaultMetrics.getSummary();
        const uptimeSecs = Math.round(process.uptime());
        // Contagem de TODOs pendentes (best-effort — falha silenciosa)
        let pendingCount = 0;
        try {
            const todoStore = await _readTodoStore();
            pendingCount = Object.values(todoStore.tasks).filter(
                (t) => t.status === 'todo' || t.status === 'in_progress',
            ).length;
        } catch {
            /* ignorar */
        }
        parts.push(
            [
                '\n## Estado Runtime do Agente (LLM-B SDK)',
                `- Uptime do processo: ${uptimeSecs}s`,
                `- Turns SDK completados: ${summary.dialog.turnsTotal}`,
                `- Tokens acumulados (entrada+saída): ${summary.tokens.inputTokens + summary.tokens.outputTokens}`,
                `- TODOs ativos (todo/in_progress): ${pendingCount}`,
            ].join('\n'),
        );
    } catch (/** @type {any} */ e) {
        log('DEBUG', `[hook-context] estado runtime indisponível: ${e?.code ?? e?.message ?? 'unknown'}`);
    }

    return parts.join('\n\n');
}

// ─── buildHookSystemContextSafe ──────────────────────────────────────────────

// G2-DX-09: limite máximo de contexto configurável via env (default 8KB).
// SEC-02: previne injection de conteúdo grande via briefing
const HOOK_CONTEXT_MAX_BYTES = _HOOK_CONTEXT_MAX_BYTES;

/**
 * Constrói contexto do hook system com limite de tamanho aplicado.
 *
 * @returns {Promise<string>}
 */
export async function buildHookSystemContextSafe() {
    const raw = await buildHookSystemContext();
    if (Buffer.byteLength(raw, 'utf8') > HOOK_CONTEXT_MAX_BYTES) {
        // G1-BUG-08 (fix): usar TextDecoder com fatal=false para garantir que o truncamento em
        // limite de bytes não corta caracteres UTF-8 multibyte no meio, gerando strings inválidas.
        const bytes = Buffer.from(raw, 'utf8').subarray(0, HOOK_CONTEXT_MAX_BYTES);
        const truncated = new TextDecoder('utf-8', { fatal: false }).decode(bytes).replace(/\uFFFD+$/, '');
        return truncated + '\n\n⚠️ [contexto truncado por limite SEC-02: 8KB]';
    }
    return raw;
}
