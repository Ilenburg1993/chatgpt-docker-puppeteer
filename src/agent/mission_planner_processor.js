// @ts-check - Type checking rigoroso habilitado (arquivo core)
import { log } from '#core/logger';
import * as schemas from '#core/schemas';
import { recordEvent } from '#infra/db/events_repo';
import { AUTONOMY_MODES, getMissionById } from '#infra/db/mission_repo';
import { getDb } from '#infra/db/sqlite';
import { insertTask, TASK_STAGES } from '#infra/db/task_repo';
import fs from 'node:fs/promises';
import { v4 as uuidv4 } from 'uuid';

/**
 * @typedef {object} MissionPlannerProcessorOptions
 * @property {number} [intervalMs=1500] - Intervalo em ms entre ticks do processador.
 */

/**
 * @typedef {object} PickTargetOptions
 * @property {string} [requested] - Target solicitado.
 * @property {string[]} [allowedTargets] - Targets permitidos.
 */

/**
 * @typedef {object} Mission
 * @property {string} id - ID da missão.
 * @property {string} title - Título da missão.
 * @property {string} description - Descrição da missão.
 * @property {string} status - Status da missão.
 * @property {string} autonomy_mode - Modo de autonomia.
 * @property {unknown} policy - Política da missão.
 * @property {unknown} context - Contexto da missão.
 * @property {string} created_at - Data de criação.
 * @property {string} updated_at - Data de atualização.
 * @property {string|null} started_at - Data de início.
 * @property {string|null} completed_at - Data de conclusão.
 */

/**
 * @typedef {object} ShouldAutoApproveOptions
 * @property {Mission} [mission] - Missão associada.
 * @property {string[]} [proposalTags=[]] - Tags da proposta.
 */

/**
 * @typedef {object} ProcessPlannerResultOptions
 * @property {string} missionId - ID da missão.
 * @property {string} taskId - ID da tarefa.
 */

/**
 * @typedef {object} Proposal
 * @property {string} user_message - Mensagem do usuário.
 * @property {string[]} [tags] - Tags da proposta.
 * @property {string} [target] - Target solicitado.
 * @property {number} [priority] - Prioridade da tarefa.
 * @property {string} [system_message] - Mensagem do sistema.
 * @property {string} [title] - Título da proposta.
 * @property {string[]} [depends_on] - Dependências.
 */

/**
 * Função utilitária para pausar execução por ms milissegundos.
 * @param {number} ms - Milissegundos para aguardar.
 * @returns {Promise<void>}
 */
function _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Extrai JSON de uma string de texto, tentando múltiplas estratégias.
 * @param {string} text - Texto contendo JSON.
 * @returns {Record<string, unknown> | null} - Objeto JSON extraído ou null se falhar.
 */
function _extractJson(text) {
    const raw = typeof text === 'string' ? text.trim() : '';
    if (!raw) return null;

    // 1) Direct JSON
    try {
        return JSON.parse(raw);
    } catch (_) {
        /* continue */
    }

    // 2) ```json ... ```
    const fence = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    if (fence && fence[1]) {
        try {
            return JSON.parse(fence[1].trim());
        } catch (_) {
            /* continue */
        }
    }

    // 3) Best-effort: first { ... last }
    const first = raw.indexOf('{');
    const last = raw.lastIndexOf('}');
    if (first >= 0 && last > first) {
        const slice = raw.slice(first, last + 1);
        try {
            return JSON.parse(slice);
        } catch (_) {
            /* ignore */
        }
    }

    return null;
}

/**
 * Seleciona o target apropriado baseado na solicitação e targets permitidos.
 * @param {PickTargetOptions} [options={}] - Opções para seleção de target.
 * @returns {string} - Target selecionado.
 */
function _pickTarget({ requested, allowedTargets } = {}) {
    const req = requested ? String(requested).toLowerCase().trim() : null;
    const allowed = Array.isArray(allowedTargets) ? allowedTargets.map(t => String(t).toLowerCase().trim()) : null;

    if (req && allowed && allowed.includes(req)) return req;
    if (req && !allowed) return req;
    if (allowed && allowed.length) return allowed[0];
    return 'auto';
}

/**
 * Verifica se uma proposta deve ser auto-aprovada baseado na missão e tags.
 * @param {ShouldAutoApproveOptions} options - Opções para verificação.
 * @returns {boolean} - True se deve auto-aprovar.
 */
function _shouldAutoApprove({ mission, proposalTags = [] } = {}) {
    if (!mission || mission.autonomy_mode !== AUTONOMY_MODES.LLM_AUTO_APPROVE_WITH_BUDGET) {
        return false;
    }

    const requireApprovalForTags = Array.isArray(mission.policy?.require_user_approval_for_tags)
        ? mission.policy.require_user_approval_for_tags.map(String)
        : [];

    if (requireApprovalForTags.length > 0) {
        for (const tag of proposalTags) {
            if (requireApprovalForTags.includes(String(tag))) {
                return false;
            }
        }
    }

    return true;
}

/**
 * Processador de missões que monitora tarefas do mission planner e gera novas tarefas baseadas em propostas.
 * Side-effects: Lê do banco de dados, registra eventos, insere novas tarefas.
 */
class MissionPlannerProcessor {
    /**
     * Cria uma instância do MissionPlannerProcessor.
     * @param {MissionPlannerProcessorOptions} [options={}] - Opções de configuração.
     */
    constructor({ intervalMs = 1500 } = {}) {
        this.intervalMs = Math.max(250, Number(intervalMs) || 1500);
        this._timer = null;
        this._running = false;
        this._stopped = false;
    }

    /**
     * Inicia o processador, configurando um timer para executar ticks periodicamente.
     * Side-effects: Inicia timer, registra log.
     */
    start() {
        if (this._timer) return;
        this._stopped = false;
        void this.tick();
        this._timer = setInterval(() => void this.tick(), this.intervalMs);
        log('INFO', `[MissionPlannerProcessor] started (interval=${this.intervalMs}ms)`);
    }

    /**
     * Para o processador, limpando o timer.
     * Side-effects: Para timer, registra log.
     */
    stop() {
        this._stopped = true;
        if (this._timer) {
            clearInterval(this._timer);
            this._timer = null;
        }
        log('INFO', '[MissionPlannerProcessor] stopped');
    }

    /**
     * Executa um tick do processador, processando tarefas do mission planner.
     * Side-effects: Lê do banco, registra eventos, processa resultados.
     * @returns {Promise<void>}
     */
    async tick() {
        if (this._stopped) return;
        if (this._running) return;
        this._running = true;

        try {
            const db = getDb();
            const rows = db
                .prepare(
                    `
                    SELECT id, mission_id, task_json, result_json, latest_attempt_id, updated_at_ms
                    FROM tasks
                    WHERE mission_id IS NOT NULL
                      AND stage = 'ARCHIVED'
                      AND status = 'DONE'
                    ORDER BY updated_at_ms DESC
                    LIMIT 50
                `
                )
                .all();

            for (const row of rows) {
                const taskId = row?.id;
                const missionId = row?.mission_id;
                if (!taskId || !missionId) continue;

                let task = null;
                try {
                    task = row?.task_json ? JSON.parse(row.task_json) : null;
                } catch (_) {
                    task = null;
                }

                const tags = Array.isArray(task?.meta?.tags) ? task.meta.tags : [];
                if (!tags.includes('mission_planner')) {
                    continue;
                }

                const dedupKey = `mission:${missionId}:planner_processed:${taskId}`;
                const firstTime = recordEvent({
                    entityType: 'mission',
                    entityId: missionId,
                    tsMs: Date.now(),
                    actorType: 'system',
                    eventType: 'MISSION_PLANNER_PROCESSED',
                    payload: { taskId },
                    dedupKey,
                });

                if (!firstTime) {
                    continue;
                }

                await this._processPlannerResult({ missionId, taskId });
                await _sleep(0);
            }
        } finally {
            this._running = false;
        }
    }

    /**
     * Processa o resultado de uma tarefa do mission planner, extraindo propostas e criando novas tarefas.
     * Side-effects: Lê arquivos, registra eventos, insere tarefas no banco.
     * @param {ProcessPlannerResultOptions} options - Opções com IDs da missão e tarefa.
     * @returns {Promise<void>}
     */
    async _processPlannerResult({ missionId, taskId }) {
        /** @type {Mission} */
        const mission = getMissionById(missionId);
        if (!mission) {
            return;
        }

        // Read full response text (best-effort).
        let text;
        try {
            const db = getDb();
            const row = db.prepare('SELECT result_json FROM tasks WHERE id = ?').get(taskId);
            const resultJson = row?.result_json ? String(row.result_json) : '';
            let parsed = null;
            try {
                parsed = resultJson ? JSON.parse(resultJson) : null;
            } catch (_) {
                parsed = null;
            }
            const textFile = parsed?.storage?.text_file || parsed?.storage?.textFile || null;
            if (textFile) {
                text = await fs.readFile(String(textFile), 'utf8');
            } else {
                text = '';
            }
        } catch (_) {
            text = '';
        }

        const parsed = _extractJson(text);
        if (!parsed || typeof parsed !== 'object') {
            recordEvent({
                entityType: 'mission',
                entityId: missionId,
                tsMs: Date.now(),
                actorType: 'system',
                eventType: 'MISSION_PLANNER_PARSE_FAILED',
                payload: { taskId },
                dedupKey: `mission:${missionId}:planner_parse_failed:${taskId}`,
            });
            return;
        }

        const proposals = Array.isArray(parsed.proposals) ? parsed.proposals : [];
        if (proposals.length === 0) {
            return;
        }

        const db = getDb();
        const maxTotal = Number(mission.policy?.max_tasks_total || 200) || 200;

        // Wrap count + inserts in a transaction to prevent budget overrun race
        const insertInTransaction = db.transaction(() => {
            const existingCount =
                db.prepare('SELECT COUNT(1) AS c FROM tasks WHERE mission_id = ?').get(missionId)?.c || 0;
            let remaining = Math.max(0, maxTotal - existingCount);
            if (remaining <= 0) {
                return;
            }

            const workflow = mission.context?.workflow || null;
            const nowIso = new Date().toISOString();

            for (const proposal of proposals) {
                if (remaining <= 0) break;

                const userMessage = typeof proposal?.user_message === 'string' ? proposal.user_message.trim() : '';
                if (!userMessage) continue;

                const proposalTags = Array.isArray(proposal?.tags) ? proposal.tags.map(t => String(t)) : [];

                const autoApprove = _shouldAutoApprove({ mission, proposalTags });
                const stage = autoApprove ? TASK_STAGES.READY : TASK_STAGES.PROPOSED;

                const taskIdNew = `task-${uuidv4()}`;
                const target = _pickTarget({
                    requested: proposal?.target,
                    allowedTargets: mission.policy?.allowed_targets,
                });
                const priority = Number.isFinite(Number(proposal?.priority)) ? Number(proposal.priority) : 5;

                const taskV5 = schemas.core.TaskSchemaV5.parse({
                    meta: {
                        id: taskIdNew,
                        version: '5.0',
                        created_at: nowIso,
                        priority,
                        source: 'self_generated',
                        mission_id: missionId,
                        workflow_id: workflow?.id || undefined,
                        tags: proposalTags,
                    },
                    spec: {
                        target,
                        payload: {
                            system_message: typeof proposal?.system_message === 'string' ? proposal.system_message : '',
                            user_message: userMessage,
                            context: {
                                proposal_title: typeof proposal?.title === 'string' ? proposal.title : undefined,
                                from_planner_task_id: taskId,
                            },
                        },
                    },
                    policy: {
                        dependencies: Array.isArray(proposal?.depends_on)
                            ? proposal.depends_on.map(d => String(d))
                            : [],
                        execute_after: null,
                    },
                    mission: {
                        mission_id: missionId,
                        step_id: null,
                        step_index: 0,
                        step_dependencies: [],
                        mission_context: mission.context?.mission_context || {},
                        is_checkpoint: false,
                    },
                    state: { status: 'PENDING' },
                    result: {},
                });

                insertTask(taskV5, { stage, status: 'PENDING', actor: 'llm' });
                remaining--;
            }
        });

        insertInTransaction();
    }
}

export { MissionPlannerProcessor };
