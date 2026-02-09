// @ts-check - Type checking rigoroso habilitado (arquivo core)
import fs from 'node:fs/promises';
import { v4 as uuidv4 } from 'uuid';
import { log } from '#core/logger';
import * as schemas from '#core/schemas';
import { getDb } from '#infra/db/sqlite';
import { recordEvent } from '#infra/db/events_repo';
import { AUTONOMY_MODES, getMissionById } from '#infra/db/mission_repo';
import { insertTask, TASK_STAGES } from '#infra/db/task_repo';

function _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

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

function _pickTarget({ requested, allowedTargets } = {}) {
    const req = requested ? String(requested).toLowerCase().trim() : null;
    const allowed = Array.isArray(allowedTargets) ? allowedTargets.map(t => String(t).toLowerCase().trim()) : null;

    if (req && allowed && allowed.includes(req)) return req;
    if (req && !allowed) return req;
    if (allowed && allowed.length) return allowed[0];
    return 'auto';
}

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

class MissionPlannerProcessor {
    constructor({ intervalMs = 1500 } = {}) {
        this.intervalMs = Math.max(250, Number(intervalMs) || 1500);
        this._timer = null;
        this._running = false;
        this._stopped = false;
    }

    start() {
        if (this._timer) return;
        this._stopped = false;
        void this.tick();
        this._timer = setInterval(() => void this.tick(), this.intervalMs);
        log('INFO', `[MissionPlannerProcessor] started (interval=${this.intervalMs}ms)`);
    }

    stop() {
        this._stopped = true;
        if (this._timer) {
            clearInterval(this._timer);
            this._timer = null;
        }
        log('INFO', '[MissionPlannerProcessor] stopped');
    }

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

    async _processPlannerResult({ missionId, taskId }) {
        const mission = getMissionById(missionId);
        if (!mission) {
            return;
        }

        // Read full response text (best-effort).
        let text = '';
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
        const existingCount = db.prepare('SELECT COUNT(1) AS c FROM tasks WHERE mission_id = ?').get(missionId)?.c || 0;
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
            const target = _pickTarget({ requested: proposal?.target, allowedTargets: mission.policy?.allowed_targets });
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
                    dependencies: Array.isArray(proposal?.depends_on) ? proposal.depends_on.map(d => String(d)) : [],
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
    }
}

export { MissionPlannerProcessor };
