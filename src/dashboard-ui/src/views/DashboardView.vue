<script setup>
import { http } from '@/lib/http';
import { Activity, AlertCircle, BarChart3, CheckCircle, Clock, ListTodo, TrendingUp } from 'lucide-vue-next';
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import TaskCard from '../components/tasks/TaskCard.vue';
import { useSocket } from '../composables/useSocket';

const router = useRouter();

const tasks = ref([]);
const metrics = ref({
    totalTasks: 0,
    runningTasks: 0,
    completedTasks: 0,
    failedTasks: 0,
    avgExecutionTime: 0,
    successRate: 0,
});

const loading = ref(false);
const { isConnected, connect, disconnect, subscribe, unsubscribe } = useSocket();

const recentTasks = computed(() => {
    return tasks.value.slice(0, 6);
});

const statsCards = computed(() => [
    {
        title: 'Running',
        value: metrics.value.runningTasks,
        icon: Clock,
        variant: 'info',
        trend: null,
    },
    {
        title: 'Completed',
        value: metrics.value.completedTasks,
        icon: CheckCircle,
        variant: 'success',
        trend: null,
    },
    {
        title: 'Failed',
        value: metrics.value.failedTasks,
        icon: AlertCircle,
        variant: 'error',
        trend: null,
    },
    {
        title: 'Success Rate',
        value: `${metrics.value.successRate.toFixed(1)}%`,
        icon: TrendingUp,
        variant: 'default',
        trend: null,
    },
]);

const fetchDashboardData = async () => {
    loading.value = true;

    try {
        const [tasksResponse, metricsResponse] = await Promise.all([
            http.get('/api/dashboard/tasks'),
            http.get('/api/dashboard/metrics'),
        ]);

        tasks.value = tasksResponse.data.tasks || [];

        const tasksData = tasksResponse.data.tasks || [];
        const completed = tasksData.filter(t => t.unified_status === 'DONE').length;
        const failed = tasksData.filter(t => t.unified_status === 'FAILED').length;
        const total = completed + failed;

        metrics.value = {
            totalTasks: tasksData.length,
            runningTasks: tasksData.filter(t => t.unified_status === 'RUNNING').length,
            completedTasks: completed,
            failedTasks: failed,
            avgExecutionTime: metricsResponse.data.avgExecutionTime || 0,
            successRate: total > 0 ? (completed / total) * 100 : 0,
        };
    } catch (err) {
        console.error('[Dashboard] Failed to fetch data:', err);
    } finally {
        loading.value = false;
    }
};

const handleTaskUpdated = () => {
    fetchDashboardData();
};

const handleViewTask = task => {
    router.push(`/tasks/${task.meta?.id}`);
};

const navigateToTasks = () => {
    router.push('/tasks');
};

onMounted(() => {
    fetchDashboardData();

    connect();
    subscribe('task:updated', handleTaskUpdated);
    subscribe('task:updates_batch', handleTaskUpdated);
    subscribe('task:created', handleTaskUpdated);
    subscribe('task:completed', handleTaskUpdated);
});

onUnmounted(() => {
    unsubscribe('task:updated', handleTaskUpdated);
    unsubscribe('task:updates_batch', handleTaskUpdated);
    unsubscribe('task:created', handleTaskUpdated);
    unsubscribe('task:completed', handleTaskUpdated);
    disconnect();
});
</script>

<template>
    <div class="space-y-8 pb-8">
        <!-- Hero Header -->
        <div
            class="relative overflow-hidden rounded-2xl bg-gradient-to-br from-blue-600 via-blue-700 to-indigo-900 p-8 shadow-2xl"
        >
            <div
                class="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNjAiIGhlaWdodD0iNjAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PGRlZnM+PHBhdHRlcm4gaWQ9ImdyaWQiIHdpZHRoPSI2MCIgaGVpZ2h0PSI2MCIgcGF0dGVyblVuaXRzPSJ1c2VyU3BhY2VPblVzZSI+PHBhdGggZD0iTSAxMCAwIEwgMCAwIDAgMTAiIGZpbGw9Im5vbmUiIHN0cm9rZT0id2hpdGUiIHN0cm9rZS1vcGFjaXR5PSIwLjA1IiBzdHJva2Utd2lkdGg9IjEiLz48L3BhdHRlcm4+PC9kZWZzPjxyZWN0IHdpZHRoPSIxMDAlIiBoZWlnaHQ9IjEwMCUiIGZpbGw9InVybCgjZ3JpZCkiLz48L3N2Zz4=')] opacity-30"
            ></div>
            <div class="relative">
                <div class="flex items-center justify-between">
                    <div>
                        <h1 class="text-4xl font-bold text-white mb-2 tracking-tight">Mission Control</h1>
                        <p class="text-blue-100 text-lg">
                            Dashboard overview
                            <span
                                v-if="isConnected"
                                class="inline-flex items-center gap-2 ml-3 px-3 py-1 rounded-full bg-white/20 backdrop-blur-sm"
                            >
                                <span
                                    class="w-2 h-2 bg-green-400 rounded-full animate-pulse shadow-lg shadow-green-400/50"
                                ></span>
                                <span class="text-sm font-medium">Live</span>
                            </span>
                        </p>
                    </div>
                    <div class="hidden md:flex items-center gap-3">
                        <div class="text-right">
                            <div class="text-3xl font-bold text-white">{{ metrics.totalTasks }}</div>
                            <div class="text-sm text-blue-200">Total Tasks</div>
                        </div>
                    </div>
                </div>
            </div>
        </div>

        <!-- Stats Cards -->
        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            <div
                v-for="stat in statsCards"
                :key="stat.title"
                class="group relative overflow-hidden rounded-xl bg-gradient-to-br border border-white/10 p-6 shadow-lg transition-all duration-300 hover:scale-105 hover:shadow-2xl cursor-pointer"
                :class="[
                    stat.variant === 'info' &&
                        'from-blue-600/20 to-blue-800/20 hover:from-blue-600/30 hover:to-blue-800/30 hover:border-blue-500/50',
                    stat.variant === 'success' &&
                        'from-emerald-600/20 to-emerald-800/20 hover:from-emerald-600/30 hover:to-emerald-800/30 hover:border-emerald-500/50',
                    stat.variant === 'error' &&
                        'from-red-600/20 to-red-800/20 hover:from-red-600/30 hover:to-red-800/30 hover:border-red-500/50',
                    stat.variant === 'default' &&
                        'from-violet-600/20 to-violet-800/20 hover:from-violet-600/30 hover:to-violet-800/30 hover:border-violet-500/50',
                ]"
            >
                <div
                    class="absolute inset-0 bg-gradient-to-br from-white/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300"
                ></div>
                <div class="relative flex items-start justify-between">
                    <div class="flex-1">
                        <p class="text-sm font-medium text-gray-400 uppercase tracking-wide mb-2">{{ stat.title }}</p>
                        <p class="text-3xl font-bold text-white mt-1 transition-all duration-300 group-hover:scale-110">
                            {{ loading ? '—' : stat.value }}
                        </p>
                    </div>
                    <div
                        :class="[
                            'p-3 rounded-xl backdrop-blur-sm transition-all duration-300 group-hover:scale-110 group-hover:rotate-6',
                            stat.variant === 'success' && 'bg-emerald-500/20 shadow-lg shadow-emerald-500/20',
                            stat.variant === 'error' && 'bg-red-500/20 shadow-lg shadow-red-500/20',
                            stat.variant === 'info' && 'bg-blue-500/20 shadow-lg shadow-blue-500/20',
                            stat.variant === 'default' && 'bg-violet-500/20 shadow-lg shadow-violet-500/20',
                        ]"
                    >
                        <component
                            :is="stat.icon"
                            :size="28"
                            :class="[
                                'transition-colors duration-300',
                                stat.variant === 'success' && 'text-emerald-400',
                                stat.variant === 'error' && 'text-red-400',
                                stat.variant === 'info' && 'text-blue-400',
                                stat.variant === 'default' && 'text-violet-400',
                            ]"
                        />
                    </div>
                </div>
            </div>
        </div>

        <!-- Recent Tasks Card -->
        <div class="relative overflow-hidden rounded-2xl bg-gradient-to-br from-slate-800/50 to-slate-900/50 border border-slate-700/50 shadow-xl backdrop-blur-sm">
            <div class="absolute inset-0 bg-gradient-to-br from-indigo-600/5 to-transparent pointer-events-none"></div>
            <div class="relative px-6 py-5 border-b border-slate-700/50 bg-gradient-to-r from-slate-800/50 to-transparent">
                <div class="flex items-center justify-between">
                    <div class="flex items-center gap-3">
                        <div class="p-2 rounded-lg bg-indigo-500/10 border border-indigo-500/20">
                            <Activity :size="20" class="text-indigo-400" />
                        </div>
                        <h2 class="text-xl font-bold text-white">Recent Tasks</h2>
                    </div>
                    <button
                        @click="navigateToTasks"
                        class="px-4 py-2 rounded-lg bg-slate-700/50 hover:bg-slate-600/50 text-white text-sm font-medium transition-all duration-300 hover:scale-105 border border-slate-600/50 hover:border-slate-500/50"
                    >
                        View all
                    </button>
                </div>
            </div>

            <div class="px-6 py-6">
                <div v-if="loading" class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    <div v-for="i in 6" :key="i" class="h-32 bg-slate-800/50 rounded-xl animate-pulse border border-slate-700/50"></div>
                </div>

                <div v-else-if="recentTasks.length === 0" class="text-center py-16">
                    <div class="w-20 h-20 mx-auto mb-4 rounded-full bg-slate-800/50 border border-slate-700/50 flex items-center justify-center">
                        <Activity :size="32" class="text-gray-500" />
                    </div>
                    <p class="text-gray-400 text-lg mb-4">No tasks yet</p>
                    <button
                        @click="navigateToTasks"
                        class="px-6 py-3 rounded-xl bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 text-white font-semibold transition-all duration-300 hover:scale-105 shadow-lg shadow-blue-600/30"
                    >
                        Create your first task
                    </button>
                </div>

                <div v-else class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    <TaskCard v-for="task in recentTasks" :key="task.meta?.id" :task="task" @view="handleViewTask" />
                </div>
            </div>
        </div>

        <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <!-- System Status Card -->
            <div class="relative overflow-hidden rounded-2xl bg-gradient-to-br from-slate-800/50 to-slate-900/50 border border-slate-700/50 p-6 shadow-xl backdrop-blur-sm">
                <div class="absolute inset-0 bg-gradient-to-br from-blue-600/5 to-transparent pointer-events-none"></div>
                <div class="relative">
                    <div class="flex items-center gap-3 mb-6">
                        <div class="p-2 rounded-lg bg-blue-500/10 border border-blue-500/20">
                            <Activity :size="20" class="text-blue-400" />
                        </div>
                        <h2 class="text-xl font-bold text-white">System Status</h2>
                    </div>
                    <div class="space-y-4">
                        <div class="flex items-center justify-between py-3 px-4 rounded-xl bg-slate-800/50 border border-slate-700/50 hover:border-blue-500/30 transition-all duration-300">
                            <span class="text-sm font-medium text-gray-300">Connection</span>
                            <div class="flex items-center gap-2">
                                <span class="w-2 h-2 rounded-full" :class="isConnected ? 'bg-emerald-400 animate-pulse shadow-lg shadow-emerald-400/50' : 'bg-red-400'"></span>
                                <span class="text-sm font-bold" :class="isConnected ? 'text-emerald-400' : 'text-red-400'">
                                    {{ isConnected ? 'Connected' : 'Disconnected' }}
                                </span>
                            </div>
                        </div>
                        <div class="flex items-center justify-between py-3 px-4 rounded-xl bg-slate-800/50 border border-slate-700/50 hover:border-blue-500/30 transition-all duration-300">
                            <span class="text-sm font-medium text-gray-300">Total Tasks</span>
                            <span class="text-lg font-bold text-white">{{ metrics.totalTasks }}</span>
                        </div>
                        <div class="flex items-center justify-between py-3 px-4 rounded-xl bg-slate-800/50 border border-slate-700/50 hover:border-blue-500/30 transition-all duration-300">
                            <span class="text-sm font-medium text-gray-300">Avg. Execution Time</span>
                            <span class="text-lg font-bold text-white">
                                {{
                                    metrics.avgExecutionTime > 0
                                        ? `${(metrics.avgExecutionTime / 1000).toFixed(1)}s`
                                        : 'N/A'
                                }}
                            </span>
                        </div>
                    </div>
                </div>
            </div>

            <!-- Quick Actions Card -->
            <div class="relative overflow-hidden rounded-2xl bg-gradient-to-br from-slate-800/50 to-slate-900/50 border border-slate-700/50 p-6 shadow-xl backdrop-blur-sm">
                <div class="absolute inset-0 bg-gradient-to-br from-violet-600/5 to-transparent pointer-events-none"></div>
                <div class="relative">
                    <div class="flex items-center gap-3 mb-6">
                        <div class="p-2 rounded-lg bg-violet-500/10 border border-violet-500/20">
                            <Activity :size="20" class="text-violet-400" />
                        </div>
                        <h2 class="text-xl font-bold text-white">Quick Actions</h2>
                    </div>
                    <div class="space-y-3">
                        <button
                            @click="navigateToTasks"
                            class="group w-full flex items-center gap-3 px-4 py-3.5 rounded-xl bg-gradient-to-r from-blue-600/20 to-blue-700/20 border border-blue-500/30 hover:from-blue-600/30 hover:to-blue-700/30 hover:border-blue-400/50 transition-all duration-300 hover:scale-[1.02] hover:shadow-lg hover:shadow-blue-500/20"
                        >
                            <ListTodo :size="18" class="text-blue-400 group-hover:scale-110 transition-transform duration-300" />
                            <span class="text-sm font-semibold text-white">View all tasks</span>
                        </button>
                        <button
                            @click="router.push('/metrics')"
                            class="group w-full flex items-center gap-3 px-4 py-3.5 rounded-xl bg-gradient-to-r from-emerald-600/20 to-emerald-700/20 border border-emerald-500/30 hover:from-emerald-600/30 hover:to-emerald-700/30 hover:border-emerald-400/50 transition-all duration-300 hover:scale-[1.02] hover:shadow-lg hover:shadow-emerald-500/20"
                        >
                            <BarChart3 :size="18" class="text-emerald-400 group-hover:scale-110 transition-transform duration-300" />
                            <span class="text-sm font-semibold text-white">View metrics</span>
                        </button>
                        <button
                            @click="router.push('/health')"
                            class="group w-full flex items-center gap-3 px-4 py-3.5 rounded-xl bg-gradient-to-r from-violet-600/20 to-violet-700/20 border border-violet-500/30 hover:from-violet-600/30 hover:to-violet-700/30 hover:border-violet-400/50 transition-all duration-300 hover:scale-[1.02] hover:shadow-lg hover:shadow-violet-500/20"
                        >
                            <Activity :size="18" class="text-violet-400 group-hover:scale-110 transition-transform duration-300" />
                            <span class="text-sm font-semibold text-white">System health</span>
                        </button>
                    </div>
                </div>
            </div>
        </div>
    </div>
</template>
