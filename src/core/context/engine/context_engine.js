/* ==========================================================================
   src/core/context/engine/context_engine.js
   Audit Level: 100 — Ultimate Diamond (Cognitive Orchestrator)
   Status: CONSOLIDATED (Protocol 11 - Zero-Bug Tolerance)
   Responsabilidade: Orquestração da resolução de contexto, gestão de recursão
                     e aplicação de transformadores semânticos.
   Sincronizado com: io.js (V36), ref_parser.js (V1.0), budget_manager.js (V1.0).
========================================================================== */

const io = require('../../../infra/io');
const { parseReferences } = require('../parsing/ref_parser');
const { assertSafetyDepth } = require('../limits/guardrails');
const { BudgetManager } = require('../limits/budget_manager');
const { extractJsonByStack } = require('../extractors/json_logic');
const { extractCodeBlocks } = require('../extractors/code_logic');
const { smartTruncate } = require('../transformers/summary');
const { extractTaskMetadata } = require('../transformers/metadata');
const identity = require('../transformers/identity');
const { log } = require('../../logger');

/**
 * Pipeline de Transformação: Mapeia o token de transformação para a lógica real.
 */
async function applyTransform(content, transform, targetTask) {
    const type = (transform || 'RAW').toUpperCase();
    
    switch (type) {
        case 'SUMMARY': return smartTruncate(content, 2000);
        case 'JSON':    return extractJsonByStack(content);
        case 'CODE':    return extractCodeBlocks(content);
        case 'STATUS':
        case 'ERROR':
        case 'METRICS': return extractTaskMetadata(targetTask, type);
        case 'RAW':     return identity(content);
        default:        return identity(content);
    }
}

/**
 * resolveContext: O motor recursivo de resolução de referências.
 * @param {string} text - O prompt original com tags {{REF:...}}.
 * @param {object} currentTask - A tarefa que está sendo processada.
 * @param {AbortSignal} signal - Sinal para cancelamento imediato.
 * @param {number} depth - Nível atual de recursão.
 * @param {BudgetManager} budget - Gestor de volume de injeção.
 */
async function resolveContext(text, currentTask = null, signal = null, depth = 0, budget = null) {
    // 1. GUARDRAILS: Validação de segurança e aborto
    if (signal?.aborted) throw new Error('CONTEXT_RESOLUTION_ABORTED');
    assertSafetyDepth(depth);
    
    if (!text || !text.includes('{{REF:')) return text;

    // Inicializa o gestor de orçamento no nível 0 da recursão
    const currentBudget = budget || new BudgetManager();

    // 2. PARSING: Identifica todas as intenções de referência
    const refs = parseReferences(text);
    if (refs.length === 0) return text;

    let resolvedText = text;
    const projectId = currentTask?.meta?.project_id || 'default';

    for (const ref of refs) {
        // Check de aborto em cada iteração do loop para resposta imediata
        if (signal?.aborted) throw new Error('CONTEXT_RESOLUTION_ABORTED');

        try {
            // [FIX 3.4] Check de Orçamento Preventivo: 
            // Se não há mais espaço, nem tentamos buscar ou ler dados.
            if (currentBudget.getRemaining() <= 0) {
                resolvedText = resolvedText.split(ref.fullMatch).join(`[OVERFLOW]`);
                continue;
            }

            let targetTask = null;
            const criteria = ref.criteria;

            // 3. QUERY ENGINE: Localização da tarefa alvo (Busca O(1) em RAM)
            // [FIX 1.1] Ordem de Precedência: Padrões específicos antes de genéricos
            if (criteria === 'LAST') {
                targetTask = await io.findLast(projectId);
            } else if (criteria.startsWith('FIRST:TAG:')) {
                targetTask = await io.findFirstByTag(projectId, criteria.split(':')[2]);
            } else if (criteria.startsWith('TAG:')) {
                targetTask = await io.findLastByTag(projectId, criteria.split(':')[1]);
            } else {
                targetTask = await io.findById(criteria);
            }

            // 4. VALIDAÇÃO DE POSSE E EXISTÊNCIA
            if (!targetTask) {
                resolvedText = resolvedText.split(ref.fullMatch).join(`[REF_AUSENTE: ${criteria}]`);
                continue;
            }

            // Proteção contra auto-referência (Prevenção de paradoxo recursivo)
            if (currentTask && targetTask.meta?.id === currentTask.meta?.id) {
                resolvedText = resolvedText.split(ref.fullMatch).join(`[ERRO: AUTO_REFERENCIA]`);
                continue;
            }

            // 5. EXTRAÇÃO E TRANSFORMAÇÃO
            let injectedContent = "";

            // Caso A: Referência ao PROMPT original (Metadado da Spec)
            if (ref.transform === 'PROMPT') {
                injectedContent = targetTask.spec?.payload?.user_message || "";
            } 
            // Caso B: Referência ao RESULTADO (I/O de arquivo físico)
            else {
                // O io.loadResponse já respeita o sinal de aborto e o teto de 1MB
                const rawResponse = await io.loadResponse(targetTask.meta.id, signal);
                injectedContent = await applyTransform(rawResponse, ref.transform, targetTask);
            }

            // 6. BUDGET MANAGEMENT: Controle de volume final e truncamento
            if (!currentBudget.allocate(injectedContent.length)) {
                log('WARN', `Orçamento de contexto excedido para ${ref.criteria}. Aplicando truncamento.`);
                const remaining = currentBudget.getRemaining();
                injectedContent = injectedContent.slice(0, Math.max(0, remaining)) + "... [TRUNCATED]";
                currentBudget.allocate(injectedContent.length);
            }

            // Substituição atômica no texto (Literal Replacement)
            resolvedText = resolvedText.split(ref.fullMatch).join(injectedContent);

        } catch (err) {
            log('ERROR', `Falha ao resolver referência ${ref.fullMatch}: ${err.message}`);
            resolvedText = resolvedText.split(ref.fullMatch).join(`[ERRO_CONTEXTO]`);
        }
    }

    // 7. RECURSÃO: Resolve tags que possam ter vindo de dentro das referências injetadas
    return await resolveContext(resolvedText, currentTask, signal, depth + 1, currentBudget);
}

module.exports = { resolveContext };