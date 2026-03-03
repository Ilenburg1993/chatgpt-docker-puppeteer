<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { http, formatHttpError } from '@/lib/http';
import Card from '@/components/ui/Card.vue';
import Button from '@/components/ui/Button.vue';
import Badge from '@/components/ui/Badge.vue';
import { useTasksVNextStore } from '@/stores/tasks_vnext';
import { useMissionsVNextStore } from '@/stores/missions_vnext';
import { useSocket } from '@/composables/useSocket';
import { useSsotRealtime } from '@/composables/useSsotRealtime';

const router = useRouter();
const tasks = useTasksVNextStore();
const missions = useMissionsVNextStore();
const { isConnected } = useSocket();
useSsotRealtime();

const loading = ref(false);
const error = ref(null);
const stats = ref({ total: 0, by_status: {}, by_stage: {} });
const uptimeMs = ref(0);
const refreshCount = ref(0);
let uptimeTimer = null;

const pending = computed(() => Number(stats.value.by_status?.PENDING || 0));
const running = computed(() => Number(stats.value.by_status?.RUNNING || 0));
const blocked = computed(() => Number(stats.value.by_status?.BLOCKED || 0));
const failed = computed(() => Number(stats.value.by_status?.FAILED || 0));
const done = computed(() => Number(stats.value.by_status?.DONE || 0));
const paused = computed(() => Number(stats.value.by_status?.PAUSED || 0));
const cancelled = computed(() => Number(stats.value.by_status?.CANCELLED || 0));
const totalTasks = computed(() => Number(stats.value.total || 0));
const totalMissions = computed(() => missions.items?.length || 0);
const activeMissions = computed(
    () => missions.items?.filter(m => m.status === 'RUNNING' || m.status === 'READY').length || 0
);

const uptimeFormatted = computed(() => {
    const s = Math.floor(uptimeMs.value / 1000);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
});

const completionRate = computed(() => {
    const total = totalTasks.value;
    if (total === 0) return 0;
    return Math.round((done.value / total) * 100);
});

const failureRate = computed(() => {
    const total = totalTasks.value;
    if (total === 0) return 0;
    return Math.round((failed.value / total) * 100);
});

async function refresh() {
    loading.value = true;
    error.value = null;
    refreshCount.value++;
    try {
        const [tasksStatsRes] = await Promise.all([
            http.get('/api/dashboard/tasks-stats'),
            missions.fetchFirstPage({ limit: 20 }),
            tasks.fetchFirstPage({ limit: 50 }),
        ]);
        stats.value = tasksStatsRes.data?.data || { total: 0, by_status: {}, by_stage: {} };
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

onMounted(() => {
    refresh();
    uptimeTimer = setInterval(() => {
        uptimeMs.value += 1000;
    }, 1000);
});

onUnmounted(() => {
    if (uptimeTimer) clearInterval(uptimeTimer);
});
</script>

<template>
    <div class="space-y-6 animate-fade-in">
        <!-- Header with NERV status -->
        <div class="flex items-center justify-between">
            <div>
                <h1 class="text-2xl font-bold text-white tracking-tight">
                    Mission Control
                    <span class="text-sm font-normal text-cyan-400/80 ml-2">// NERV</span>
                </h1>
                <div class="flex items-center gap-4 mt-1">
                    <span class="text-sm text-slate-400">SSOT · SQLite · Realtime</span>
                    <span v-if="isConnected" class="flex items-center gap-1.5 text-xs text-emerald-400">
                        <span class="w-2 h-2 rounded-full bg-emerald-400 animate-pulse-live"></span>
                        CONECTADO
                    </span>
                    <span v-else class="flex items-center gap-1.5 text-xs text-slate-500">
                        <span class="w-2 h-2 rounded-full bg-slate-500"></span>
                        DESCONECTADO
                    </span>
                </div>
            </div>
            <div class="flex items-center gap-3">
                <div class="text-xs font-mono text-slate-500">uptime {{ uptimeFormatted }}</div>
                <Button variant="secondary" size="sm" @click="refresh" :disabled="loading"> Atualizar </Button>
                <Button variant="primary" size="sm" @click="router.push('/tasks')"> Ir para tarefas </Button>
            </div>
        </div>

        <!-- Error display -->
        <div v-if="error" class="p-4 rounded-xl border border-red-500/30 bg-red-950/20 text-red-300 text-sm">
            <span class="font-mono text-red-400">ERR</span> {{ error }}
        </div>

        <!-- Telemetry Strip -->
        <div class="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3">
            <div class="surface-card px-3 py-2.5 stat-card-pending">
                <div class="text-[10px] uppercase tracking-wider text-amber-400/70 font-semibold">Pendentes</div>
                <div class="text-xl font-bold text-white font-mono">{{ loading ? '—' : pending }}</div>
            </div>
            <div class="surface-card px-3 py-2.5 stat-card-running">
                <div class="text-[10px] uppercase tracking-wider text-blue-400/70 font-semibold">Em execução</div>
                <div class="text-xl font-bold text-white font-mono">{{ loading ? '—' : running }}</div>
            </div>
            <div class="surface-card px-3 py-2.5 stat-card-done">
                <div class="text-[10px] uppercase tracking-wider text-emerald-400/70 font-semibold">Concluídas</div>
                <div class="text-xl font-bold text-white font-mono">{{ loading ? '—' : done }}</div>
            </div>
            <div class="surface-card px-3 py-2.5 stat-card-failed">
                <div class="text-[10px] uppercase tracking-wider text-red-400/70 font-semibold">Falhas</div>
                <div class="text-xl font-bold text-white font-mono">{{ loading ? '—' : failed }}</div>
            </div>
            <div class="surface-card px-3 py-2.5 stat-card-blocked">
                <div class="text-[10px] uppercase tracking-wider text-amber-400/70 font-semibold">Bloqueadas</div>
                <div class="text-xl font-bold text-white font-mono">{{ loading ? '—' : blocked }}</div>
            </div>
            <div class="surface-card px-3 py-2.5">
                <div class="text-[10px] uppercase tracking-wider text-slate-400/70 font-semibold">Pausadas</div>
                <div class="text-xl font-bold text-white font-mono">{{ loading ? '—' : paused }}</div>
            </div>
            <div class="surface-card px-3 py-2.5">
                <div class="text-[10px] uppercase tracking-wider text-cyan-400/70 font-semibold">Completion</div>
                <div class="text-xl font-bold text-white font-mono">{{ loading ? '—' : completionRate }}%</div>
            </div>
            <div class="surface-card px-3 py-2.5">
                <div class="text-[10px] uppercase tracking-wider text-red-400/50 font-semibold">Failure Rate</div>
                <div class="text-xl font-bold text-white font-mono">{{ loading ? '—' : failureRate }}%</div>
            </div>
        </div>

        <!-- System Summary Row -->
        <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div class="surface-card px-4 py-3 flex items-center justify-between">
                <div>
                    <div class="text-[10px] uppercase tracking-wider text-slate-400 font-semibold">Total Tasks</div>
                    <div class="text-2xl font-bold text-white font-mono mt-0.5">{{ totalTasks }}</div>
                </div>
                <div class="w-10 h-10 rounded-lg bg-blue-500/10 flex items-center justify-center">
                    <span class="text-blue-400 text-lg">⚡</span>
                </div>
            </div>
            <div class="surface-card px-4 py-3 flex items-center justify-between">
                <div>
                    <div class="text-[10px] uppercase tracking-wider text-slate-400 font-semibold">Missões</div>
                    <div class="text-2xl font-bold text-white font-mono mt-0.5">{{ totalMissions }}</div>
                    <div class="text-xs text-cyan-400 mt-0.5">{{ activeMissions }} ativas</div>
                </div>
                <div class="w-10 h-10 rounded-lg bg-cyan-500/10 flex items-center justify-center">
                    <span class="text-cyan-400 text-lg">🎯</span>
                </div>
            </div>
            <div class="surface-card px-4 py-3 flex items-center justify-between">
                <div>
                    <div class="text-[10px] uppercase tracking-wider text-slate-400 font-semibold">NERV Status</div>
                    <div class="text-sm font-semibold mt-1" :class="isConnected ? 'text-emerald-400' : 'text-red-400'">
                        {{ isConnected ? 'ONLINE' : 'OFFLINE' }}
                    </div>
                    <div class="text-xs text-slate-500 mt-0.5">refreshes: {{ refreshCount }}</div>
                </div>
                <div
                    class="w-10 h-10 rounded-lg flex items-center justify-center"
                    :class="isConnected ? 'bg-emerald-500/10' : 'bg-red-500/10'"
                >
                    <span :class="isConnected ? 'text-emerald-400' : 'text-red-400'" class="text-lg">🔗</span>
                </div>
            </div>
        </div>

        <!-- Tasks and Missions panels -->
        <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <!-- Recent Tasks -->
            <div class="surface-card overflow-hidden">
                <div class="px-4 py-3 border-b border-slate-800/50 flex items-center justify-between">
                    <div class="text-sm font-semibold text-slate-200">Tarefas recentes</div>
                    <Button variant="ghost" size="sm" @click="router.push('/tasks')" class="text-xs"
                        >Ver todas →</Button
                    >
                </div>
                <div class="p-3">
                    <div v-if="tasks.items.length === 0" class="text-sm text-slate-500 py-4 text-center">
                        Sem tarefas registradas.
                    </div>
                    <div v-else class="space-y-1.5">
                        <div
                            v-for="t in tasks.items.slice(0, 8)"
                            :key="t.id"
                            class="px-3 py-2 rounded-lg border border-slate-800/30 bg-slate-950/30 hover:bg-slate-900/40 hover:border-blue-500/20 cursor-pointer transition-all duration-150"
                            @click="router.push(`/tasks/${t.id}`)"
                        >
                            <div class="flex items-start justify-between gap-3">
                                <div class="min-w-0 flex-1">
                                    <div class="text-xs font-mono text-slate-300 truncate">{{ t.id }}</div>
                                    <div class="text-xs text-slate-500 truncate mt-0.5">
                                        {{ t.spec_user_message_preview || '—' }}
                                    </div>
                                </div>
                                <div class="flex items-center gap-1.5 flex-shrink-0">
                                    <Badge size="sm">{{ t.stage }}</Badge>
                                    <Badge size="sm" :variant="statusVariant(t.unified_status)">{{
                                        t.unified_status
                                    }}</Badge>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <!-- Missions -->
            <div class="surface-card overflow-hidden">
                <div class="px-4 py-3 border-b border-slate-800/50 flex items-center justify-between">
                    <div class="text-sm font-semibold text-slate-200">Missões</div>
                    <Button variant="ghost" size="sm" @click="router.push('/missions')" class="text-xs"
                        >Ver todas →</Button
                    >
                </div>
                <div class="p-3">
                    <div v-if="missions.items.length === 0" class="text-sm text-slate-500 py-4 text-center">
                        Sem missões registradas.
                    </div>
                    <div v-else class="space-y-1.5">
                        <div
                            v-for="m in missions.items.slice(0, 8)"
                            :key="m.id"
                            class="px-3 py-2 rounded-lg border border-slate-800/30 bg-slate-950/30 hover:bg-slate-900/40 hover:border-cyan-500/20 cursor-pointer transition-all duration-150"
                            @click="router.push(`/missions/${m.id}`)"
                        >
                            <div class="flex items-start justify-between gap-3">
                                <div class="min-w-0 flex-1">
                                    <div class="text-sm font-semibold text-slate-200 truncate">
                                        {{ m.title || '(sem título)' }}
                                    </div>
                                    <div class="text-xs text-slate-500 truncate font-mono">{{ m.id }}</div>
                                </div>
                                <div class="flex items-center gap-1.5 flex-shrink-0 flex-wrap justify-end">
                                    <Badge size="sm" :variant="statusVariant(m.status)">{{ m.status }}</Badge>
                                    <Badge v-if="m.counts?.running > 0" size="sm" variant="info"
                                        >{{ m.counts.running }} run</Badge
                                    >
                                    <Badge v-if="m.counts?.done > 0" size="sm" variant="success"
                                        >{{ m.counts.done }} done</Badge
                                    >
                                    <Badge v-if="m.counts?.failed > 0" size="sm" variant="error"
                                        >{{ m.counts.failed }} fail</Badge
                                    >
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </div>
</template>
