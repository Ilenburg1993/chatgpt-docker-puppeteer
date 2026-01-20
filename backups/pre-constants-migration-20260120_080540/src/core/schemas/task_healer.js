/* ==========================================================================
   src/core/schemas/task_healer.js
   Audit Level: 100 — Industrial Hardening (High-Performance Healing)
   Status: CONSOLIDATED (Protocol 11 - Zero-Bug Tolerance)
   Responsabilidade: Normalizar e curar objetos de tarefa, convertendo formatos
                     legados (V1/V2/V3) para o padrão estrito V4 Gold.
   Sincronizado com: task_schema.js (V1.1), shared_types.js (V1.1).
========================================================================== */

const { TaskSchema } = require('./task_schema');
const { log } = require('../logger');

/**
 * HEAL_TASK: O Motor de Normalização e Cura.
 * Transforma qualquer input bruto em uma estrutura V4 perfeita.
 *
 * @param {object} raw - Objeto bruto vindo da fila, API ou scripts.
 * @returns {object} Tarefa validada e curada conforme o Schema V4.
 */
function healTask(raw) {
    if (!raw || typeof raw !== 'object') {
        throw new Error('[HEALER] Input inválido: A tarefa deve ser um objeto.');
    }

    // 1. CONSTRUÇÃO ESTRUTURADA (Otimização de Performance - Fix 1.3)
    // Em vez de JSON.parse(JSON.stringify()), construímos a nova estrutura
    // preservando dados que já estejam no formato V4.
    const task = {
        meta: { ...raw.meta },
        spec: {
            ...raw.spec,
            payload: { ...raw.spec?.payload },
            parameters: { ...raw.spec?.parameters },
            validation: { ...raw.spec?.validation },
            config: { ...raw.spec?.config }
        },
        policy: { ...raw.policy },
        state: {
            ...raw.state,
            metrics: { ...raw.state?.metrics },
            history: Array.isArray(raw.state?.history) ? [...raw.state.history] : []
        },
        result: { ...raw.result }
    };

    // 2. ADAPTADOR DE LEGADO (Mapeamento de campos V1/V2/V3)

    // A. Migração de Prompt (user_message)
    // Se existe 'prompt' na raiz mas não na spec, movemos para o local correto.
    if (raw.prompt && !task.spec.payload.user_message) {
        task.spec.payload.user_message = raw.prompt;
    }

    // B. Migração de Prioridade
    if (raw.prioridade !== undefined && task.meta.priority === undefined) {
        task.meta.priority = Number(raw.prioridade);
    }

    // C. Migração e Sanitização de ID
    if (raw.id && !task.meta.id) {
        // Remove caracteres ilegais e garante compatibilidade com sistemas de arquivos
        task.meta.id = String(raw.id).replace(/[^a-zA-Z0-9._-]/g, '_');
    }

    // D. Migração de Status e Erros
    if (raw.status && !task.state.status) {
        task.state.status = raw.status;
    }
    if (raw.erro && !task.state.last_error) {
        task.state.last_error = raw.erro;
    }

    // E. Migração de Dependências
    if (raw.dependsOn && (!task.policy.dependencies || task.policy.dependencies.length === 0)) {
        task.policy.dependencies = Array.isArray(raw.dependsOn) ? raw.dependsOn : [raw.dependsOn];
    }

    // 3. VALIDAÇÃO E CURA ZOD FINAL
    // O Zod aplicará os valores padrão (defaults) definidos nos sub-schemas.
    try {
        return TaskSchema.parse(task);
    } catch (healErr) {
        // [FIX 1.1] Nomenclatura contextual para evitar shadowing
        log('ERROR', `[HEALER] Falha crítica na integridade da tarefa: ${healErr.message}`);
        throw healErr;
    }
}

module.exports = { healTask };
