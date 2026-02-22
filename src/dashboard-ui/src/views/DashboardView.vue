<script setup>
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { http } from '@/lib/http';
import { formatHttpError } from '@/lib/http';
import Card from '@/components/ui/Card.vue';
import Button from '@/components/ui/Button.vue';
import Badge from '@/components/ui/Badge.vue';
import { useTasksVNextStore } from '@/stores/tasks_vnext';
import { useMissionsVNextStore } from '@/stores/missions_vnext';
import { useSocket } from '@/composables/useSocket';

const router = useRouter();
const tasks = useTasksVNextStore();
const missions = useMissionsVNextStore();
const { isConnected } = useSocket();

const loading = ref(false);
const error = ref(null);
const stats = ref({ total: 0, by_status: {} });

const pending = computed(() => Number(stats.value.by_status?.PENDING || 0));
const running = computed(() => Number(stats.value.by_status?.RUNNING || 0));
const blocked = computed(() => Number(stats.value.by_status?.BLOCKED || 0));
const proposed = computed(() => Number(stats.value.by_status?.PROPOSED || 0)); // usually 0 (stage)
const failed = computed(() => Number(stats.value.by_status?.FAILED || 0));
const done = computed(() => Number(stats.value.by_status?.DONE || 0));

async function refresh() {
    loading.value = true;
    error.value = null;
    try {
        const [tasksStatsRes] = await Promise.all([
            http.get('/api/dashboard/tasks-stats'),
            missions.fetchFirstPage({ limit: 20 }),
            tasks.fetchFirstPage({ limit: 50 }),
        ]);
        stats.value = tasksStatsRes.data?.data || { total: 0, by_status: {} };
    } catch (err) {
        error.value = formatHttpError(err).message;
    } finally {
        loading.value = false;
    }
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

onMounted(refresh);
</script>

<template>
    <div class="space-y-6">
        <div class="flex items-center justify-between">
            <div>
                <h1 class="text-2xl font-bold text-white">Visão geral</h1>
                <p class="text-sm text-slate-300 mt-1">
                    SSOT (SQLite) + realtime
                    <span v-if="isConnected" class="ml-2 text-xs text-emerald-300">• conectado</span>
                    <span v-else class="ml-2 text-xs text-slate-400">• desconectado</span>
                </p>
            </div>
            <div class="flex items-center gap-2">
                <Button variant="secondary" size="sm" @click="refresh" :disabled="loading">Atualizar</Button>
                <Button variant="primary" size="sm" @click="router.push('/tasks')">Ir para tarefas</Button>
            </div>
        </div>

        <div v-if="error" class="p-4 rounded-xl border border-red-500/30 bg-red-950/30 text-red-200">
            {{ error }}
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <Card>
                <template #header><div class="text-sm font-semibold text-slate-200">Pendentes</div></template>
                <div class="text-3xl font-bold text-white">{{ loading ? '—' : pending }}</div>
            </Card>
            <Card>
                <template #header><div class="text-sm font-semibold text-slate-200">Em execução</div></template>
                <div class="text-3xl font-bold text-white">{{ loading ? '—' : running }}</div>
            </Card>
            <Card>
                <template #header><div class="text-sm font-semibold text-slate-200">Bloqueadas</div></template>
                <div class="text-3xl font-bold text-white">{{ loading ? '—' : blocked }}</div>
            </Card>
            <Card>
                <template #header><div class="text-sm font-semibold text-slate-200">Falhas</div></template>
                <div class="text-3xl font-bold text-white">{{ loading ? '—' : failed }}</div>
            </Card>
        </div>

        <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card>
                <template #header>
                    <div class="flex items-center justify-between">
                        <div class="text-sm font-semibold text-slate-200">Tarefas recentes</div>
                        <Button variant="ghost" size="sm" @click="router.push('/tasks')">Ver todas</Button>
                    </div>
                </template>
                <div v-if="tasks.items.length === 0" class="text-sm text-slate-400">Sem tarefas.</div>
                <div v-else class="space-y-2">
                    <div
                        v-for="t in tasks.items.slice(0, 8)"
                        :key="t.id"
                        class="px-3 py-2 rounded-lg border border-slate-800 bg-slate-950/40 hover:bg-slate-900/40 cursor-pointer"
                        @click="router.push(`/tasks/${t.id}`)"
                    >
                        <div class="flex items-start justify-between gap-4">
                            <div class="min-w-0">
                                <div class="text-xs font-mono text-slate-200 truncate">{{ t.id }}</div>
                                <div class="text-xs text-slate-400 truncate">{{ t.spec_user_message_preview }}</div>
                            </div>
                            <div class="flex items-center gap-2">
                                <Badge size="sm">{{ t.stage }}</Badge>
                                <Badge size="sm" :variant="statusVariant(t.unified_status)">{{
                                    t.unified_status
                                }}</Badge>
                            </div>
                        </div>
                    </div>
                </div>
            </Card>

            <Card>
                <template #header>
                    <div class="flex items-center justify-between">
                        <div class="text-sm font-semibold text-slate-200">Missões</div>
                        <Button variant="ghost" size="sm" @click="router.push('/missions')">Ver todas</Button>
                    </div>
                </template>
                <div v-if="missions.items.length === 0" class="text-sm text-slate-400">Sem missões.</div>
                <div v-else class="space-y-2">
                    <div
                        v-for="m in missions.items.slice(0, 8)"
                        :key="m.id"
                        class="px-3 py-2 rounded-lg border border-slate-800 bg-slate-950/40 hover:bg-slate-900/40 cursor-pointer"
                        @click="router.push(`/missions/${m.id}`)"
                    >
                        <div class="flex items-start justify-between gap-4">
                            <div class="min-w-0">
                                <div class="text-sm font-semibold text-slate-200 truncate">{{ m.title }}</div>
                                <div class="text-xs text-slate-400 truncate font-mono">{{ m.id }}</div>
                            </div>
                            <div class="flex items-center gap-2">
                                <Badge size="sm" :variant="statusVariant(m.status)">{{ m.status }}</Badge>
                                <Badge size="sm">prop: {{ m.counts?.proposed ?? 0 }}</Badge>
                            </div>
                        </div>
                    </div>
                </div>
            </Card>
        </div>
    </div>
</template>
