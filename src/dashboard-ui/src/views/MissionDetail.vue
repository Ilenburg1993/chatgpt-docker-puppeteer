<script setup>
import { computed, defineAsyncComponent, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import Button from '@/components/ui/Button.vue';
import Badge from '@/components/ui/Badge.vue';
import Card from '@/components/ui/Card.vue';
import Input from '@/components/ui/Input.vue';
import Modal from '@/components/ui/Modal.vue';
import { useMissionsVNextStore } from '@/stores/missions_vnext';
import { useTasksVNextStore } from '@/stores/tasks_vnext';
import { confirmTwoStepAction, requireReason } from '@/lib/command_guard';

const VisGraph = defineAsyncComponent(() => import('@/components/graphs/VisGraph.vue'));

const route = useRoute();
const router = useRouter();
const missions = useMissionsVNextStore();
const tasks = useTasksVNextStore();

const missionId = computed(() => String(route.params.id || ''));

const loading = ref(false);
const error = ref(null);
const tab = ref('resumo'); // resumo|tasks|propostas|grafo|eventos|policy
const commandReason = ref('');

const showCreateTask = ref(false);
const creatingTask = ref(false);
const createTaskForm = ref({
    user_message: '',
    system_message: '',
    target: 'auto',
    model: '',
    priority: 5,
    stage: 'READY',
});

const editingMission = ref(false);
const editForm = ref({ title: '', description: '', autonomy_mode: 'USER_ONLY' });

const policyText = ref('');
const policyAutonomy = ref('USER_ONLY');

const mission = computed(() => missions.selected);
const proposals = computed(() => missions.selectedProposals || []);
const missionTasks = computed(() => missions.selectedTasks || []);
const graph = computed(() => missions.selectedGraph);
const missionEvents = computed(() => missions.selectedEvents || []);
const canEditMission = computed(() => {
    const status = String(mission.value?.status || '').toUpperCase();
    return status === 'PAUSED' || status === 'READY';
});

function resolveReason(defaultReason, errorMessage) {
    const typed = String(commandReason.value || '').trim();
    if (typed) return typed;
    if (typeof window !== 'undefined' && typeof window.prompt === 'function') {
        const prompted = String(window.prompt('Informe o motivo operacional para esta ação:', defaultReason) || '').trim();
        if (prompted) {
            commandReason.value = prompted;
            return prompted;
        }
    }
    return requireReason('', errorMessage);
}

function statusVariant(status) {
    const s = String(status || '').toUpperCase();
    if (s === 'RUNNING') return 'info';
    if (s === 'PAUSED') return 'warning';
    if (s === 'DONE') return 'success';
    if (s === 'FAILED') return 'error';
    if (s === 'CANCELLED') return 'warning';
    return 'default';
}

async function loadAll() {
    if (!missionId.value) return;
    loading.value = true;
    error.value = null;
    try {
        await missions.fetchDetail(missionId.value);
        await missions.fetchMissionProposals(missionId.value);
        await missions.fetchMissionTasks(missionId.value);
        await missions.fetchMissionGraph(missionId.value);
        await missions.fetchMissionEvents(missionId.value);

        editForm.value = {
            title: mission.value?.title || '',
            description: mission.value?.description || '',
            autonomy_mode: mission.value?.autonomy_mode || 'USER_ONLY',
        };

        policyAutonomy.value = mission.value?.autonomy_mode || 'USER_ONLY';
        policyText.value = JSON.stringify(mission.value?.policy || {}, null, 2);
    } catch (err) {
        error.value = err?.message || String(err);
    } finally {
        loading.value = false;
    }
}

async function executeMission() {
    const reason = resolveReason(
        'Execução da missão a partir do dashboard',
        'Motivo obrigatório para executar missão.'
    );
    if (!confirmTwoStepAction({ actionLabel: `MISSION_EXECUTE (${missionId.value})`, reason })) return;
    await missions.executeMission(missionId.value, {
        reason,
    });
    await loadAll();
}
async function pauseMission() {
    const reason = resolveReason(
        'Pausa da missão para intervenção humana',
        'Motivo obrigatório para pausar missão.'
    );
    if (!confirmTwoStepAction({ actionLabel: `MISSION_PAUSE (${missionId.value})`, reason })) return;
    await missions.pauseMission(missionId.value, {
        reason,
    });
    await loadAll();
}
async function resumeMission() {
    const reason = resolveReason(
        'Retomada da missão após intervenção humana',
        'Motivo obrigatório para retomar missão.'
    );
    if (!confirmTwoStepAction({ actionLabel: `MISSION_RESUME (${missionId.value})`, reason })) return;
    await missions.resumeMission(missionId.value, {
        reason,
    });
    await loadAll();
}
async function cancelMission() {
    const reason = resolveReason(
        'Cancelamento manual da missão por operador',
        'Motivo obrigatório para cancelar missão.'
    );
    if (!confirmTwoStepAction({ actionLabel: `MISSION_CANCEL (${missionId.value})`, reason })) return;
    await missions.cancelMission(missionId.value, {
        reason,
    });
    router.push('/missions');
}

async function saveMissionBasics() {
    if (!canEditMission.value) {
        alert('Pause a missão antes de editar. Edição livre é permitida apenas em READY/PAUSED.');
        return;
    }
    editingMission.value = true;
    try {
        const reason = resolveReason('Edição de metadados da missão', 'Motivo obrigatório para editar missão.');
        if (!confirmTwoStepAction({ actionLabel: `MISSION_PATCH (${missionId.value})`, reason })) return;
        await missions.patchMission(missionId.value, {
            title: editForm.value.title,
            description: editForm.value.description,
            autonomy_mode: editForm.value.autonomy_mode,
            reason,
        });
        await loadAll();
    } finally {
        editingMission.value = false;
    }
}

async function savePolicy() {
    if (!canEditMission.value) {
        alert('Pause a missão antes de alterar policy/autonomia.');
        return;
    }
    let policy = null;
    try {
        policy = policyText.value ? JSON.parse(policyText.value) : {};
    } catch (e) {
        alert('Policy JSON inválido');
        return;
    }
    const reason = resolveReason(
        'Atualização de policy/autonomia da missão',
        'Motivo obrigatório para atualizar policy.'
    );
    if (!confirmTwoStepAction({ actionLabel: `MISSION_SET_POLICY (${missionId.value})`, reason })) return;
    await missions.updatePolicy(missionId.value, {
        autonomy_mode: policyAutonomy.value,
        policy,
        reason,
    });
    await loadAll();
}

const selectedProposalIds = ref(new Set());
function toggleProposal(id) {
    const set = selectedProposalIds.value;
    if (set.has(id)) set.delete(id);
    else set.add(id);
}

async function bulkApproveProposals() {
    const ids = Array.from(selectedProposalIds.value);
    if (ids.length === 0) return;
    const reason = resolveReason(
        'Aprovação em lote de propostas da missão',
        'Motivo obrigatório para aprovar proposals.'
    );
    if (!confirmTwoStepAction({ actionLabel: `TASK_BULK_ACTION.approve (${ids.length})`, reason })) return;
    await tasks.bulkAction({ ids, action: 'approve', reason });
    selectedProposalIds.value = new Set();
    await loadAll();
}

async function bulkRejectProposals() {
    const ids = Array.from(selectedProposalIds.value);
    if (ids.length === 0) return;
    const reason = resolveReason(
        'Rejeição em lote de propostas da missão',
        'Motivo obrigatório para rejeitar proposals.'
    );
    if (!confirmTwoStepAction({ actionLabel: `TASK_BULK_ACTION.reject (${ids.length})`, reason })) return;
    await tasks.bulkAction({ ids, action: 'reject', reason });
    selectedProposalIds.value = new Set();
    await loadAll();
}

const graphNodes = computed(() => {
    const list = graph.value?.tasks || [];
    return list.map(t => ({
        id: t.id,
        label: `${t.id}\n${t.unified_status} · ${t.stage}`,
        title: t.spec_user_message_preview || '',
    }));
});
const graphEdges = computed(() => (graph.value?.edges || []).map(e => ({ from: e.depends_on_task_id, to: e.task_id })));

async function createTaskInMission() {
    if (!createTaskForm.value.user_message.trim()) return;
    creatingTask.value = true;
    try {
        const payload = {
            stage: createTaskForm.value.stage,
            meta: {
                mission_id: missionId.value,
                priority: Number(createTaskForm.value.priority) || 5,
            },
            spec: {
                target: createTaskForm.value.target,
                model: createTaskForm.value.model || undefined,
                payload: {
                    system_message: createTaskForm.value.system_message || '',
                    user_message: createTaskForm.value.user_message,
                },
            },
        };
        const reason = resolveReason(
            'Criação de task dentro da missão',
            'Motivo obrigatório para criar task na missão.'
        );
        if (!confirmTwoStepAction({ actionLabel: `TASK_CREATE (mission:${missionId.value})`, reason })) return;
        await tasks.createTask(payload, reason);
        showCreateTask.value = false;
        createTaskForm.value = { user_message: '', system_message: '', target: 'auto', model: '', priority: 5, stage: 'READY' };
        await loadAll();
    } finally {
        creatingTask.value = false;
    }
}

async function quickTaskAction(taskId, action) {
    const reason = resolveReason(
        `Ação ${String(action).toUpperCase()} na task ${taskId}`,
        'Motivo obrigatório para comando de task.'
    );
    if (
        !confirmTwoStepAction({
            actionLabel: `TASK_${String(action).toUpperCase()} (${taskId})`,
            reason,
        })
    ) {
        return;
    }
    await tasks.taskAction(taskId, action, reason);
    await loadAll();
}

onMounted(loadAll);
watch(missionId, () => void loadAll());
</script>

<template>
    <div class="space-y-6">
        <div class="flex items-center justify-between">
            <div>
                <h1 class="text-2xl font-bold text-white">Missão</h1>
                <p class="text-sm text-slate-300 mt-1 font-mono">{{ missionId }}</p>
            </div>
            <div class="flex items-center gap-2">
                <Button variant="ghost" size="sm" @click="router.back()">Voltar</Button>
                <Button variant="secondary" size="sm" @click="loadAll" :disabled="loading">Atualizar</Button>
            </div>
        </div>

        <div v-if="error" class="p-4 rounded-xl border border-red-500/30 bg-red-950/30 text-red-200">
            {{ error }}
        </div>

        <div v-if="loading" class="text-slate-300">Carregando…</div>

        <div v-else-if="mission" class="space-y-6">
            <Card>
                <template #header>
                    <div class="flex items-center justify-between gap-4">
                        <div class="min-w-0">
                            <div class="text-lg font-bold text-slate-100 truncate">{{ mission.title }}</div>
                            <div class="text-sm text-slate-400 truncate">{{ mission.description }}</div>
                        </div>
                        <div class="flex items-center gap-2 flex-wrap justify-end">
                            <Badge size="sm" :variant="statusVariant(mission.status)">{{ mission.status }}</Badge>
                            <Badge size="sm">{{ mission.autonomy_mode }}</Badge>
                            <Badge size="sm">propostas: {{ mission.counts?.proposed ?? 0 }}</Badge>
                            <Badge size="sm">pend: {{ mission.counts?.pending ?? 0 }}</Badge>
                            <Badge size="sm">run: {{ mission.counts?.running ?? 0 }}</Badge>
                            <Badge size="sm">done: {{ mission.counts?.done ?? 0 }}</Badge>
                            <Badge size="sm">blk: {{ mission.counts?.blocked ?? 0 }}</Badge>
                        </div>
                    </div>
                </template>

                <div class="flex items-center gap-2 flex-wrap">
                    <Button variant="primary" size="sm" @click="executeMission" :disabled="mission.status === 'RUNNING'">Executar</Button>
                    <Button variant="secondary" size="sm" @click="pauseMission" :disabled="mission.status !== 'RUNNING'">Pausar</Button>
                    <Button variant="secondary" size="sm" @click="resumeMission" :disabled="mission.status !== 'PAUSED'">Retomar</Button>
                    <Button variant="danger" size="sm" @click="cancelMission">Cancelar</Button>
                    <Button variant="ghost" size="sm" @click="showCreateTask = true">Adicionar tarefa</Button>
                </div>
                <div class="mt-3">
                    <label class="text-xs text-slate-400">Motivo operacional (audit trail)</label>
                    <Input v-model="commandReason" placeholder="Ex: ajuste de prioridade do cliente X" />
                </div>
            </Card>

            <div class="flex items-center gap-2 flex-wrap">
                <Button size="sm" variant="ghost" @click="tab = 'resumo'" :disabled="tab === 'resumo'">Resumo</Button>
                <Button size="sm" variant="ghost" @click="tab = 'tasks'" :disabled="tab === 'tasks'">Tarefas</Button>
                <Button size="sm" variant="ghost" @click="tab = 'propostas'" :disabled="tab === 'propostas'">Propostas</Button>
                <Button size="sm" variant="ghost" @click="tab = 'grafo'" :disabled="tab === 'grafo'">Grafo</Button>
                <Button size="sm" variant="ghost" @click="tab = 'eventos'" :disabled="tab === 'eventos'">Eventos</Button>
                <Button size="sm" variant="ghost" @click="tab = 'policy'" :disabled="tab === 'policy'">Policy</Button>
            </div>

            <div v-if="tab === 'resumo'" class="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <Card>
                    <template #header><div class="text-sm font-semibold text-slate-200">Editar missão</div></template>
                    <div class="space-y-4">
                        <div>
                            <label class="text-sm text-slate-300">Título</label>
                            <Input v-model="editForm.title" :disabled="!canEditMission" />
                        </div>
                        <div>
                            <label class="text-sm text-slate-300">Descrição</label>
                            <textarea v-model="editForm.description" rows="3" class="w-full px-3 py-2 rounded-lg bg-slate-900/60 border border-slate-700/50 text-slate-200" :disabled="!canEditMission" />
                        </div>
                        <div>
                            <label class="text-sm text-slate-300">Autonomia</label>
                            <select v-model="editForm.autonomy_mode" class="w-full px-3 py-2 rounded-lg bg-slate-900/60 border border-slate-700/50 text-slate-200" :disabled="!canEditMission">
                                <option value="USER_ONLY">USER_ONLY</option>
                                <option value="LLM_SUGGEST">LLM_SUGGEST</option>
                                <option value="LLM_CREATE_DRAFTS">LLM_CREATE_DRAFTS</option>
                                <option value="LLM_AUTO_APPROVE_WITH_BUDGET">LLM_AUTO_APPROVE_WITH_BUDGET</option>
                            </select>
                        </div>
                        <div class="flex justify-end">
                            <Button variant="primary" size="sm" @click="saveMissionBasics" :disabled="editingMission || !canEditMission">Salvar</Button>
                        </div>
                    </div>
                </Card>

                <Card>
                    <template #header><div class="text-sm font-semibold text-slate-200">Ações rápidas</div></template>
                    <div class="text-sm text-slate-300 space-y-2">
                        <div>Use “Propostas” para aprovar/rejeitar tasks em `stage=PROPOSED`.</div>
                        <div>Use “Policy” para controlar autonomia/budget sem perder SSOT.</div>
                    </div>
                </Card>
            </div>

            <div v-else-if="tab === 'tasks'" class="rounded-xl border border-slate-700/50 bg-slate-950/40 backdrop-blur-sm overflow-hidden">
                <div class="divide-y divide-slate-800">
                    <div v-for="t in missionTasks" :key="t.id" class="px-4 py-3 hover:bg-slate-900/40">
                        <div class="flex items-start justify-between gap-4">
                            <div class="min-w-0 cursor-pointer" @click="router.push(`/tasks/${t.id}`)">
                                <div class="text-sm font-mono text-slate-200 truncate">{{ t.id }}</div>
                                <div class="text-xs text-slate-400 truncate">{{ t.spec_user_message_preview }}</div>
                            </div>
                            <div class="flex items-center gap-2 flex-wrap justify-end">
                                <Badge size="sm">{{ t.stage }}</Badge>
                                <Badge size="sm" :variant="t.unified_status === 'DONE' ? 'success' : t.unified_status === 'FAILED' ? 'error' : 'default'">
                                    {{ t.unified_status }}
                                </Badge>
                                <Button v-if="t.command_caps?.can_pause" size="sm" variant="secondary" class="h-7 px-2 text-xs" @click="quickTaskAction(t.id, 'pause')">Pausar</Button>
                                <Button v-if="t.command_caps?.can_resume" size="sm" variant="secondary" class="h-7 px-2 text-xs" @click="quickTaskAction(t.id, 'resume')">Retomar</Button>
                                <Button v-if="t.command_caps?.can_unblock" size="sm" variant="secondary" class="h-7 px-2 text-xs" @click="quickTaskAction(t.id, 'unblock')">Desbloquear</Button>
                                <Button v-if="t.command_caps?.can_retry" size="sm" variant="ghost" class="h-7 px-2 text-xs" @click="quickTaskAction(t.id, 'retry')">Reexecutar</Button>
                                <Button v-if="t.command_caps?.can_cancel" size="sm" variant="danger" class="h-7 px-2 text-xs" @click="quickTaskAction(t.id, 'cancel')">Cancelar</Button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <div v-else-if="tab === 'propostas'" class="space-y-3">
                <Card>
                    <template #header>
                        <div class="flex items-center justify-between">
                            <div class="text-sm font-semibold text-slate-200">Propostas (stage=PROPOSED)</div>
                            <div class="flex items-center gap-2">
                                <Button size="sm" variant="secondary" @click="bulkApproveProposals" :disabled="selectedProposalIds.size === 0">Aprovar</Button>
                                <Button size="sm" variant="danger" @click="bulkRejectProposals" :disabled="selectedProposalIds.size === 0">Rejeitar</Button>
                            </div>
                        </div>
                    </template>
                    <div class="text-sm text-slate-400">Selecione proposals e aplique ações em lote.</div>
                </Card>

                <div class="rounded-xl border border-slate-700/50 bg-slate-950/40 backdrop-blur-sm overflow-hidden">
                    <div v-if="proposals.length === 0" class="px-4 py-6 text-slate-400">Nenhuma proposta pendente.</div>
                    <div v-else class="divide-y divide-slate-800">
                        <div v-for="t in proposals" :key="t.id" class="px-4 py-3 flex items-start gap-3 hover:bg-slate-900/40">
                            <input type="checkbox" class="mt-1" :checked="selectedProposalIds.has(t.id)" @change="toggleProposal(t.id)" />
                            <div class="min-w-0 flex-1 cursor-pointer" @click="router.push(`/tasks/${t.id}`)">
                                <div class="text-sm font-mono text-slate-200 truncate">{{ t.id }}</div>
                                <div class="text-xs text-slate-400 truncate">{{ t.spec_user_message_preview }}</div>
                            </div>
                            <div class="flex items-center gap-2">
                                <Badge size="sm">{{ t.stage }}</Badge>
                                <Badge size="sm">{{ t.target }}</Badge>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <div v-else-if="tab === 'grafo'" class="space-y-3">
                <VisGraph :nodes="graphNodes" :edges="graphEdges" height="560px" />
            </div>

            <div v-else-if="tab === 'eventos'" class="rounded-xl border border-slate-700/50 bg-slate-950/40 backdrop-blur-sm overflow-hidden">
                <div class="divide-y divide-slate-800">
                    <div v-for="e in missionEvents" :key="e.id" class="px-4 py-3">
                        <div class="flex items-center justify-between gap-4">
                            <div class="text-xs text-slate-400 font-mono truncate">#{{ e.id }} · {{ e.entity_type }} · {{ e.entity_id }}</div>
                            <div class="text-xs text-slate-500">{{ new Date(e.ts_ms).toLocaleString() }}</div>
                        </div>
                        <div class="text-sm text-slate-200 font-semibold">{{ e.event_type }}</div>
                        <pre class="text-xs text-slate-300 bg-slate-950/50 border border-slate-800 rounded-lg p-3 mt-2 overflow-auto max-h-56">{{ JSON.stringify(e.payload, null, 2) }}</pre>
                    </div>
                </div>
            </div>

            <div v-else-if="tab === 'policy'" class="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <Card>
                    <template #header><div class="text-sm font-semibold text-slate-200">Autonomia</div></template>
                    <select v-model="policyAutonomy" class="w-full px-3 py-2 rounded-lg bg-slate-900/60 border border-slate-700/50 text-slate-200" :disabled="!canEditMission">
                        <option value="USER_ONLY">USER_ONLY</option>
                        <option value="LLM_SUGGEST">LLM_SUGGEST</option>
                        <option value="LLM_CREATE_DRAFTS">LLM_CREATE_DRAFTS</option>
                        <option value="LLM_AUTO_APPROVE_WITH_BUDGET">LLM_AUTO_APPROVE_WITH_BUDGET</option>
                    </select>
                </Card>
                <Card>
                    <template #header><div class="text-sm font-semibold text-slate-200">Policy (JSON)</div></template>
                    <textarea v-model="policyText" rows="14" class="w-full px-3 py-2 rounded-lg bg-slate-900/60 border border-slate-700/50 text-slate-200 font-mono text-xs" :disabled="!canEditMission" />
                    <div class="flex justify-end mt-3">
                        <Button size="sm" variant="primary" @click="savePolicy" :disabled="!canEditMission">Salvar policy</Button>
                    </div>
                </Card>
            </div>
        </div>

        <Modal :open="showCreateTask" @update:open="showCreateTask = $event" size="lg">
            <template #title>Adicionar tarefa na missão</template>
            <template #description>Cria uma task SSOT (com execução automática se `stage=READY`).</template>

            <div class="space-y-4">
                <div>
                    <label class="text-sm text-slate-300">User message</label>
                    <textarea v-model="createTaskForm.user_message" rows="4" class="w-full px-3 py-2 rounded-lg bg-slate-900/60 border border-slate-700/50 text-slate-200" />
                </div>
                <div>
                    <label class="text-sm text-slate-300">System message</label>
                    <textarea v-model="createTaskForm.system_message" rows="2" class="w-full px-3 py-2 rounded-lg bg-slate-900/60 border border-slate-700/50 text-slate-200" />
                </div>
                <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <div>
                        <label class="text-sm text-slate-300">Stage</label>
                        <select v-model="createTaskForm.stage" class="w-full px-3 py-2 rounded-lg bg-slate-900/60 border border-slate-700/50 text-slate-200">
                            <option value="READY">READY</option>
                            <option value="DRAFT">DRAFT</option>
                            <option value="PROPOSED">PROPOSED</option>
                        </select>
                    </div>
                    <div>
                        <label class="text-sm text-slate-300">Target</label>
                        <select v-model="createTaskForm.target" class="w-full px-3 py-2 rounded-lg bg-slate-900/60 border border-slate-700/50 text-slate-200">
                            <option value="auto">auto</option>
                            <option value="chatgpt">chatgpt</option>
                            <option value="gemini">gemini</option>
                            <option value="claude">claude</option>
                            <option value="ollama">ollama</option>
                        </select>
                    </div>
                    <div>
                        <label class="text-sm text-slate-300">Prioridade</label>
                        <input v-model.number="createTaskForm.priority" type="number" min="0" max="10" class="w-full px-3 py-2 rounded-lg bg-slate-900/60 border border-slate-700/50 text-slate-200" />
                    </div>
                </div>
                <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div>
                        <label class="text-sm text-slate-300">Model (opcional)</label>
                        <Input v-model="createTaskForm.model" placeholder="ex: gpt-4o" />
                    </div>
                </div>
            </div>

            <template #footer>
                <div class="flex justify-end gap-2 w-full">
                    <Button variant="ghost" size="sm" @click="showCreateTask = false">Cancelar</Button>
                    <Button variant="primary" size="sm" @click="createTaskInMission" :disabled="creatingTask">Criar</Button>
                </div>
            </template>
        </Modal>
    </div>
</template>
