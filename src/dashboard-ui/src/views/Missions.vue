<script setup>
import { computed, onMounted, ref } from 'vue';
import { Plus } from 'lucide-vue-next';
import { useRouter } from 'vue-router';
import { useMissionsVNextStore } from '@/stores/missions_vnext';
import Button from '@/components/ui/Button.vue';
import Input from '@/components/ui/Input.vue';
import Badge from '@/components/ui/Badge.vue';
import Modal from '@/components/ui/Modal.vue';
import { confirmTwoStepAction, requireReason } from '@/lib/command_guard';

const router = useRouter();
const store = useMissionsVNextStore();

const creating = ref(false);
const showCreate = ref(false);
const commandReason = ref('');
const createForm = ref({
    title: '',
    description: '',
    autonomy_mode: 'USER_ONLY',
});

const items = computed(() => store.items || []);

function statusVariant(status) {
    const s = String(status || '').toUpperCase();
    if (s === 'RUNNING') return 'info';
    if (s === 'PAUSED') return 'warning';
    if (s === 'DONE') return 'success';
    if (s === 'FAILED') return 'error';
    if (s === 'CANCELLED') return 'warning';
    return 'default';
}

async function refresh() {
    await store.fetchFirstPage({ limit: 100 });
}

async function createMission() {
    if (!createForm.value.title.trim()) return;
    creating.value = true;
    try {
        const reason = String(commandReason.value || '').trim();
        const promptedReason =
            typeof window !== 'undefined' && typeof window.prompt === 'function'
                ? String(window.prompt('Informe o motivo operacional para criar a missão:') || '').trim()
                : '';
        const normalizedReason = reason || promptedReason;
        requireReason(normalizedReason, 'Motivo obrigatório para criar missão.');
        if (!confirmTwoStepAction({ actionLabel: 'MISSION_CREATE', reason: normalizedReason })) return;
        await store.createMission(
            {
                title: createForm.value.title,
                description: createForm.value.description,
                autonomy_mode: createForm.value.autonomy_mode,
            },
            normalizedReason
        );
        showCreate.value = false;
        commandReason.value = '';
        createForm.value = { title: '', description: '', autonomy_mode: 'USER_ONLY' };
        await refresh();
    } finally {
        creating.value = false;
    }
}

onMounted(refresh);
</script>

<template>
    <div class="space-y-6">
        <div class="flex items-center justify-between">
            <div>
                <h1 class="text-2xl font-bold text-white">Missões</h1>
                <p class="text-sm text-slate-300 mt-1">Gerencie missões, policy/autonomia e proposals.</p>
            </div>
            <div class="flex items-center gap-2">
                <Button variant="secondary" size="sm" @click="refresh" :disabled="store.loading">Atualizar</Button>
                <Button variant="primary" size="sm" @click="showCreate = true">
                    <Plus :size="16" class="mr-1" />
                    Nova missão
                </Button>
            </div>
        </div>

        <div
            class="rounded-xl border border-slate-700/50 bg-slate-950/40 backdrop-blur-sm p-4 grid grid-cols-1 md:grid-cols-3 gap-3"
        >
            <Input
                v-model="store.filters.search"
                placeholder="Buscar (id, título, descrição)..."
                @keyup.enter="refresh"
            />
            <select
                v-model="store.filters.status"
                class="w-full px-3 py-2 rounded-lg bg-slate-900/60 border border-slate-700/50 text-slate-200"
            >
                <option :value="null">Status (todos)</option>
                <option value="READY">READY</option>
                <option value="RUNNING">RUNNING</option>
                <option value="PAUSED">PAUSED</option>
                <option value="DONE">DONE</option>
                <option value="FAILED">FAILED</option>
                <option value="CANCELLED">CANCELLED</option>
            </select>
            <select
                v-model="store.filters.autonomy_mode"
                class="w-full px-3 py-2 rounded-lg bg-slate-900/60 border border-slate-700/50 text-slate-200"
            >
                <option :value="null">Autonomia (todas)</option>
                <option value="USER_ONLY">USER_ONLY</option>
                <option value="LLM_SUGGEST">LLM_SUGGEST</option>
                <option value="LLM_CREATE_DRAFTS">LLM_CREATE_DRAFTS</option>
                <option value="LLM_AUTO_APPROVE_WITH_BUDGET">LLM_AUTO_APPROVE_WITH_BUDGET</option>
            </select>
            <div class="md:col-span-3 flex justify-end">
                <Button variant="primary" size="sm" @click="refresh" :disabled="store.loading">Aplicar filtros</Button>
            </div>
        </div>

        <div v-if="store.error" class="p-4 rounded-xl border border-red-500/30 bg-red-950/30 text-red-200">
            {{ store.error }}
        </div>

        <div v-if="store.loading" class="text-slate-300">Carregando…</div>

        <div v-else class="rounded-xl border border-slate-700/50 bg-slate-950/40 backdrop-blur-sm overflow-hidden">
            <div class="divide-y divide-slate-800">
                <div
                    v-for="m in items"
                    :key="m.id"
                    class="px-4 py-3 flex items-center justify-between gap-4 hover:bg-slate-900/40 cursor-pointer"
                    @click="router.push(`/missions/${m.id}`)"
                >
                    <div class="min-w-0">
                        <div class="text-sm font-semibold text-slate-200 truncate">{{ m.title }}</div>
                        <div class="text-xs text-slate-400 truncate font-mono">{{ m.id }}</div>
                    </div>
                    <div class="flex items-center gap-2 flex-wrap justify-end">
                        <Badge size="sm" :variant="statusVariant(m.status)">{{ m.status }}</Badge>
                        <Badge size="sm">{{ m.autonomy_mode }}</Badge>
                        <Badge size="sm">propostas: {{ m.counts?.proposed ?? 0 }}</Badge>
                        <Badge size="sm">pend: {{ m.counts?.pending ?? 0 }}</Badge>
                        <Badge size="sm">run: {{ m.counts?.running ?? 0 }}</Badge>
                        <Badge size="sm">done: {{ m.counts?.done ?? 0 }}</Badge>
                        <Badge size="sm">blk: {{ m.counts?.blocked ?? 0 }}</Badge>
                    </div>
                </div>
            </div>
        </div>

        <Modal :open="showCreate" @update:open="showCreate = $event" size="lg">
            <template #title>Nova missão</template>
            <template #description>Crie uma missão e controle autonomia/policy depois.</template>

            <div class="space-y-4">
                <div>
                    <label class="text-sm text-slate-300">Título</label>
                    <Input v-model="createForm.title" placeholder="Ex: Escrever um livro sobre Puppeteer" />
                </div>
                <div>
                    <label class="text-sm text-slate-300">Descrição</label>
                    <textarea
                        v-model="createForm.description"
                        rows="3"
                        class="w-full px-3 py-2 rounded-lg bg-slate-900/60 border border-slate-700/50 text-slate-200"
                    />
                </div>
                <div>
                    <label class="text-sm text-slate-300">Autonomia</label>
                    <select
                        v-model="createForm.autonomy_mode"
                        class="w-full px-3 py-2 rounded-lg bg-slate-900/60 border border-slate-700/50 text-slate-200"
                    >
                        <option value="USER_ONLY">USER_ONLY</option>
                        <option value="LLM_SUGGEST">LLM_SUGGEST</option>
                        <option value="LLM_CREATE_DRAFTS">LLM_CREATE_DRAFTS</option>
                        <option value="LLM_AUTO_APPROVE_WITH_BUDGET">LLM_AUTO_APPROVE_WITH_BUDGET</option>
                    </select>
                </div>
                <div>
                    <label class="text-sm text-slate-300">Motivo operacional (obrigatório)</label>
                    <Input v-model="commandReason" placeholder="Ex: iniciar nova frente para cliente X" />
                </div>
            </div>

            <template #footer>
                <div class="flex justify-end gap-2 w-full">
                    <Button variant="ghost" size="sm" @click="showCreate = false">Cancelar</Button>
                    <Button variant="primary" size="sm" @click="createMission" :disabled="creating"> Criar </Button>
                </div>
            </template>
        </Modal>
    </div>
</template>
