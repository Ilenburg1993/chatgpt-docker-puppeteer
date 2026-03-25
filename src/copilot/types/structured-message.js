// @ts-check
/**
 * src/copilot/types/structured-message.js
 *
 * Protocolo StructuredMessage — Sprint A (Structured Dialog Protocol)
 *
 * Define o schema canônico para comunicação estruturada entre LLM-A (GitHub Copilot orquestrador) e LLM-B (Copilot SDK
 * / gpt-4.1). Substituição progressiva de mensagens texto puro por envelopes JSON tipados, auditáveis e parseáveis por
 * ambos os lados.
 *
 * Funcionalidades:
 *
 * - Schema Zod com validação (parse + safeParse)
 * - Funções builder para LLM-A criar mensagens tipadas
 * - Parser de resposta LLM-B com fallback gracioso (texto puro → null)
 * - Serializador para envio via chat()
 * - Constantes de responseType e priority
 *
 * @module copilot/types/structured-message
 *
 * @example
 *     ```js
 *     import { buildStructuredRequest, parseStructuredResponse } from '#copilot/types/structured-message';
 *
 *     // LLM-A cria mensagem tipada
 *     const msg = buildStructuredRequest({
 *         context: 'Sprint A implementado. 1419 testes passando.',
 *         intent: 'Confirmar que todos os testes novos passam',
 *         priority: 'high',
 *         responseType: 'diagnostic',
 *     });
 *
 *     // Enviando
 *     const raw = await bridge.chat(serializeStructuredMessage(msg));
 *
 *     // Parseando resposta LLM-B
 *     const parsed = parseStructuredResponse(raw);
 *     if (parsed) {
 *         console.log('Diagnóstico:', parsed.output);
 *     }
 *     ```;
 */

import { z } from 'zod';

// ─── Constantes ───────────────────────────────────────────────────────────────

/**
 * Tipos de resposta suportados no protocolo StructuredMessage.
 *
 * @readonly
 * @enum {string}
 */
export const RESPONSE_TYPES = /** @type {const} */ ({
    /** Relatório de estado/saúde do sistema (testes, lint, erros) */
    diagnostic: 'diagnostic',
    /** Plano de ação, lista de sprints, estratégia */
    plan: 'plan',
    /** Código a implementar (retorna blocos ```js) */
    code: 'code',
    /** LLM-B precisa de mais informação de LLM-A */
    question: 'question',
    /** Confirmação de tarefa concluída com sucesso */
    confirmation: 'confirmation',
    /** Relatório de erro ou falha encontrada */
    error: 'error',
});

/**
 * Níveis de prioridade para mensagens StructuredMessage.
 *
 * @readonly
 * @enum {string}
 */
export const PRIORITY_LEVELS = /** @type {const} */ ({
    /** Informativo, sem urgência */
    low: 'low',
    /** Tarefa normal do fluxo de trabalho */
    medium: 'medium',
    /** Precisa de atenção imediata e resposta correta */
    high: 'high',
    /** Bloqueador crítico — responder antes de qualquer outra coisa */
    critical: 'critical',
});

// ─── Schema Zod ───────────────────────────────────────────────────────────────

/**
 * Schema Zod para validação de StructuredMessage.
 *
 * Versão 1.0 do protocolo — campos obrigatórios mínimos para comunicação LLM-A/LLM-B.
 */
export const StructuredMessageSchema = z.object({
    /** Versão do protocolo (para evolução futura) */
    version: z.string().default('1.0'),

    /** Resumo do estado atual ou briefing relevante */
    context: z.string().min(1, 'context é obrigatório'),

    /** Objetivo principal desta mensagem / o que LLM-B deve fazer */
    intent: z.string().min(1, 'intent é obrigatório'),

    /** Urgência da tarefa */
    priority: z.enum(['low', 'medium', 'high', 'critical']).default('medium'),

    /** Tipo de resposta esperado de LLM-B */
    responseType: z.enum(['diagnostic', 'plan', 'code', 'question', 'confirmation', 'error']),

    /** Conteúdo principal da mensagem ou resposta */
    output: z.string().optional(),

    /** ID da sessão LLM-B (preenchido automaticamente quando disponível) */
    sessionId: z.string().optional(),

    /** Número do turno na conversa (preenchido automaticamente) */
    turnNumber: z.number().int().min(0).optional(),

    /** Ferramentas usadas neste turno (preenchido por LLM-B na resposta) */
    toolsUsed: z.array(z.string()).optional(),

    /** Metadados extras livres para extensão futura */
    meta: z.record(z.string(), z.unknown()).optional(),
});

// ─── Tipos TypeScript/JSDoc ───────────────────────────────────────────────────

/**
 * Mensagem estruturada do protocolo LLM-A ↔ LLM-B.
 *
 * @typedef {Object} StructuredMessage
 * @property {string} [version] - Versão do protocolo (default: '1.0')
 * @property {string} context - Resumo do estado atual ou briefing relevante
 * @property {string} intent - Objetivo principal desta mensagem
 * @property {'low' | 'medium' | 'high' | 'critical'} [priority] - Urgência da tarefa (default: 'medium')
 * @property {'diagnostic' | 'plan' | 'code' | 'question' | 'confirmation' | 'error'} responseType - Tipo de resposta
 *   esperado
 * @property {string} [output] - Conteúdo principal da mensagem ou resposta
 * @property {string} [sessionId] - ID da sessão LLM-B
 * @property {number} [turnNumber] - Número do turno na conversa
 * @property {string[]} [toolsUsed] - Ferramentas usadas neste turno
 * @property {Record<string, unknown>} [meta] - Metadados extras
 */

/**
 * Input para criação de uma mensagem estruturada de request (LLM-A → LLM-B). `version`, `output`, `sessionId`,
 * `turnNumber`, `toolsUsed` são opcionais na criação.
 *
 * @typedef {Omit<StructuredMessage, 'version' | 'output' | 'sessionId' | 'turnNumber' | 'toolsUsed' | 'meta'> &
 *     Partial<Pick<StructuredMessage, 'version' | 'output' | 'sessionId' | 'turnNumber' | 'toolsUsed' | 'meta'>>} StructuredMessageInput
 */

/**
 * Resultado de um chatStructured().
 *
 * @typedef {Object} StructuredChatResult
 * @property {StructuredMessage | null} structured - Mensagem parseada da resposta (null se LLM-B respondeu texto puro)
 * @property {string} raw - Resposta bruta de LLM-B (sempre disponível)
 * @property {string} taskId - ID da tarefa Copilot SDK
 * @property {number} responseLen - Comprimento da resposta bruta
 * @property {string[]} chunks - Chunks coletados via streaming
 * @property {number} durationMs - Duração total em ms
 * @property {any} [parseError] - Erro ao parsear resposta estruturada (undefined quando bem-sucedido)
 */

// ─── Builders ─────────────────────────────────────────────────────────────────

/**
 * Cria uma mensagem StructuredMessage validada para envio de LLM-A → LLM-B.
 *
 * Aplica defaults: `version: '1.0'`, `priority: 'medium'`.
 *
 * @example
 *     ```js
 *     const msg = buildStructuredRequest({
 *         context: 'Sprint A implementado. 1419 testes.',
 *         intent: 'Confirmar que novos testes passam',
 *         priority: 'high',
 *         responseType: 'diagnostic',
 *     });
 *     ```;
 *
 * @param {StructuredMessageInput} input - Campos da mensagem
 * @returns {StructuredMessage} Mensagem validada e com defaults aplicados
 * @throws {z.ZodError} Se campos obrigatórios estiverem ausentes ou inválidos
 */
export function buildStructuredRequest(input) {
    return /** @type {StructuredMessage} */ (StructuredMessageSchema.parse(input));
}

/**
 * Cria uma resposta StructuredMessage (LLM-B → LLM-A) de forma tipada.
 *
 * @param {StructuredMessageInput & { output: string }} input - Campos da resposta (output obrigatório)
 * @returns {StructuredMessage} Mensagem de resposta validada
 * @throws {z.ZodError} Se campos inválidos
 */
export function buildStructuredResponse(input) {
    return /** @type {StructuredMessage} */ (StructuredMessageSchema.parse(input));
}

// ─── Serialização ─────────────────────────────────────────────────────────────

/**
 * Serializa uma StructuredMessage para string JSON para envio via bridge.chat().
 *
 * Inclui um prefixo de instrução para que LLM-B saiba responder em JSON.
 *
 * @param {StructuredMessage} msg - Mensagem a serializar
 * @param {{ includeInstruction?: boolean }} [opts] - Opções de serialização
 * @returns {string} String a ser enviada via bridge.chat()
 */
export function serializeStructuredMessage(msg, opts = {}) {
    const { includeInstruction = true } = opts;
    const json = JSON.stringify(msg, null, 2);

    if (!includeInstruction) {
        return json;
    }

    return [
        'STRUCTURED_PROTOCOL_V1:',
        'Leia a mensagem JSON abaixo e responda EXCLUSIVAMENTE com um JSON válido',
        'no mesmo formato StructuredMessage (version, context, intent, priority,',
        'responseType, output). Sem texto fora do JSON.',
        '',
        json,
    ].join('\n');
}

// ─── Parser ───────────────────────────────────────────────────────────────────

/**
 * Tenta parsear a resposta bruta de LLM-B como StructuredMessage.
 *
 * Estratégias tentadas em ordem:
 *
 * 1. Parse direto do texto como JSON
 * 2. Extração de bloco `json ... ` do texto
 * 3. Busca por `{` e `}` para isolar JSON embutido em texto
 *
 * Retorna `null` se nenhuma estratégia funcionar — isso é um fallback gracioso, não um erro. LLM-B pode não ter
 * entendido que deve responder em JSON.
 *
 * @param {string} raw - Resposta bruta de LLM-B
 * @returns {StructuredMessage | null} Mensagem parseada, ou null se não for JSON válido
 */
export function parseStructuredResponse(raw) {
    if (!raw || typeof raw !== 'string') return null;

    // Estratégia 1: texto é JSON puro
    const trimmed = raw.trim();
    if (trimmed.startsWith('{')) {
        const result = _tryParseJson(trimmed);
        if (result) return result;
    }

    // Estratégia 2: bloco ```json ... ```
    const jsonBlockMatch = raw.match(/```json\s*\n([\s\S]*?)```/);
    if (jsonBlockMatch?.[1]) {
        const result = _tryParseJson(jsonBlockMatch[1].trim());
        if (result) return result;
    }

    // Estratégia 3: bloco ``` ... ``` (sem linguagem)
    const codeBlockMatch = raw.match(/```\s*\n([\s\S]*?)```/);
    if (codeBlockMatch?.[1]) {
        const candidate = codeBlockMatch[1].trim();
        if (candidate.startsWith('{')) {
            const result = _tryParseJson(candidate);
            if (result) return result;
        }
    }

    // Estratégia 4: JSON embutido em texto (busca { ... })
    const firstBrace = raw.indexOf('{');
    const lastBrace = raw.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
        const candidate = raw.slice(firstBrace, lastBrace + 1);
        const result = _tryParseJson(candidate);
        if (result) return result;
    }

    return null;
}

/**
 * Verifica se uma string é uma StructuredMessage válida (sem lançar exceção).
 *
 * @param {unknown} value - Valor a verificar
 * @returns {value is StructuredMessage} True se for StructuredMessage válida
 */
export function isStructuredMessage(value) {
    return StructuredMessageSchema.safeParse(value).success;
}

// ─── Helpers internos ─────────────────────────────────────────────────────────

/**
 * Tenta fazer parse de uma string JSON e validar como StructuredMessage.
 *
 * @private
 * @param {string} text - Texto JSON candidato
 * @returns {StructuredMessage | null} Mensagem validada ou null
 */
function _tryParseJson(text) {
    try {
        const obj = JSON.parse(text);
        const result = StructuredMessageSchema.safeParse(obj);
        return result.success ? /** @type {StructuredMessage} */ (result.data) : null;
    } catch {
        return null;
    }
}
