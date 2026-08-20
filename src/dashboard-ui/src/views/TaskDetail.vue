<script setup lang="ts">
import Badge from '@/components/ui/Badge.vue';
import Button from '@/components/ui/Button.vue';
import Card from '@/components/ui/Card.vue';
import Input from '@/components/ui/Input.vue';
import { confirmTwoStepAction, requireReason } from '@/lib/command_guard';
import { formatHttpError, http } from '@/lib/http';
import { useMissionsVNextStore } from '@/stores/missions_vnext';
import { useTasksVNextStore } from '@/stores/tasks_vnext';
import type { BadgeVariant, DashboardTask } from '@/types/dashboard';
import { computed, defineAsyncComponent, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';

const VisGraph = defineAsyncComponent(() => import('@/components/graphs/VisGraph.vue'));

const route = useRoute();
const router = useRouter();
const tasksStore = useTasksVNextStore();
const missionsStore = useMissionsVNextStore();

const taskId = computed(() => String(route.params['id'] || ''));

const loading = ref(false);
const error = ref<string | null>(null);
const tab = ref('resumo'); // resumo|attempts|artifacts|eventos|deps|json

interface TaskDetailPayload {
    task?: DashboardTask;
    attempts?: Array<{
        id: string;
        status?: string;
        created_at_ms?: number;
        ended_at_ms?: number;
        rendered_prompt_artifact_id?: string;
        response_text_artifact_id?: string;
        response_v2_json_artifact_id?: string;
        response_md_artifact_id?: string;
        response_html_artifact_id?: string;
        error?: string;
    }>;
    events?: Array<{
        id: string;
        actor_type?: string;
        actor_id?: string;
        ts_ms: number;
        event_type?: string;
        payload?: Record<string, unknown>;
    }>;
    dependencies?: Array<{ id: string; [key: string]: unknown }>;
    workflow?: { tasks?: DashboardTask[] };
    artifacts?: Array<{ id: string; kind?: string; mime?: string; size_bytes?: number }>;
    mission_context?: {
        mission?: { id: string; title?: string; status?: string; autonomy_mode?: string };
        counts?: { tasks_total?: number };
    };
    siblings?: DashboardTask[];
}

const detail = ref<TaskDetailPayload | null>(null);
const task = computed(() => detail.value?.task || null);
const attempts = computed(() => detail.value?.attempts || []);
const latestAttempt = computed(() => attempts.value[0] ?? null);
const events = computed(() => detail.value?.events || []);
const dependencies = computed(() => detail.value?.dependencies || []);
const workflow = computed(() => detail.value?.workflow?.tasks || []);
const artifacts = computed(() => detail.value?.artifacts || []);
const missionContext = computed(() => detail.value?.mission_context || null);
const siblingTasks = computed(() => detail.value?.siblings || []);
const commandReason = ref('');
const reassignMissionId = ref('');

// Formatted blocked_details for display — avoids complex inline expression in template
const formattedBlockedDetails = computed(() => {
    const d = task.value?.blocked_details;
    if (!d) return null;
    return typeof d === 'object' ? JSON.stringify(d, null, 2) : String(d);
});

// Quality score display — null-safe (overall_score may be absent)
const qualityScoreDisplay = computed(() => {
    const score = task.value?.state?.quality_metrics?.overall_score;
    if (score === null || score === undefined || !Number.isFinite(Number(score))) return null;
    return (Number(score) * 100).toFixed(0);
});
const qualityValidationPassed = computed(() => {
    return task.value?.state?.quality_metrics?.validation_passed ?? null;
});

const edit = ref({
    stage: 'READY',
    status: 'PENDING',
    target: 'auto',
    model: '',
    priority: 5,
    mission_id: '',
    system_message: '',
    user_message: '',
    execute_after_ms: null as number | null,
});

const depsText = ref('');
const jsonText = ref('');

function currentTaskVersion() {
    return task.value?.timestamps?.updated_at_ms || task.value?.updated_at_ms || null;
}

function statusVariant(status: string | undefined): BadgeVariant {
    const s = String(status || '').toUpperCase();
    if (s === 'RUNNING') return 'info';
    if (s === 'DONE') return 'success';
    if (s === 'FAILED') return 'error';
    if (s === 'PAUSED' || s === 'CANCELLED') return 'warning';
    if (s === 'BLOCKED') return 'warning';
    return 'default';
}

function resolveReason(defaultReason: string, errorMessage: string) {
    const typed = String(commandReason.value || '').trim();
    if (typed) return typed;
    if (typeof window !== 'undefined' && typeof window.prompt === 'function') {
        const prompted = String(
            window.prompt('Informe o motivo operacional para esta ação:', defaultReason) || '',
        ).trim();
        if (prompted) {
            commandReason.value = prompted;
            return prompted;
        }
    }
    return requireReason('', errorMessage);
}

async function fetchDetail() {
    if (!taskId.value) return;
    loading.value = true;
    error.value = null;
    try {
        const res = await http.get(`/api/dashboard/tasks/${taskId.value}`, {
            params: { include: 'attempts,events,dependencies,workflow,artifacts,mission_context,siblings' },
        });
        detail.value = res.data?.data || null;

        const t: Partial<DashboardTask> = detail.value?.task || {};
        edit.value = {
            stage: t.stage || 'READY',
            status: t.unified_status || t.state?.status || 'PENDING',
            target: t.spec?.target || 'auto',
            model: t.spec?.model || '',
            priority: t.meta?.priority ?? 5,
            mission_id: t.meta?.mission_id || t.mission?.mission_id || '',
            system_message: t.spec?.payload?.system_message || '',
            user_message: t.spec?.payload?.user_message || '',
            execute_after_ms: null,
        };

        depsText.value = JSON.stringify((t.policy?.dependencies || []).map(String), null, 2);
        jsonText.value = JSON.stringify(t, null, 2);
        reassignMissionId.value = t.mission_ref?.id || t.meta?.mission_id || '';
    } catch (err) {
        error.value = formatHttpError(err).message;
    } finally {
        loading.value = false;
    }
}

async function saveBasics() {
    const reason = resolveReason('Edição manual da task no dashboard', 'Motivo obrigatório para salvar alterações.');
    if (!confirmTwoStepAction({ actionLabel: `TASK_PATCH (${taskId.value})`, reason })) {
        return;
    }
    const payload = {
        stage: edit.value.stage,
        status: edit.value.status,
        meta: {
            priority: Number(edit.value.priority) || 0,
        },
        spec: {
            target: edit.value.target,
            model: edit.value.model || undefined,
            payload: {
                system_message: edit.value.system_message || '',
                user_message: edit.value.user_message || '',
            },
        },
    };
    await tasksStore.patchTask(taskId.value, payload, reason, currentTaskVersion());
    await fetchDetail();
}

async function saveDependencies() {
    const reason = resolveReason(
        'Atualização de dependências da task',
        'Motivo obrigatório para atualizar dependências.',
    );
    if (!confirmTwoStepAction({ actionLabel: `TASK_PATCH.dependencies (${taskId.value})`, reason })) {
        return;
    }
    let deps = [];
    try {
        deps = JSON.parse(depsText.value || '[]');
    } catch (_) {
        alert('JSON de dependências inválido (use ["task-..."]).');
        return;
    }
    await tasksStore.setDependencies(taskId.value, deps, reason, currentTaskVersion());
    await fetchDetail();
}

async function saveJsonAdvanced() {
    const reason = resolveReason('Edição avançada (JSON) da task', 'Motivo obrigatório para edição avançada.');
    if (!confirmTwoStepAction({ actionLabel: `TASK_PATCH.advanced_json (${taskId.value})`, reason })) {
        return;
    }
    let obj = null;
    try {
        obj = JSON.parse(jsonText.value);
    } catch (_) {
        alert('JSON inválido');
        return;
    }
    await tasksStore.patchTask(taskId.value, obj, reason, currentTaskVersion());
    await fetchDetail();
}

async function action(actionName: string) {
    const reason = resolveReason(
        `Ação ${String(actionName).toUpperCase()} na task`,
        'Motivo obrigatório para comando de task.',
    );
    if (
        !confirmTwoStepAction({
            actionLabel: `TASK_${String(actionName).toUpperCase()} (${taskId.value})`,
            reason,
        })
    ) {
        return;
    }
    await tasksStore.taskAction(taskId.value, actionName, reason);
    await fetchDetail();
}

async function reassignMission() {
    if (!reassignMissionId.value) {
        alert('Selecione a missão destino.');
        return;
    }
    const reason = resolveReason(
        'Reatribuição manual da task para outra missão',
        'Motivo obrigatório para reatribuição de missão.',
    );
    if (
        !confirmTwoStepAction({
            actionLabel: `TASK_REASSIGN_MISSION (${taskId.value} -> ${reassignMissionId.value})`,
            reason,
        })
    ) {
        return;
    }
    await tasksStore.reassignTaskMission(taskId.value, reassignMissionId.value, reason, currentTaskVersion());
    await fetchDetail();
}

const depsGraphNodes = computed(() => {
    const t = task.value;
    if (!t?.id) return [];
    const nodes: Array<{ id: string; label: string; color: { background: string; border: string } }> = [];
    nodes.push({ id: t.id, label: `${t.id}\nSELF`, color: { background: '#1e3a8a', border: '#60a5fa' } });
    for (const d of dependencies.value) {
        nodes.push({ id: d.id, label: `${d.id}\nDEP`, color: { background: '#0f172a', border: '#334155' } });
    }
    return nodes;
});

const depsGraphEdges = computed(() => {
    const t = task.value;
    if (!t?.id) return [];
    return dependencies.value.map((d) => ({ from: d.id, to: t.id }));
});

onMounted(async () => {
    await Promise.all([missionsStore.fetchFirstPage({ limit: 200 }), fetchDetail()]);
});
watch(taskId, () => void fetchDetail());
</script>

<template>
    <div class="space-y-6">
        <div class="flex items-center justify-between">
            <div>
                <h1 class="text-2xl font-bold text-white">Tarefa</h1>
                <p class="text-sm text-slate-300 mt-1 font-mono">{{ taskId }}</p>
            </div>
            <div class="flex items-center gap-2">
                <Button variant="ghost" size="sm" @click="router.back()">Voltar</Button>
                <Button variant="secondary" size="sm" @click="fetchDetail" :disabled="loading">Atualizar</Button>
            </div>
        </div>

        <div v-if="error" class="p-4 rounded-xl border border-red-500/30 bg-red-950/30 text-red-200">
            {{ error }}
        </div>

        <div v-if="loading" class="text-slate-300">Carregando…</div>

        <div v-else-if="task" class="space-y-6">
            <Card>
                <template #header>
                    <div class="flex items-center justify-between gap-4">
                        <div class="min-w-0">
                            <div class="text-sm text-slate-400">Stage/Status/Target</div>
                            <div class="flex items-center gap-2 flex-wrap mt-1">
                                <Badge size="sm">{{ task.stage }}</Badge>
                                <Badge size="sm" :variant="statusVariant(task.unified_status)">{{
                                    task.unified_status
                                }}</Badge>
                                <Badge size="sm">{{ task.spec?.target }}</Badge>
                                <Badge size="sm">pri: {{ task.meta?.priority ?? 0 }}</Badge>
                                <Badge size="sm" v-if="task.mission_ref?.id">
                                    mission:
                                    <button
                                        class="font-mono underline-offset-2 hover:underline"
                                        @click.stop="router.push(`/missions/${task.mission_ref.id}`)"
                                    >
                                        {{ task.mission_ref.title || task.mission_ref.id }}
                                    </button>
                                </Badge>
                            </div>
                        </div>
                        <div class="flex items-center gap-2 flex-wrap justify-end">
                            <Button
                                v-if="task.command_caps?.can_pause"
                                variant="secondary"
                                size="sm"
                                @click="action('pause')"
                                >Pausar</Button
                            >
                            <Button
                                v-if="task.command_caps?.can_resume"
                                variant="secondary"
                                size="sm"
                                @click="action('resume')"
                                >Retomar</Button
                            >
                            <Button
                                v-if="task.command_caps?.can_unblock"
                                variant="secondary"
                                size="sm"
                                @click="action('unblock')"
                                >Desbloquear</Button
                            >
                            <Button
                                v-if="task.command_caps?.can_retry"
                                variant="ghost"
                                size="sm"
                                @click="action('retry')"
                                >Reexecutar</Button
                            >
                            <Button
                                v-if="task.command_caps?.can_cancel"
                                variant="danger"
                                size="sm"
                                @click="action('cancel')"
                                >Cancelar</Button
                            >
                        </div>
                    </div>
                </template>

                <div
                    class="text-sm text-slate-300 whitespace-pre-wrap bg-slate-950/40 border border-slate-800 rounded-lg p-3 font-mono"
                >
                    {{ task.spec?.payload?.user_message || '' }}
                </div>

                <!-- BLOCKED alert: explains why task is stuck and what to do -->
                <div
                    v-if="task.unified_status === 'BLOCKED' && task.blocked_reason"
                    class="mt-3 p-3 rounded-lg border border-amber-500/40 bg-amber-950/20 space-y-2"
                >
                    <div class="flex items-center gap-2">
                        <span class="text-amber-400 font-semibold text-sm">⚠ Task bloqueada</span>
                        <Badge size="sm" variant="warning">{{ task.blocked_reason }}</Badge>
                    </div>
                    <div
                        v-if="formattedBlockedDetails"
                        class="text-xs text-amber-300/80 font-mono whitespace-pre-wrap break-all"
                    >
                        {{ formattedBlockedDetails }}
                    </div>
                    <div class="text-xs text-slate-400">
                        Use <strong>Desbloquear</strong> para retomar, ou <strong>Reexecutar</strong> para nova
                        tentativa.
                    </div>
                </div>

                <!-- last_error: only show when task is failed/blocked and has an error message -->
                <div
                    v-if="task.last_error && ['FAILED', 'BLOCKED', 'CANCELLED'].includes(task.unified_status ?? '')"
                    class="mt-3 p-3 rounded-lg border border-red-500/30 bg-red-950/20"
                >
                    <div class="text-xs text-red-400 font-semibold mb-1">Último erro</div>
                    <div class="text-xs text-red-300 font-mono whitespace-pre-wrap break-all">
                        {{ task.last_error }}
                    </div>
                </div>

                <!-- LLM response preview: show link to latest attempt response when task is DONE -->
                <div
                    v-if="
                        task.unified_status === 'DONE' &&
                        latestAttempt &&
                        (latestAttempt.response_text_artifact_id || latestAttempt.response_v2_json_artifact_id)
                    "
                    class="mt-3 p-3 rounded-lg border border-emerald-500/30 bg-emerald-950/20"
                >
                    <div class="flex items-center justify-between">
                        <div class="text-xs text-emerald-400 font-semibold">✓ Resposta da LLM disponível</div>
                        <div class="flex items-center gap-2">
                            <Button
                                v-if="latestAttempt?.response_text_artifact_id"
                                variant="ghost"
                                size="sm"
                                class="h-6 px-2 text-xs"
                                @click="router.push(`/artifacts/${latestAttempt.response_text_artifact_id}`)"
                                >Ver texto</Button
                            >
                            <Button
                                v-if="latestAttempt?.response_v2_json_artifact_id"
                                variant="ghost"
                                size="sm"
                                class="h-6 px-2 text-xs"
                                @click="router.push(`/artifacts/${latestAttempt.response_v2_json_artifact_id}`)"
                                >Ver JSON</Button
                            >
                            <Button variant="ghost" size="sm" class="h-6 px-2 text-xs" @click="tab = 'attempts'"
                                >Tentativas →</Button
                            >
                        </div>
                    </div>
                    <div
                        v-if="qualityScoreDisplay !== null"
                        class="mt-2 text-xs text-slate-400 flex items-center gap-3"
                    >
                        <span
                            >Score: <strong class="text-emerald-400">{{ qualityScoreDisplay }}%</strong></span
                        >
                        <span v-if="qualityValidationPassed !== null"
                            >Validação:
                            <strong :class="qualityValidationPassed ? 'text-emerald-400' : 'text-red-400'">{{
                                qualityValidationPassed ? 'Passou' : 'Falhou'
                            }}</strong></span
                        >
                    </div>
                </div>

                <div class="mt-3">
                    <label class="text-xs text-slate-400">Motivo operacional (audit trail)</label>
                    <Input v-model="commandReason" placeholder="Ex: consolidar escopo para missão do cliente A" />
                </div>
            </Card>

            <div class="flex items-center gap-2 flex-wrap">
                <Button size="sm" variant="ghost" @click="tab = 'resumo'" :disabled="tab === 'resumo'">Resumo</Button>
                <Button size="sm" variant="ghost" @click="tab = 'attempts'" :disabled="tab === 'attempts'"
                    >Tentativas</Button
                >
                <Button size="sm" variant="ghost" @click="tab = 'artifacts'" :disabled="tab === 'artifacts'"
                    >Artefatos</Button
                >
                <Button size="sm" variant="ghost" @click="tab = 'eventos'" :disabled="tab === 'eventos'"
                    >Eventos</Button
                >
                <Button size="sm" variant="ghost" @click="tab = 'deps'" :disabled="tab === 'deps'">Dependências</Button>
                <Button size="sm" variant="ghost" @click="tab = 'json'" :disabled="tab === 'json'"
                    >JSON avançado</Button
                >
            </div>

            <div v-if="tab === 'resumo'" class="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <Card>
                    <template #header><div class="text-sm font-semibold text-slate-200">Editar</div></template>
                    <div class="space-y-4">
                        <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
                            <div>
                                <label class="text-sm text-slate-300">Stage</label>
                                <select
                                    v-model="edit.stage"
                                    class="w-full px-3 py-2 rounded-lg bg-slate-900/60 border border-slate-700/50 text-slate-200"
                                >
                                    <option value="DRAFT">DRAFT</option>
                                    <option value="PROPOSED">PROPOSED</option>
                                    <option value="READY">READY</option>
                                    <option value="REJECTED">REJECTED</option>
                                    <option value="ARCHIVED">ARCHIVED</option>
                                </select>
                            </div>
                            <div>
                                <label class="text-sm text-slate-300">Status</label>
                                <select
                                    v-model="edit.status"
                                    class="w-full px-3 py-2 rounded-lg bg-slate-900/60 border border-slate-700/50 text-slate-200"
                                >
                                    <option value="PENDING">PENDING</option>
                                    <option value="PAUSED">PAUSED</option>
                                    <option value="CANCELLED">CANCELLED</option>
                                </select>
                            </div>
                        </div>
                        <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
                            <div>
                                <label class="text-sm text-slate-300">Target</label>
                                <select
                                    v-model="edit.target"
                                    class="w-full px-3 py-2 rounded-lg bg-slate-900/60 border border-slate-700/50 text-slate-200"
                                >
                                    <option value="auto">auto</option>
                                    <option value="chatgpt">chatgpt</option>
                                    <option value="gemini">gemini</option>
                                    <option value="claude">claude</option>
                                    <option value="ollama">ollama</option>
                                </select>
                            </div>
                            <div>
                                <label class="text-sm text-slate-300">Model</label>
                                <Input v-model="edit.model" placeholder="ex: gpt-4o" />
                            </div>
                            <div>
                                <label class="text-sm text-slate-300">Prioridade</label>
                                <input
                                    v-model.number="edit.priority"
                                    type="number"
                                    min="0"
                                    max="10"
                                    class="w-full px-3 py-2 rounded-lg bg-slate-900/60 border border-slate-700/50 text-slate-200"
                                />
                            </div>
                        </div>
                        <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
                            <div class="text-xs text-slate-400 md:col-span-2">
                                Reatribuição de missão é comando dedicado (`TASK_REASSIGN_MISSION`) e não faz parte do
                                patch genérico.
                            </div>
                        </div>
                        <div>
                            <label class="text-sm text-slate-300">System message</label>
                            <textarea
                                v-model="edit.system_message"
                                rows="2"
                                class="w-full px-3 py-2 rounded-lg bg-slate-900/60 border border-slate-700/50 text-slate-200"
                            />
                        </div>
                        <div>
                            <label class="text-sm text-slate-300">User message</label>
                            <textarea
                                v-model="edit.user_message"
                                rows="6"
                                class="w-full px-3 py-2 rounded-lg bg-slate-900/60 border border-slate-700/50 text-slate-200"
                            />
                        </div>
                        <div class="flex justify-end">
                            <Button
                                variant="primary"
                                size="sm"
                                @click="saveBasics"
                                :disabled="!task.command_caps?.can_patch"
                                >Salvar Task</Button
                            >
                        </div>
                    </div>
                </Card>

                <Card>
                    <template #header
                        ><div class="text-sm font-semibold text-slate-200">Contexto da Missão</div></template
                    >
                    <div v-if="missionContext?.mission" class="space-y-3">
                        <div class="text-sm text-slate-200">
                            <button
                                class="font-semibold text-sky-300 hover:underline"
                                @click="router.push(`/missions/${missionContext.mission.id}`)"
                            >
                                {{ missionContext.mission.title || missionContext.mission.id }}
                            </button>
                            <div class="text-xs text-slate-400 font-mono">
                                {{ missionContext.mission.id }} · {{ missionContext.mission.status }} ·
                                {{ missionContext.mission.autonomy_mode }}
                            </div>
                        </div>
                        <div class="text-xs text-slate-300">
                            Tasks na missão: {{ missionContext.counts?.tasks_total ?? 0 }}
                        </div>
                        <div class="space-y-2">
                            <label class="text-xs text-slate-400">Reatribuir para missão</label>
                            <select
                                v-model="reassignMissionId"
                                class="w-full px-3 py-2 rounded-lg bg-slate-900/60 border border-slate-700/50 text-slate-200"
                                :disabled="!task.command_caps?.can_reassign_mission"
                            >
                                <option value="">Selecione missão destino...</option>
                                <option v-for="m in missionsStore.items" :key="m.id" :value="m.id">
                                    {{ m.title || m.id }} ({{ m.status }})
                                </option>
                            </select>
                            <Button
                                variant="secondary"
                                size="sm"
                                @click="reassignMission"
                                :disabled="!task.command_caps?.can_reassign_mission"
                            >
                                Reatribuir Missão
                            </Button>
                        </div>
                        <div v-if="siblingTasks.length" class="pt-2">
                            <div class="text-xs text-slate-400 mb-2">Tasks irmãs na mesma missão</div>
                            <div class="space-y-1 max-h-44 overflow-auto">
                                <button
                                    v-for="s in siblingTasks"
                                    :key="s.id"
                                    class="w-full text-left text-xs font-mono text-slate-300 hover:text-sky-300"
                                    @click="router.push(`/tasks/${s.id}`)"
                                >
                                    {{ s.id }} · {{ s.unified_status }} · {{ s.stage }}
                                </button>
                            </div>
                        </div>
                    </div>
                    <div v-else class="text-sm text-slate-400">Task sem missão vinculada.</div>
                </Card>

                <Card>
                    <template #header><div class="text-sm font-semibold text-slate-200">Workflow</div></template>
                    <div v-if="workflow && workflow.length" class="space-y-2">
                        <div
                            v-for="t in workflow"
                            :key="t.id"
                            class="px-3 py-2 rounded-lg border border-slate-800 bg-slate-950/40 hover:bg-slate-900/40 cursor-pointer"
                            @click="router.push(`/tasks/${t.id}`)"
                        >
                            <div class="text-xs font-mono text-slate-200">{{ t.id }}</div>
                            <div class="text-xs text-slate-400 truncate">{{ t.spec_user_message_preview }}</div>
                        </div>
                        <div class="pt-2">
                            <Button
                                v-if="task.meta?.workflow_id"
                                variant="secondary"
                                size="sm"
                                @click="router.push(`/workflows/${task.meta.workflow_id}`)"
                            >
                                Abrir workflow
                            </Button>
                        </div>
                    </div>
                    <div v-else class="text-sm text-slate-400">Sem workflow associado.</div>
                </Card>
            </div>

            <div
                v-else-if="tab === 'attempts'"
                class="rounded-xl border border-slate-700/50 bg-slate-950/40 backdrop-blur-sm overflow-hidden"
            >
                <div v-if="attempts.length === 0" class="px-4 py-6 text-slate-400">Nenhuma tentativa registrada.</div>
                <div v-else class="divide-y divide-slate-800">
                    <div v-for="a in attempts" :key="a.id" class="px-4 py-3 space-y-2">
                        <div class="flex items-center justify-between gap-4">
                            <div class="text-sm font-mono text-slate-200">{{ a.id }}</div>
                            <Badge size="sm" :variant="statusVariant(a.status)">{{ a.status }}</Badge>
                        </div>
                        <div class="text-xs text-slate-400">
                            criado: {{ a.created_at_ms ? new Date(a.created_at_ms).toLocaleString() : '-' }} · ended:
                            {{ a.ended_at_ms ? new Date(a.ended_at_ms).toLocaleString() : '-' }}
                        </div>
                        <div class="flex items-center gap-2 flex-wrap">
                            <Button
                                v-if="a.rendered_prompt_artifact_id"
                                variant="ghost"
                                size="sm"
                                class="h-7 px-2 text-xs"
                                @click="router.push(`/artifacts/${a.rendered_prompt_artifact_id}`)"
                            >
                                Prompt renderizado
                            </Button>
                            <Button
                                v-if="a.response_text_artifact_id"
                                variant="ghost"
                                size="sm"
                                class="h-7 px-2 text-xs"
                                @click="router.push(`/artifacts/${a.response_text_artifact_id}`)"
                            >
                                Resposta (txt)
                            </Button>
                            <Button
                                v-if="a.response_v2_json_artifact_id"
                                variant="ghost"
                                size="sm"
                                class="h-7 px-2 text-xs"
                                @click="router.push(`/artifacts/${a.response_v2_json_artifact_id}`)"
                            >
                                Resposta (json)
                            </Button>
                            <Button
                                v-if="a.response_md_artifact_id"
                                variant="ghost"
                                size="sm"
                                class="h-7 px-2 text-xs"
                                @click="router.push(`/artifacts/${a.response_md_artifact_id}`)"
                            >
                                Resposta (md)
                            </Button>
                            <Button
                                v-if="a.response_html_artifact_id"
                                variant="ghost"
                                size="sm"
                                class="h-7 px-2 text-xs"
                                @click="router.push(`/artifacts/${a.response_html_artifact_id}`)"
                            >
                                Resposta (html)
                            </Button>
                        </div>
                        <div
                            v-if="a.error"
                            class="text-xs text-red-200 bg-red-950/30 border border-red-500/30 rounded-lg p-2 whitespace-pre-wrap font-mono"
                        >
                            {{ a.error }}
                        </div>
                    </div>
                </div>
            </div>

            <div
                v-else-if="tab === 'artifacts'"
                class="rounded-xl border border-slate-700/50 bg-slate-950/40 backdrop-blur-sm overflow-hidden"
            >
                <div v-if="artifacts.length === 0" class="px-4 py-6 text-slate-400">Nenhum artefato listado.</div>
                <div v-else class="divide-y divide-slate-800">
                    <div
                        v-for="a in artifacts"
                        :key="a.id"
                        class="px-4 py-3 flex items-center justify-between gap-4 hover:bg-slate-900/40 cursor-pointer"
                        @click="router.push(`/artifacts/${a.id}`)"
                    >
                        <div class="min-w-0">
                            <div class="text-sm font-mono text-slate-200 truncate">{{ a.id }}</div>
                            <div class="text-xs text-slate-400 truncate">
                                {{ a.kind }} · {{ a.mime }} · {{ a.size_bytes }} bytes
                            </div>
                        </div>
                        <Badge size="sm">{{ a.kind }}</Badge>
                    </div>
                </div>
            </div>

            <div
                v-else-if="tab === 'eventos'"
                class="rounded-xl border border-slate-700/50 bg-slate-950/40 backdrop-blur-sm overflow-hidden"
            >
                <div v-if="events.length === 0" class="px-4 py-6 text-slate-400">Sem eventos.</div>
                <div v-else class="divide-y divide-slate-800">
                    <div v-for="e in events" :key="e.id" class="px-4 py-3">
                        <div class="flex items-center justify-between gap-4">
                            <div class="text-xs text-slate-400 font-mono truncate">
                                #{{ e.id }} · {{ e.actor_type }} · {{ e.actor_id || '-' }}
                            </div>
                            <div class="text-xs text-slate-500">{{ new Date(e.ts_ms).toLocaleString() }}</div>
                        </div>
                        <div class="text-sm text-slate-200 font-semibold">{{ e.event_type }}</div>
                        <pre
                            class="text-xs text-slate-300 bg-slate-950/50 border border-slate-800 rounded-lg p-3 mt-2 overflow-auto max-h-56"
                            >{{ JSON.stringify(e.payload, null, 2) }}</pre
                        >
                    </div>
                </div>
            </div>

            <div v-else-if="tab === 'deps'" class="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <Card>
                    <template #header
                        ><div class="text-sm font-semibold text-slate-200">Editar dependências</div></template
                    >
                    <textarea
                        v-model="depsText"
                        rows="10"
                        class="w-full px-3 py-2 rounded-lg bg-slate-900/60 border border-slate-700/50 text-slate-200 font-mono text-xs"
                    />
                    <div class="flex justify-end mt-3">
                        <Button variant="primary" size="sm" @click="saveDependencies">Salvar deps</Button>
                    </div>
                    <div class="text-xs text-slate-400 mt-2">
                        Formato: <span class="font-mono">["task-...","task-..."]</span>
                    </div>
                </Card>
                <div class="space-y-3">
                    <VisGraph :nodes="depsGraphNodes" :edges="depsGraphEdges" height="480px" />
                    <Card>
                        <template #header
                            ><div class="text-sm font-semibold text-slate-200">Dependências atuais</div></template
                        >
                        <div v-if="dependencies.length === 0" class="text-sm text-slate-400">Nenhuma.</div>
                        <div v-else class="space-y-2">
                            <div
                                v-for="d in dependencies"
                                :key="d.id"
                                class="text-xs font-mono text-slate-200 cursor-pointer hover:underline"
                                @click="router.push(`/tasks/${d.id}`)"
                            >
                                {{ d.id }}
                            </div>
                        </div>
                    </Card>
                </div>
            </div>

            <div v-else-if="tab === 'json'" class="space-y-3">
                <Card>
                    <template #header
                        ><div class="text-sm font-semibold text-slate-200">JSON avançado (Task V5)</div></template
                    >
                    <textarea
                        v-model="jsonText"
                        rows="22"
                        class="w-full px-3 py-2 rounded-lg bg-slate-900/60 border border-slate-700/50 text-slate-200 font-mono text-xs"
                    />
                    <div class="flex justify-end mt-3">
                        <Button variant="primary" size="sm" @click="saveJsonAdvanced">Salvar JSON</Button>
                    </div>
                </Card>
            </div>
        </div>
    </div>
</template>
