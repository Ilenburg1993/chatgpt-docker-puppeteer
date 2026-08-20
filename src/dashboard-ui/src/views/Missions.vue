<script setup lang="ts">
import Badge from '@/components/ui/Badge.vue';
import Button from '@/components/ui/Button.vue';
import Input from '@/components/ui/Input.vue';
import Modal from '@/components/ui/Modal.vue';
import { useSsotRealtime } from '@/composables/useSsotRealtime';
import { useMissionsVNextStore } from '@/stores/missions_vnext';
import type { BadgeVariant } from '@/types/dashboard';
import { Plus, RefreshCw } from 'lucide-vue-next';
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useRouter } from 'vue-router';

const router = useRouter();
const store = useMissionsVNextStore();
useSsotRealtime();

const creating = ref(false);
const showCreate = ref(false);
const actionFeedback = ref<{ message: string; type: 'success' | 'error' } | null>(null);
const createForm = ref({
    title: '',
    description: '',
    autonomy_mode: 'USER_ONLY',
    reason: '',
});

const items = computed(() => store.items || []);

function statusVariant(status: string | undefined): BadgeVariant {
    const s = String(status || '').toUpperCase();
    if (s === 'RUNNING') return 'info';
    if (s === 'PAUSED') return 'warning';
    if (s === 'DONE') return 'success';
    if (s === 'FAILED') return 'error';
    if (s === 'CANCELLED') return 'warning';
    return 'default';
}

let feedbackTimer: ReturnType<typeof setTimeout> | null = null;

function showFeedback(message: string, type: 'success' | 'error' = 'success') {
    actionFeedback.value = { message, type };
    if (feedbackTimer) clearTimeout(feedbackTimer);
    feedbackTimer = setTimeout(() => {
        actionFeedback.value = null;
        feedbackTimer = null;
    }, 4000);
}

async function refresh() {
    try {
        await store.fetchFirstPage({ limit: 100 });
    } catch (err: unknown) {
        showFeedback(`Falha ao carregar missões: ${err instanceof Error ? err.message : String(err)}`, 'error');
    }
}

async function createMission() {
    if (!createForm.value.title.trim()) {
        showFeedback('Título é obrigatório.', 'error');
        return;
    }
    if (!createForm.value.reason.trim()) {
        showFeedback('Motivo operacional é obrigatório.', 'error');
        return;
    }
    creating.value = true;
    try {
        await store.createMission(
            {
                title: createForm.value.title,
                description: createForm.value.description,
                autonomy_mode: createForm.value.autonomy_mode,
            },
            createForm.value.reason.trim(),
        );
        showCreate.value = false;
        createForm.value = { title: '', description: '', autonomy_mode: 'USER_ONLY', reason: '' };
        showFeedback('Missão criada com sucesso.');
        await refresh();
    } catch (err: unknown) {
        showFeedback(`Falha ao criar missão: ${err instanceof Error ? err.message : String(err)}`, 'error');
    } finally {
        creating.value = false;
    }
}

onMounted(refresh);

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
                    Missões
                    <span class="text-sm font-normal text-cyan-400/60 ml-2">// Command Center</span>
                </h1>
                <p class="text-sm text-slate-400 mt-0.5">
                    Gerencie missões, policy/autonomia e proposals
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
                    Nova missão
                </Button>
            </div>
        </div>

        <!-- Feedback Toast -->
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
        <div class="surface-card p-4 grid grid-cols-1 md:grid-cols-3 gap-3">
            <Input
                v-model="store.filters.search"
                placeholder="Buscar (id, título, descrição)..."
                @keyup.enter="refresh"
            />
            <select
                v-model="store.filters.status"
                class="w-full px-3 py-2 rounded-lg bg-slate-900/60 border border-slate-700/40 text-slate-200 text-sm focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/20"
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
                class="w-full px-3 py-2 rounded-lg bg-slate-900/60 border border-slate-700/40 text-slate-200 text-sm focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/20"
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

        <!-- Error -->
        <div v-if="store.error" class="p-4 rounded-xl border border-red-500/30 bg-red-950/20 text-red-300 text-sm">
            <span class="font-mono text-red-400 mr-2">ERR</span>{{ store.error }}
        </div>

        <!-- Loading -->
        <div v-if="store.loading" class="flex items-center gap-2 text-slate-400 text-sm py-4">
            <RefreshCw :size="16" class="animate-spin" />
            Carregando missões...
        </div>

        <!-- Missions List -->
        <div v-else class="surface-card overflow-hidden">
            <div v-if="items.length === 0" class="p-8 text-center text-slate-500">Nenhuma missão encontrada.</div>
            <div v-else class="divide-y divide-slate-800/50">
                <div
                    v-for="m in items"
                    :key="m.id"
                    class="px-4 py-3.5 flex items-center justify-between gap-4 hover:bg-slate-900/30 cursor-pointer transition-colors duration-100"
                    @click="router.push(`/missions/${m.id}`)"
                >
                    <div class="min-w-0 flex-1">
                        <div class="text-sm font-semibold text-slate-200 truncate">{{ m.title || '(sem título)' }}</div>
                        <div class="text-xs text-slate-500 truncate font-mono mt-0.5">{{ m.id }}</div>
                        <div v-if="m.description" class="text-xs text-slate-400 truncate mt-0.5 max-w-md">
                            {{ m.description }}
                        </div>
                    </div>
                    <div class="flex items-center gap-2 flex-wrap justify-end flex-shrink-0">
                        <Badge size="sm" :variant="statusVariant(m.status)">{{ m.status }}</Badge>
                        <Badge size="sm" class="text-[10px]">{{ m.autonomy_mode }}</Badge>
                        <Badge v-if="(m.counts?.proposed ?? 0) > 0" size="sm">prop: {{ m.counts?.proposed }}</Badge>
                        <Badge v-if="(m.counts?.pending ?? 0) > 0" size="sm">pend: {{ m.counts?.pending }}</Badge>
                        <Badge v-if="(m.counts?.running ?? 0) > 0" size="sm" variant="info"
                            >run: {{ m.counts?.running }}</Badge
                        >
                        <Badge v-if="(m.counts?.done ?? 0) > 0" size="sm" variant="success"
                            >done: {{ m.counts?.done }}</Badge
                        >
                        <Badge v-if="(m.counts?.failed ?? 0) > 0" size="sm" variant="error"
                            >fail: {{ m.counts?.failed }}</Badge
                        >
                        <Badge v-if="(m.counts?.blocked ?? 0) > 0" size="sm" variant="warning"
                            >blk: {{ m.counts?.blocked }}</Badge
                        >
                    </div>
                </div>
            </div>
        </div>

        <!-- Load More -->
        <div v-if="store.hasMore" class="flex justify-center">
            <Button
                variant="secondary"
                size="sm"
                @click="store.fetchNextPage({ limit: 100 })"
                :disabled="store.loadingMore"
            >
                {{ store.loadingMore ? 'Carregando...' : 'Carregar mais' }}
            </Button>
        </div>

        <!-- Create Mission Modal -->
        <Modal :open="showCreate" @update:open="showCreate = $event" size="lg">
            <template #title>Nova missão</template>
            <template #description>Crie uma missão e controle autonomia/policy depois.</template>

            <div class="space-y-4">
                <div>
                    <label class="text-sm text-slate-300 font-medium">Título <span class="text-red-400">*</span></label>
                    <Input v-model="createForm.title" placeholder="Ex: Escrever um livro sobre Puppeteer" />
                </div>
                <div>
                    <label class="text-sm text-slate-300 font-medium">Descrição</label>
                    <textarea
                        v-model="createForm.description"
                        rows="3"
                        class="w-full px-3 py-2 rounded-lg bg-slate-900/60 border border-slate-700/40 text-slate-200 text-sm focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/20"
                        placeholder="Descreva os objetivos e escopo da missão..."
                    />
                </div>
                <div>
                    <label class="text-sm text-slate-300 font-medium">Autonomia</label>
                    <select
                        v-model="createForm.autonomy_mode"
                        class="w-full px-3 py-2 rounded-lg bg-slate-900/60 border border-slate-700/40 text-slate-200 text-sm"
                    >
                        <option value="USER_ONLY">USER_ONLY — Controle manual total</option>
                        <option value="LLM_SUGGEST">LLM_SUGGEST — LLM sugere, você aprova</option>
                        <option value="LLM_CREATE_DRAFTS">LLM_CREATE_DRAFTS — LLM cria rascunhos</option>
                        <option value="LLM_AUTO_APPROVE_WITH_BUDGET">
                            LLM_AUTO_APPROVE_WITH_BUDGET — Automático com orçamento
                        </option>
                    </select>
                    <div class="text-xs text-slate-500 mt-1">Define o nível de automação da LLM para esta missão.</div>
                </div>
                <div>
                    <label class="text-sm text-slate-300 font-medium"
                        >Motivo operacional <span class="text-red-400">*</span></label
                    >
                    <Input v-model="createForm.reason" placeholder="Ex: iniciar nova frente para cliente X" />
                    <div class="text-xs text-slate-500 mt-1">Obrigatório para audit trail.</div>
                </div>
            </div>

            <template #footer>
                <div class="flex justify-end gap-2 w-full">
                    <Button variant="ghost" size="sm" @click="showCreate = false">Cancelar</Button>
                    <Button variant="primary" size="sm" @click="createMission" :disabled="creating">
                        {{ creating ? 'Criando...' : 'Criar' }}
                    </Button>
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
