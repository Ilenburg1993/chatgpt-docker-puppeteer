<script setup>
import Badge from '@/components/ui/Badge.vue';
import Button from '@/components/ui/Button.vue';
import Input from '@/components/ui/Input.vue';
import Modal from '@/components/ui/Modal.vue';
import { useSsotRealtime } from '@/composables/useSsotRealtime';
import { useMissionsVNextStore } from '@/stores/missions_vnext';
import { useTasksVNextStore } from '@/stores/tasks_vnext';
import { Plus, RefreshCw } from 'lucide-vue-next';
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useRouter } from 'vue-router';

const router = useRouter();
const store = useTasksVNextStore();
const missions = useMissionsVNextStore();
useSsotRealtime();

const selectedIds = ref(new Set());
const bulkAction = ref('pause');
const bulkStage = ref('READY');
const bulkTarget = ref('auto');
const bulkPriority = ref(5);
const bulkExecuteAfterMs = ref(null);
const bulkMissionId = ref('');
const bulkReason = ref('');
const bulkProcessing = ref(false);
const actionFeedback = ref(null);

const showCreate = ref(false);
const creating = ref(false);
const showReasonModal = ref(false);
const showConfirmModal = ref(false);
const pendingAction = ref(null);
const reasonInput = ref('');
const confirmedReason = ref('');

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
const totalSelected = computed(() => selectedIds.value.size);

function statusVariant(status) {
    const s = String(status || '').toUpperCase();
    if (s === 'RUNNING') return 'info';
    if (s === 'DONE') return 'success';
    if (s === 'FAILED') return 'error';
    if (s === 'PAUSED' || s === 'CANCELLED') return 'warning';
    if (s === 'BLOCKED') return 'warning';
    return 'default';
}

let feedbackTimer = null;

function showFeedback(message, type = 'success') {
    actionFeedback.value = { message, type };
    if (feedbackTimer) clearTimeout(feedbackTimer);
    feedbackTimer = setTimeout(() => {
        actionFeedback.value = null;
        feedbackTimer = null;
    }, 4000);
}

function requestReason(action, callback) {
    pendingAction.value = { action, callback };
    reasonInput.value = bulkReason.value || '';
    showReasonModal.value = true;
}

async function confirmReasonAndExecute() {
    const reason = reasonInput.value.trim();
    if (!reason) return;
    showReasonModal.value = false;
    confirmedReason.value = reason;
    // Show second confirmation step
    showConfirmModal.value = true;
}

async function executeConfirmedAction() {
    showConfirmModal.value = false;
    const action = pendingAction.value;
    const reason = confirmedReason.value;
    pendingAction.value = null;
    reasonInput.value = '';
    confirmedReason.value = '';

    if (action?.callback) {
        try {
            await action.callback(reason);
        } catch (err) {
            showFeedback(`Erro ao executar ação: ${err?.message || String(err)}`, 'error');
        }
    }
}

function cancelConfirmation() {
    showConfirmModal.value = false;
    pendingAction.value = null;
    reasonInput.value = '';
    confirmedReason.value = '';
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
    selectedIds.value = new Set(items.value.map((t) => t.id));
}

async function refresh() {
    selectedIds.value = new Set();
    try {
        await store.fetchFirstPage({ limit: 200 });
    } catch (err) {
        showFeedback(`Falha ao carregar tarefas: ${err?.message || String(err)}`, 'error');
    }
}

async function loadMore() {
    try {
        await store.fetchNextPage({ limit: 200 });
    } catch (err) {
        showFeedback(`Falha ao carregar mais: ${err?.message || String(err)}`, 'error');
    }
}

async function runBulk() {
    const ids = Array.from(selectedIds.value);
    if (ids.length === 0) return;

    const action = bulkAction.value;
    requestReason(`bulk:${String(action).toUpperCase()} (${ids.length} tasks)`, async (reason) => {
        const params = {};
        if (action === 'set_stage') params.stage = bulkStage.value;
        if (action === 'set_target') params.target = bulkTarget.value;
        if (action === 'set_priority') params.priority = bulkPriority.value;
        if (action === 'set_execute_after') params.execute_after_ms = bulkExecuteAfterMs.value;
        if (action === 'reassign_mission') {
            params.mission_id = bulkMissionId.value || null;
            if (!params.mission_id) {
                showFeedback('Selecione a missão destino para reatribuição.', 'error');
                return;
            }
        }

        bulkProcessing.value = true;
        try {
            await store.bulkAction({ ids, action, params, reason });
            showFeedback(`Ação ${String(action).toUpperCase()} aplicada em ${ids.length} tarefas.`);
            selectedIds.value = new Set();
            bulkReason.value = '';
            await refresh();
        } catch (err) {
            showFeedback(`Falha na ação em lote: ${err?.message || String(err)}`, 'error');
        } finally {
            bulkProcessing.value = false;
        }
    });
}

async function quickAction(taskId, action) {
    requestReason(`task:${String(action).toUpperCase()} (${taskId})`, async (reason) => {
        try {
            await store.taskAction(taskId, action, reason);
            showFeedback(`Ação ${String(action).toUpperCase()} executada na task ${taskId}.`);
            await refresh();
        } catch (err) {
            showFeedback(`Falha: ${err?.message || String(err)}`, 'error');
        }
    });
}

async function createTask() {
    if (!createForm.value.user_message.trim()) {
        showFeedback('User message é obrigatória.', 'error');
        return;
    }
    requestReason('TASK_CREATE', async (reason) => {
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
            await store.createTask(taskPayload, reason);
            showCreate.value = false;
            createForm.value = {
                stage: 'READY',
                mission_id: '',
                target: 'auto',
                model: '',
                priority: 5,
                system_message: '',
                user_message: '',
            };
            showFeedback('Tarefa criada com sucesso.');
            await refresh();
        } catch (err) {
            showFeedback(`Falha ao criar tarefa: ${err?.message || String(err)}`, 'error');
        } finally {
            creating.value = false;
        }
    });
}

onMounted(async () => {
    await Promise.all([missions.fetchFirstPage({ limit: 200 }), refresh()]);
});

onUnmounted(() => {
    if (feedbackTimer) {
        clearTimeout(feedbackTimer);
        feedbackTimer = null;
    }
});
</script>

<template>
    <div class="space-y-5 animate-fade-in">
        <!-- Header -->
        <div class="flex items-center justify-between">
            <div>
                <h1 class="text-2xl font-bold text-white tracking-tight">
                    Tarefas
                    <span class="text-sm font-normal text-cyan-400/60 ml-2">// SSOT Queue</span>
                </h1>
                <p class="text-sm text-slate-400 mt-0.5">
                    Fila SSOT (SQLite) · tentativas/artefatos · controle total
                    <span v-if="items.length > 0" class="ml-2 font-mono text-slate-500"
                        >{{ items.length }} registros</span
                    >
                </p>
            </div>
            <div class="flex items-center gap-2">
                <Button variant="secondary" size="sm" @click="refresh" :disabled="store.loading">
                    <RefreshCw :size="14" class="mr-1" :class="{ 'animate-spin': store.loading }" />
                    Atualizar
                </Button>
                <Button variant="primary" size="sm" @click="showCreate = true">
                    <Plus :size="16" class="mr-1" />
                    Nova tarefa
                </Button>
            </div>
        </div>

        <!-- Action Feedback Toast -->
        <Transition name="slide">
            <div
                v-if="actionFeedback"
                class="fixed top-4 right-4 z-50 px-4 py-3 rounded-lg border text-sm shadow-lg max-w-md"
                :class="
                    actionFeedback.type === 'error'
                        ? 'bg-red-950/90 border-red-500/30 text-red-200'
                        : 'bg-emerald-950/90 border-emerald-500/30 text-emerald-200'
                "
            >
                {{ actionFeedback.message }}
            </div>
        </Transition>

        <!-- Filters -->
        <div class="surface-card p-4 grid grid-cols-1 md:grid-cols-7 gap-3">
            <Input
                v-model="store.filters.search"
                placeholder="Buscar (id/prompt)..."
                @keyup.enter="refresh"
                class="md:col-span-2"
            />
            <Input v-model="store.filters.mission_id" placeholder="Filtrar por mission_id..." @keyup.enter="refresh" />
            <select
                v-model="store.filters.status"
                class="w-full px-3 py-2 rounded-lg bg-slate-900/60 border border-slate-700/40 text-slate-200 text-sm focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/20"
            >
                <option :value="null">Status (todos)</option>
                <option value="PENDING">PENDING</option>
                <option value="RUNNING">RUNNING</option>
                <option value="DONE">DONE</option>
                <option value="FAILED">FAILED</option>
                <option value="PAUSED">PAUSED</option>
                <option value="CANCELLED">CANCELLED</option>
                <option value="BLOCKED">BLOCKED</option>
            </select>
            <select
                v-model="store.filters.stage"
                class="w-full px-3 py-2 rounded-lg bg-slate-900/60 border border-slate-700/40 text-slate-200 text-sm focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/20"
            >
                <option :value="null">Stage (todos)</option>
                <option value="DRAFT">DRAFT</option>
                <option value="PROPOSED">PROPOSED</option>
                <option value="READY">READY</option>
                <option value="REJECTED">REJECTED</option>
                <option value="ARCHIVED">ARCHIVED</option>
            </select>
            <select
                v-model="store.filters.target"
                class="w-full px-3 py-2 rounded-lg bg-slate-900/60 border border-slate-700/40 text-slate-200 text-sm focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/20"
            >
                <option :value="null">Target (todos)</option>
                <option value="auto">auto</option>
                <option value="chatgpt">chatgpt</option>
                <option value="gemini">gemini</option>
                <option value="claude">claude</option>
                <option value="ollama">ollama</option>
            </select>
            <select
                v-model="store.filters.blocked"
                class="w-full px-3 py-2 rounded-lg bg-slate-900/60 border border-slate-700/40 text-slate-200 text-sm focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/20"
            >
                <option :value="null">Bloqueio (todos)</option>
                <option :value="true">Somente bloqueadas</option>
                <option :value="false">Sem bloqueio</option>
            </select>
            <div class="md:col-span-6 flex justify-end">
                <Button variant="primary" size="sm" @click="refresh" :disabled="store.loading">Aplicar filtros</Button>
            </div>
        </div>

        <!-- Error -->
        <div v-if="store.error" class="p-4 rounded-xl border border-red-500/30 bg-red-950/20 text-red-300 text-sm">
            <span class="font-mono text-red-400 mr-2">ERR</span>{{ store.error }}
        </div>

        <!-- Bulk Actions Bar -->
        <div v-if="totalSelected > 0" class="surface-card p-4 flex flex-col md:flex-row md:items-center gap-3">
            <div class="text-sm text-slate-200">
                Selecionadas: <span class="font-mono text-cyan-400">{{ totalSelected }}</span>
            </div>
            <div class="flex-1 flex flex-col md:flex-row gap-2">
                <select
                    v-model="bulkAction"
                    class="w-full md:w-64 px-3 py-2 rounded-lg bg-slate-900/60 border border-slate-700/40 text-slate-200 text-sm"
                >
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
                    <select
                        v-model="bulkStage"
                        class="w-full md:w-48 px-3 py-2 rounded-lg bg-slate-900/60 border border-slate-700/40 text-slate-200 text-sm"
                    >
                        <option value="DRAFT">DRAFT</option>
                        <option value="PROPOSED">PROPOSED</option>
                        <option value="READY">READY</option>
                        <option value="REJECTED">REJECTED</option>
                        <option value="ARCHIVED">ARCHIVED</option>
                    </select>
                </template>
                <template v-else-if="bulkAction === 'set_target'">
                    <select
                        v-model="bulkTarget"
                        class="w-full md:w-48 px-3 py-2 rounded-lg bg-slate-900/60 border border-slate-700/40 text-slate-200 text-sm"
                    >
                        <option value="auto">auto</option>
                        <option value="chatgpt">chatgpt</option>
                        <option value="gemini">gemini</option>
                        <option value="claude">claude</option>
                        <option value="ollama">ollama</option>
                    </select>
                </template>
                <template v-else-if="bulkAction === 'set_priority'">
                    <input
                        v-model.number="bulkPriority"
                        type="number"
                        min="0"
                        max="10"
                        class="w-full md:w-32 px-3 py-2 rounded-lg bg-slate-900/60 border border-slate-700/40 text-slate-200 text-sm"
                    />
                </template>
                <template v-else-if="bulkAction === 'set_execute_after'">
                    <input
                        v-model="bulkExecuteAfterMs"
                        type="number"
                        placeholder="ms (null=agora)"
                        class="w-full md:w-56 px-3 py-2 rounded-lg bg-slate-900/60 border border-slate-700/40 text-slate-200 text-sm"
                    />
                </template>
                <template v-else-if="bulkAction === 'reassign_mission'">
                    <select
                        v-model="bulkMissionId"
                        class="w-full md:w-72 px-3 py-2 rounded-lg bg-slate-900/60 border border-slate-700/40 text-slate-200 text-sm"
                    >
                        <option value="">Selecione missão destino...</option>
                        <option v-for="m in missionOptions" :key="m.id" :value="m.id">
                            {{ m.title || m.id }} ({{ m.status }})
                        </option>
                    </select>
                </template>
            </div>
            <div class="flex justify-end">
                <Button variant="primary" size="sm" @click="runBulk" :disabled="bulkProcessing">
                    {{ bulkProcessing ? 'Processando...' : 'Aplicar' }}
                </Button>
            </div>
        </div>

        <!-- Task Table -->
        <div class="surface-card overflow-hidden">
            <table class="w-full text-sm">
                <thead class="bg-slate-900/40 text-slate-400 text-xs uppercase tracking-wider">
                    <tr>
                        <th class="p-3 w-10">
                            <input
                                type="checkbox"
                                :checked="selectedIds.size === items.length && items.length > 0"
                                @change="toggleAll"
                                class="rounded border-slate-600 bg-slate-800 text-blue-500 focus:ring-blue-500/30"
                            />
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
                <tbody class="divide-y divide-slate-800/50">
                    <tr v-if="store.loading && items.length === 0">
                        <td colspan="9" class="p-8 text-center text-slate-500">
                            <RefreshCw :size="20" class="animate-spin inline mr-2" />Carregando tarefas...
                        </td>
                    </tr>
                    <tr v-else-if="items.length === 0">
                        <td colspan="9" class="p-8 text-center text-slate-500">Nenhuma tarefa encontrada.</td>
                    </tr>
                    <tr v-for="t in items" :key="t.id" class="hover:bg-slate-900/30 transition-colors duration-100">
                        <td class="p-3">
                            <input
                                type="checkbox"
                                :checked="selectedIds.has(t.id)"
                                @change="toggle(t.id)"
                                class="rounded border-slate-600 bg-slate-800 text-blue-500 focus:ring-blue-500/30"
                            />
                        </td>
                        <td
                            class="p-3 font-mono text-slate-300 cursor-pointer hover:text-blue-400 transition-colors"
                            @click="router.push(`/tasks/${t.id}`)"
                        >
                            {{ t.id }}
                        </td>
                        <td class="p-3 text-slate-400">
                            <div class="max-w-[36rem] truncate">{{ t.spec_user_message_preview || '—' }}</div>
                            <div v-if="t.blocked_reason" class="text-xs text-amber-400/80 mt-1 flex items-center gap-1">
                                <span class="w-1.5 h-1.5 rounded-full bg-amber-400/60"></span>
                                BLOCKED: {{ t.blocked_reason }}
                            </div>
                        </td>
                        <td class="p-3">
                            <Badge size="sm">{{ t.stage }}</Badge>
                        </td>
                        <td class="p-3">
                            <Badge size="sm" :variant="statusVariant(t.unified_status)">{{ t.unified_status }}</Badge>
                        </td>
                        <td class="p-3 font-mono text-slate-400 text-xs">{{ t.target }}</td>
                        <td class="p-3 font-mono text-slate-400 text-xs">{{ t.priority }}</td>
                        <td class="p-3">
                            <div v-if="t.mission_ref?.id" class="text-xs">
                                <button
                                    class="font-mono text-cyan-400 hover:text-cyan-300 hover:underline transition-colors"
                                    @click.stop="router.push(`/missions/${t.mission_ref.id}`)"
                                >
                                    {{ t.mission_ref.title || t.mission_ref.id }}
                                </button>
                            </div>
                            <span v-else class="font-mono text-slate-600">—</span>
                        </td>
                        <td class="p-3 text-right">
                            <div class="flex justify-end gap-1.5">
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    class="h-7 px-2 text-xs"
                                    @click="router.push(`/tasks/${t.id}`)"
                                    >Abrir</Button
                                >
                                <Button
                                    v-if="t.command_caps?.can_pause"
                                    variant="secondary"
                                    size="sm"
                                    class="h-7 px-2 text-xs"
                                    @click="quickAction(t.id, 'pause')"
                                    >Pausar</Button
                                >
                                <Button
                                    v-if="t.command_caps?.can_resume"
                                    variant="secondary"
                                    size="sm"
                                    class="h-7 px-2 text-xs"
                                    @click="quickAction(t.id, 'resume')"
                                    >Retomar</Button
                                >
                                <Button
                                    v-if="t.command_caps?.can_unblock"
                                    variant="secondary"
                                    size="sm"
                                    class="h-7 px-2 text-xs"
                                    @click="quickAction(t.id, 'unblock')"
                                    >Desbloquear</Button
                                >
                                <Button
                                    v-if="t.command_caps?.can_retry"
                                    variant="ghost"
                                    size="sm"
                                    class="h-7 px-2 text-xs"
                                    @click="quickAction(t.id, 'retry')"
                                    >Retry</Button
                                >
                                <Button
                                    v-if="t.command_caps?.can_cancel"
                                    variant="danger"
                                    size="sm"
                                    class="h-7 px-2 text-xs"
                                    @click="quickAction(t.id, 'cancel')"
                                    >Cancelar</Button
                                >
                            </div>
                        </td>
                    </tr>
                </tbody>
            </table>
        </div>

        <!-- Load More -->
        <div v-if="store.hasMore" class="flex justify-center">
            <Button variant="secondary" size="sm" @click="loadMore" :disabled="store.loadingMore">
                {{ store.loadingMore ? 'Carregando...' : 'Carregar mais' }}
            </Button>
        </div>

        <!-- Create Task Modal -->
        <Modal :open="showCreate" @update:open="showCreate = $event" size="lg">
            <template #title>Nova tarefa</template>
            <template #description>Cria uma task SSOT (execução automática se stage=READY).</template>

            <div class="space-y-4">
                <div>
                    <label class="text-sm text-slate-300 font-medium"
                        >User message <span class="text-red-400">*</span></label
                    >
                    <textarea
                        v-model="createForm.user_message"
                        rows="4"
                        class="w-full px-3 py-2 rounded-lg bg-slate-900/60 border border-slate-700/40 text-slate-200 text-sm focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/20"
                        placeholder="Mensagem/instrução principal para o LLM..."
                    />
                </div>
                <div>
                    <label class="text-sm text-slate-300 font-medium">System message</label>
                    <textarea
                        v-model="createForm.system_message"
                        rows="2"
                        class="w-full px-3 py-2 rounded-lg bg-slate-900/60 border border-slate-700/40 text-slate-200 text-sm focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/20"
                        placeholder="Contexto do sistema (opcional)..."
                    />
                </div>
                <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <div>
                        <label class="text-sm text-slate-300 font-medium">Stage</label>
                        <select
                            v-model="createForm.stage"
                            class="w-full px-3 py-2 rounded-lg bg-slate-900/60 border border-slate-700/40 text-slate-200 text-sm"
                        >
                            <option value="READY">READY</option>
                            <option value="DRAFT">DRAFT</option>
                            <option value="PROPOSED">PROPOSED</option>
                        </select>
                    </div>
                    <div>
                        <label class="text-sm text-slate-300 font-medium">Target</label>
                        <select
                            v-model="createForm.target"
                            class="w-full px-3 py-2 rounded-lg bg-slate-900/60 border border-slate-700/40 text-slate-200 text-sm"
                        >
                            <option value="auto">auto</option>
                            <option value="chatgpt">chatgpt</option>
                            <option value="gemini">gemini</option>
                            <option value="claude">claude</option>
                            <option value="ollama">ollama</option>
                        </select>
                    </div>
                    <div>
                        <label class="text-sm text-slate-300 font-medium">Prioridade</label>
                        <input
                            v-model.number="createForm.priority"
                            type="number"
                            min="0"
                            max="10"
                            class="w-full px-3 py-2 rounded-lg bg-slate-900/60 border border-slate-700/40 text-slate-200 text-sm"
                        />
                    </div>
                </div>
                <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div>
                        <label class="text-sm text-slate-300 font-medium">Model (opcional)</label>
                        <Input v-model="createForm.model" placeholder="ex: gpt-4o" />
                    </div>
                    <div>
                        <label class="text-sm text-slate-300 font-medium">Mission ID (opcional)</label>
                        <select
                            v-model="createForm.mission_id"
                            class="w-full px-3 py-2 rounded-lg bg-slate-900/60 border border-slate-700/40 text-slate-200 text-sm"
                        >
                            <option value="">Nenhuma missão</option>
                            <option v-for="m in missionOptions" :key="m.id" :value="m.id">
                                {{ m.title || m.id }}
                            </option>
                        </select>
                    </div>
                </div>
            </div>

            <template #footer>
                <div class="flex justify-end gap-2 w-full">
                    <Button variant="ghost" size="sm" @click="showCreate = false">Cancelar</Button>
                    <Button variant="primary" size="sm" @click="createTask" :disabled="creating">
                        {{ creating ? 'Criando...' : 'Criar' }}
                    </Button>
                </div>
            </template>
        </Modal>

        <!-- Reason Modal (replaces window.prompt) -->
        <Modal :open="showReasonModal" @update:open="showReasonModal = $event" size="sm">
            <template #title>Motivo operacional (1/2)</template>
            <template #description>
                Informe o motivo para <span class="font-mono text-cyan-400">{{ pendingAction?.action || '—' }}</span
                >. Obrigatório para audit trail.
            </template>
            <div class="space-y-3">
                <textarea
                    v-model="reasonInput"
                    rows="3"
                    autofocus
                    class="w-full px-3 py-2 rounded-lg bg-slate-900/60 border border-slate-700/40 text-slate-200 text-sm focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/20"
                    placeholder="Ex: correção de prioridade, retentativa após timeout..."
                    @keydown.enter.ctrl="confirmReasonAndExecute"
                />
                <div class="text-xs text-slate-500">Ctrl+Enter para confirmar</div>
            </div>
            <template #footer>
                <div class="flex justify-end gap-2 w-full">
                    <Button variant="ghost" size="sm" @click="showReasonModal = false">Cancelar</Button>
                    <Button
                        variant="primary"
                        size="sm"
                        @click="confirmReasonAndExecute"
                        :disabled="!reasonInput.trim()"
                    >
                        Próximo
                    </Button>
                </div>
            </template>
        </Modal>

        <!-- Confirmation Modal (2/2) -->
        <Modal :open="showConfirmModal" @update:open="showConfirmModal = $event" size="sm">
            <template #title>Confirmação final (2/2)</template>
            <template #description>
                A ação <span class="font-mono text-cyan-400">{{ pendingAction?.action || '—' }}</span> será registrada
                em auditoria e executada imediatamente.
            </template>
            <div class="space-y-3">
                <div class="p-3 rounded-lg bg-slate-900/60 border border-slate-700/40">
                    <div class="text-xs text-slate-500 mb-1">Motivo informado:</div>
                    <div class="text-sm text-slate-200">{{ confirmedReason }}</div>
                </div>
                <div class="text-sm text-amber-400/80 flex items-start gap-2">
                    <span class="text-lg">⚠️</span>
                    <span>Confirme que deseja executar esta ação operacional.</span>
                </div>
            </div>
            <template #footer>
                <div class="flex justify-end gap-2 w-full">
                    <Button variant="ghost" size="sm" @click="cancelConfirmation">Cancelar</Button>
                    <Button variant="primary" size="sm" @click="executeConfirmedAction"> Confirmar e executar </Button>
                </div>
            </template>
        </Modal>
    </div>
</template>

<style scoped>
.slide-enter-active {
    transition: all 0.3s ease-out;
}
.slide-leave-active {
    transition: all 0.3s ease-in;
}
.slide-enter-from {
    opacity: 0;
    transform: translateY(-20px);
}
.slide-leave-to {
    opacity: 0;
    transform: translateY(-20px);
}
</style>
