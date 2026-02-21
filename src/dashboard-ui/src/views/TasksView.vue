<script setup>
import { computed, onMounted, ref } from 'vue';
import { Plus } from 'lucide-vue-next';
import { useRouter } from 'vue-router';
import Button from '@/components/ui/Button.vue';
import Badge from '@/components/ui/Badge.vue';
import Input from '@/components/ui/Input.vue';
import Modal from '@/components/ui/Modal.vue';
import { useTasksVNextStore } from '@/stores/tasks_vnext';
import { useMissionsVNextStore } from '@/stores/missions_vnext';
import { confirmTwoStepAction, requireReason } from '@/lib/command_guard';

const router = useRouter();
const store = useTasksVNextStore();
const missions = useMissionsVNextStore();

const selectedIds = ref(new Set());
const bulkAction = ref('pause');
const bulkStage = ref('READY');
const bulkTarget = ref('auto');
const bulkPriority = ref(5);
const bulkExecuteAfterMs = ref(null);
const bulkMissionId = ref('');
const bulkReason = ref('');

const showCreate = ref(false);
const creating = ref(false);
const createForm = ref({
    stage: 'READY',
    mission_id: '',
    target: 'auto',
    model: '',
    priority: 5,
    system_message: '',
    user_message: '',
});

const items = computed(() => store.items || []);
const missionOptions = computed(() => missions.items || []);
const bulkEligibilityPreview = computed(() => {
    if (bulkAction.value !== 'reassign_mission') return null;
    const selected = items.value.filter(t => selectedIds.value.has(t.id));
    const eligible = selected.filter(t => Boolean(t?.command_caps?.can_reassign_mission));
    const blocked = selected.length - eligible.length;
    return {
        total: selected.length,
        eligible: eligible.length,
        blocked,
    };
});

function statusVariant(status) {
    const s = String(status || '').toUpperCase();
    if (s === 'RUNNING') return 'info';
    if (s === 'DONE') return 'success';
    if (s === 'FAILED') return 'error';
    if (s === 'PAUSED' || s === 'CANCELLED') return 'warning';
    if (s === 'BLOCKED') return 'warning';
    return 'default';
}

function resolveReason(defaultReason, errorMessage) {
    const typed = String(bulkReason.value || '').trim();
    if (typed) return typed;
    if (typeof window !== 'undefined' && typeof window.prompt === 'function') {
        const prompted = String(window.prompt('Informe o motivo operacional para esta ação:', defaultReason) || '').trim();
        if (prompted) {
            bulkReason.value = prompted;
            return prompted;
        }
    }
    return requireReason('', errorMessage);
}

function toggle(id) {
    const set = selectedIds.value;
    if (set.has(id)) set.delete(id);
    else set.add(id);
}

function toggleAll() {
    if (selectedIds.value.size === items.value.length) {
        selectedIds.value = new Set();
        return;
    }
    selectedIds.value = new Set(items.value.map(t => t.id));
}

async function refresh() {
    selectedIds.value = new Set();
    await store.fetchFirstPage({ limit: 200 });
}

async function loadMore() {
    await store.fetchNextPage({ limit: 200 });
}

async function runBulk() {
    const ids = Array.from(selectedIds.value);
    if (ids.length === 0) return;

    const action = bulkAction.value;
    const reason = resolveReason(
        `Ação em lote ${String(action).toUpperCase()} no dashboard`,
        'Informe motivo para executar ação em lote.'
    );
    const params = {};
    if (action === 'set_stage') params.stage = bulkStage.value;
    if (action === 'set_target') params.target = bulkTarget.value;
    if (action === 'set_priority') params.priority = bulkPriority.value;
    if (action === 'set_execute_after') params.execute_after_ms = bulkExecuteAfterMs.value;
    if (action === 'reassign_mission') params.mission_id = bulkMissionId.value || null;
    if (action === 'reassign_mission' && !params.mission_id) {
        alert('Selecione a missão destino para reatribuição.');
        return;
    }

    if (
        !confirmTwoStepAction({
            actionLabel: `bulk:${String(action).toUpperCase()} (${ids.length} tasks)`,
            reason,
        })
    ) {
        return;
    }

    await store.bulkAction({
        ids,
        action,
        params,
        reason,
    });
    selectedIds.value = new Set();
    await refresh();
}

async function quickAction(taskId, action) {
    const reason = resolveReason(
        `Ação ${String(action).toUpperCase()} na task ${taskId}`,
        'Informe motivo para executar comando na task.'
    );
    if (
        !confirmTwoStepAction({
            actionLabel: `task:${String(action).toUpperCase()} (${taskId})`,
            reason,
        })
    ) {
        return;
    }
    await store.taskAction(taskId, action, reason);
    await refresh();
}

async function createTask() {
    if (!createForm.value.user_message.trim()) return;
    creating.value = true;
    try {
        const taskPayload = {
            stage: createForm.value.stage,
            meta: {
                priority: Number(createForm.value.priority) || 5,
                mission_id: createForm.value.mission_id || undefined,
            },
            spec: {
                target: createForm.value.target,
                model: createForm.value.model || undefined,
                payload: {
                    system_message: createForm.value.system_message || '',
                    user_message: createForm.value.user_message,
                },
            },
        };
        const reason = resolveReason('Criação de task na tela Tasks', 'Informe motivo para criar task.');
        if (!confirmTwoStepAction({ actionLabel: 'TASK_CREATE', reason })) {
            return;
        }
        await store.createTask(taskPayload, reason);
        showCreate.value = false;
        createForm.value = { stage: 'READY', mission_id: '', target: 'auto', model: '', priority: 5, system_message: '', user_message: '' };
        await refresh();
    } finally {
        creating.value = false;
    }
}

onMounted(async () => {
    await Promise.all([missions.fetchFirstPage({ limit: 200 }), refresh()]);
});
</script>

<template>
    <div class="space-y-6">
        <div class="flex items-center justify-between">
            <div>
                <h1 class="text-2xl font-bold text-white">Tarefas</h1>
                <p class="text-sm text-slate-300 mt-1">Fila SSOT (SQLite) + tentativas/artefatos + controle total.</p>
            </div>
            <div class="flex items-center gap-2">
                <Button variant="secondary" size="sm" @click="refresh" :disabled="store.loading">Atualizar</Button>
                <Button variant="primary" size="sm" @click="showCreate = true">
                    <Plus :size="16" class="mr-1" />
                    Nova tarefa
                </Button>
            </div>
        </div>

        <div class="rounded-xl border border-slate-700/50 bg-slate-950/40 backdrop-blur-sm p-4 grid grid-cols-1 md:grid-cols-7 gap-3">
            <Input v-model="store.filters.search" placeholder="Buscar (id/prompt)..." @keyup.enter="refresh" class="md:col-span-2" />
            <Input v-model="store.filters.mission_id" placeholder="Filtrar por mission_id..." @keyup.enter="refresh" />
            <select v-model="store.filters.status" class="w-full px-3 py-2 rounded-lg bg-slate-900/60 border border-slate-700/50 text-slate-200">
                <option :value="null">Status (todos)</option>
                <option value="PENDING">PENDING</option>
                <option value="RUNNING">RUNNING</option>
                <option value="DONE">DONE</option>
                <option value="FAILED">FAILED</option>
                <option value="PAUSED">PAUSED</option>
                <option value="CANCELLED">CANCELLED</option>
                <option value="BLOCKED">BLOCKED</option>
            </select>
            <select v-model="store.filters.stage" class="w-full px-3 py-2 rounded-lg bg-slate-900/60 border border-slate-700/50 text-slate-200">
                <option :value="null">Stage (todos)</option>
                <option value="DRAFT">DRAFT</option>
                <option value="PROPOSED">PROPOSED</option>
                <option value="READY">READY</option>
                <option value="REJECTED">REJECTED</option>
                <option value="ARCHIVED">ARCHIVED</option>
            </select>
            <select v-model="store.filters.target" class="w-full px-3 py-2 rounded-lg bg-slate-900/60 border border-slate-700/50 text-slate-200">
                <option :value="null">Target (todos)</option>
                <option value="auto">auto</option>
                <option value="chatgpt">chatgpt</option>
                <option value="gemini">gemini</option>
                <option value="claude">claude</option>
                <option value="ollama">ollama</option>
            </select>
            <select v-model="store.filters.blocked" class="w-full px-3 py-2 rounded-lg bg-slate-900/60 border border-slate-700/50 text-slate-200">
                <option :value="null">Bloqueio (todos)</option>
                <option :value="true">Somente bloqueadas</option>
                <option :value="false">Sem bloqueio</option>
            </select>
            <div class="md:col-span-6 flex justify-end">
                <Button variant="primary" size="sm" @click="refresh" :disabled="store.loading">Aplicar filtros</Button>
            </div>
        </div>

        <div v-if="store.error" class="p-4 rounded-xl border border-red-500/30 bg-red-950/30 text-red-200">
            {{ store.error }}
        </div>

        <div v-if="selectedIds.size > 0" class="rounded-xl border border-slate-700/50 bg-slate-950/40 backdrop-blur-sm p-4 flex flex-col md:flex-row md:items-center gap-3">
            <div class="text-sm text-slate-200">
                Selecionadas: <span class="font-mono">{{ selectedIds.size }}</span>
            </div>
            <div class="flex-1 flex flex-col md:flex-row gap-2">
                <select v-model="bulkAction" class="w-full md:w-64 px-3 py-2 rounded-lg bg-slate-900/60 border border-slate-700/50 text-slate-200">
                    <option value="pause">Pausar</option>
                    <option value="resume">Retomar</option>
                    <option value="unblock">Desbloquear</option>
                    <option value="retry">Reexecutar</option>
                    <option value="cancel">Cancelar</option>
                    <option value="approve">Aprovar (PROPOSED→READY)</option>
                    <option value="reject">Rejeitar (PROPOSED→REJECTED)</option>
                    <option value="set_stage">Definir stage</option>
                <option value="set_target">Definir target</option>
                <option value="set_priority">Definir prioridade</option>
                <option value="set_execute_after">Agendar (execute_after_ms)</option>
                <option value="reassign_mission">Reatribuir missão</option>
            </select>

                <template v-if="bulkAction === 'set_stage'">
                    <select v-model="bulkStage" class="w-full md:w-48 px-3 py-2 rounded-lg bg-slate-900/60 border border-slate-700/50 text-slate-200">
                        <option value="DRAFT">DRAFT</option>
                        <option value="PROPOSED">PROPOSED</option>
                        <option value="READY">READY</option>
                        <option value="REJECTED">REJECTED</option>
                        <option value="ARCHIVED">ARCHIVED</option>
                    </select>
                </template>

                <template v-else-if="bulkAction === 'set_target'">
                    <select v-model="bulkTarget" class="w-full md:w-48 px-3 py-2 rounded-lg bg-slate-900/60 border border-slate-700/50 text-slate-200">
                        <option value="auto">auto</option>
                        <option value="chatgpt">chatgpt</option>
                        <option value="gemini">gemini</option>
                        <option value="claude">claude</option>
                        <option value="ollama">ollama</option>
                    </select>
                </template>

                <template v-else-if="bulkAction === 'set_priority'">
                    <input v-model.number="bulkPriority" type="number" min="0" max="10" class="w-full md:w-32 px-3 py-2 rounded-lg bg-slate-900/60 border border-slate-700/50 text-slate-200" />
                </template>

                <template v-else-if="bulkAction === 'set_execute_after'">
                    <input v-model="bulkExecuteAfterMs" type="number" placeholder="ms (null=agora)" class="w-full md:w-56 px-3 py-2 rounded-lg bg-slate-900/60 border border-slate-700/50 text-slate-200" />
                </template>
                <template v-else-if="bulkAction === 'reassign_mission'">
                    <select v-model="bulkMissionId" class="w-full md:w-72 px-3 py-2 rounded-lg bg-slate-900/60 border border-slate-700/50 text-slate-200">
                        <option value="">Selecione missão destino...</option>
                        <option v-for="m in missionOptions" :key="m.id" :value="m.id">
                            {{ m.title || m.id }} ({{ m.status }})
                        </option>
                    </select>
                </template>
            </div>
            <div class="w-full md:w-72">
                <input v-model="bulkReason" type="text" placeholder="Motivo obrigatório (audit trail)" class="w-full px-3 py-2 rounded-lg bg-slate-900/60 border border-slate-700/50 text-slate-200" />
            </div>
            <div class="flex justify-end">
                <Button variant="primary" size="sm" @click="runBulk">Aplicar</Button>
            </div>
            <div v-if="bulkEligibilityPreview" class="w-full text-xs text-slate-300 md:col-span-6">
                Preview reassign: elegíveis {{ bulkEligibilityPreview.eligible }}/{{ bulkEligibilityPreview.total }} · bloqueadas {{ bulkEligibilityPreview.blocked }}.
            </div>
        </div>

        <div class="rounded-xl border border-slate-700/50 bg-slate-950/40 backdrop-blur-sm overflow-hidden">
            <table class="w-full text-sm">
                <thead class="bg-slate-900/60 text-slate-300">
                    <tr>
                        <th class="p-3 w-10">
                            <input type="checkbox" :checked="selectedIds.size === items.length && items.length > 0" @change="toggleAll" />
                        </th>
                        <th class="p-3 text-left">ID</th>
                        <th class="p-3 text-left">Prompt</th>
                        <th class="p-3 text-left">Stage</th>
                        <th class="p-3 text-left">Status</th>
                        <th class="p-3 text-left">Target</th>
                        <th class="p-3 text-left">Pri</th>
                        <th class="p-3 text-left">Mission</th>
                        <th class="p-3 text-right">Ações</th>
                    </tr>
                </thead>
                <tbody class="divide-y divide-slate-800">
                    <tr v-for="t in items" :key="t.id" class="hover:bg-slate-900/40">
                        <td class="p-3">
                            <input type="checkbox" :checked="selectedIds.has(t.id)" @change="toggle(t.id)" />
                        </td>
                        <td class="p-3 font-mono text-slate-200 cursor-pointer" @click="router.push(`/tasks/${t.id}`)">
                            {{ t.id }}
                        </td>
                        <td class="p-3 text-slate-300">
                            <div class="max-w-[36rem] truncate">{{ t.spec_user_message_preview }}</div>
                            <div v-if="t.blocked_reason" class="text-xs text-amber-300 mt-1">BLOCKED: {{ t.blocked_reason }}</div>
                        </td>
                        <td class="p-3"><Badge size="sm">{{ t.stage }}</Badge></td>
                        <td class="p-3"><Badge size="sm" :variant="statusVariant(t.unified_status)">{{ t.unified_status }}</Badge></td>
                        <td class="p-3 font-mono text-slate-300">{{ t.target }}</td>
                        <td class="p-3 font-mono text-slate-300">{{ t.priority }}</td>
                        <td class="p-3">
                            <div v-if="t.mission_ref?.id" class="text-xs">
                                <button class="font-mono text-sky-300 hover:underline" @click.stop="router.push(`/missions/${t.mission_ref.id}`)">
                                    {{ t.mission_ref.title || t.mission_ref.id }}
                                </button>
                                <div class="text-slate-400 font-mono">{{ t.mission_ref.id }}</div>
                                <Badge v-if="t.mission_ref.status" size="sm">{{ t.mission_ref.status }}</Badge>
                            </div>
                            <span v-else class="font-mono text-slate-400">-</span>
                        </td>
                        <td class="p-3 text-right">
                            <div class="flex justify-end gap-2">
                                <Button variant="ghost" size="sm" class="h-7 px-2 text-xs" @click="router.push(`/tasks/${t.id}`)">Abrir</Button>
                                <Button v-if="t.command_caps?.can_pause" variant="secondary" size="sm" class="h-7 px-2 text-xs" @click="quickAction(t.id, 'pause')">Pausar</Button>
                                <Button v-if="t.command_caps?.can_resume" variant="secondary" size="sm" class="h-7 px-2 text-xs" @click="quickAction(t.id, 'resume')">Retomar</Button>
                                <Button v-if="t.command_caps?.can_unblock" variant="secondary" size="sm" class="h-7 px-2 text-xs" @click="quickAction(t.id, 'unblock')">Desbloquear</Button>
                                <Button v-if="t.command_caps?.can_retry" variant="ghost" size="sm" class="h-7 px-2 text-xs" @click="quickAction(t.id, 'retry')">Reexecutar</Button>
                                <Button v-if="t.command_caps?.can_cancel" variant="danger" size="sm" class="h-7 px-2 text-xs" @click="quickAction(t.id, 'cancel')">Cancelar</Button>
                            </div>
                        </td>
                    </tr>
                </tbody>
            </table>
        </div>

        <div v-if="store.hasMore" class="flex justify-center">
            <Button variant="secondary" size="sm" @click="loadMore" :disabled="store.loadingMore">Carregar mais</Button>
        </div>

        <Modal :open="showCreate" @update:open="showCreate = $event" size="lg">
            <template #title>Nova tarefa</template>
            <template #description>Cria uma task SSOT (execução automática se `stage=READY`).</template>

            <div class="space-y-4">
                <div>
                    <label class="text-sm text-slate-300">User message</label>
                    <textarea v-model="createForm.user_message" rows="4" class="w-full px-3 py-2 rounded-lg bg-slate-900/60 border border-slate-700/50 text-slate-200" />
                </div>
                <div>
                    <label class="text-sm text-slate-300">System message</label>
                    <textarea v-model="createForm.system_message" rows="2" class="w-full px-3 py-2 rounded-lg bg-slate-900/60 border border-slate-700/50 text-slate-200" />
                </div>
                <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <div>
                        <label class="text-sm text-slate-300">Stage</label>
                        <select v-model="createForm.stage" class="w-full px-3 py-2 rounded-lg bg-slate-900/60 border border-slate-700/50 text-slate-200">
                            <option value="READY">READY</option>
                            <option value="DRAFT">DRAFT</option>
                            <option value="PROPOSED">PROPOSED</option>
                        </select>
                    </div>
                    <div>
                        <label class="text-sm text-slate-300">Target</label>
                        <select v-model="createForm.target" class="w-full px-3 py-2 rounded-lg bg-slate-900/60 border border-slate-700/50 text-slate-200">
                            <option value="auto">auto</option>
                            <option value="chatgpt">chatgpt</option>
                            <option value="gemini">gemini</option>
                            <option value="claude">claude</option>
                            <option value="ollama">ollama</option>
                        </select>
                    </div>
                    <div>
                        <label class="text-sm text-slate-300">Prioridade</label>
                        <input v-model.number="createForm.priority" type="number" min="0" max="10" class="w-full px-3 py-2 rounded-lg bg-slate-900/60 border border-slate-700/50 text-slate-200" />
                    </div>
                </div>
                <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div>
                        <label class="text-sm text-slate-300">Model (opcional)</label>
                        <Input v-model="createForm.model" placeholder="ex: gpt-4o" />
                    </div>
                    <div>
                        <label class="text-sm text-slate-300">Mission ID (opcional)</label>
                        <Input v-model="createForm.mission_id" placeholder="mission-..." />
                    </div>
                </div>
            </div>

            <template #footer>
                <div class="flex justify-end gap-2 w-full">
                    <Button variant="ghost" size="sm" @click="showCreate = false">Cancelar</Button>
                    <Button variant="primary" size="sm" @click="createTask" :disabled="creating">Criar</Button>
                </div>
            </template>
        </Modal>
    </div>
</template>
