<script setup>
import VisGraph from '@/components/graphs/VisGraph.vue';
import Badge from '@/components/ui/Badge.vue';
import Button from '@/components/ui/Button.vue';
import { formatHttpError, http } from '@/lib/http';
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';

const route = useRoute();
const router = useRouter();

const loading = ref(false);
const error = ref(null);
const data = ref(null);

const workflowId = computed(() => String(route.params.workflowId || ''));

const nodes = computed(() => {
    const tasks = data.value?.tasks || [];
    return tasks.map((t) => ({
        id: t.id,
        label: `${t.id}\n${t.unified_status} · ${t.stage}`,
        title: t.spec_user_message_preview || '',
        color:
            t.unified_status === 'DONE'
                ? { background: '#052e16', border: '#16a34a' }
                : t.unified_status === 'RUNNING'
                  ? { background: '#1e3a8a', border: '#60a5fa' }
                  : t.unified_status === 'FAILED'
                    ? { background: '#450a0a', border: '#ef4444' }
                    : t.unified_status === 'BLOCKED'
                      ? { background: '#422006', border: '#f59e0b' }
                      : { background: '#0f172a', border: '#334155' },
    }));
});

const edges = computed(() => {
    const list = data.value?.edges || [];
    return list.map((e) => ({ from: e.depends_on_task_id, to: e.task_id }));
});

async function fetchWorkflow() {
    if (!workflowId.value) return;
    loading.value = true;
    error.value = null;
    try {
        const res = await http.get(`/api/dashboard/workflows/${workflowId.value}`);
        data.value = res.data?.data || null;
    } catch (err) {
        error.value = formatHttpError(err).message;
    } finally {
        loading.value = false;
    }
}

onMounted(fetchWorkflow);
watch(workflowId, () => void fetchWorkflow());
</script>

<template>
    <div class="space-y-6">
        <div class="flex items-center justify-between">
            <div>
                <h1 class="text-2xl font-bold text-white">Workflow</h1>
                <p class="text-sm text-slate-300 mt-1 font-mono">{{ workflowId }}</p>
            </div>
            <div class="flex items-center gap-2">
                <Button variant="ghost" size="sm" @click="router.back()">Voltar</Button>
                <Button variant="secondary" size="sm" @click="fetchWorkflow" :disabled="loading">Atualizar</Button>
            </div>
        </div>

        <div v-if="error" class="p-4 rounded-xl border border-red-500/30 bg-red-950/30 text-red-200">
            {{ error }}
        </div>

        <div v-if="loading" class="text-slate-300">Carregando…</div>

        <div v-else-if="data">
            <VisGraph :nodes="nodes" :edges="edges" height="520px" />

            <div class="mt-6 rounded-xl border border-slate-700/50 bg-slate-950/40 backdrop-blur-sm overflow-hidden">
                <div class="px-4 py-3 border-b border-slate-700/50 text-slate-200 font-semibold">Tarefas</div>
                <div class="divide-y divide-slate-800">
                    <div
                        v-for="t in data.tasks"
                        :key="t.id"
                        class="px-4 py-3 flex items-start justify-between gap-4 hover:bg-slate-900/40 cursor-pointer"
                        @click="router.push(`/tasks/${t.id}`)"
                    >
                        <div class="min-w-0">
                            <div class="text-sm font-mono text-slate-200 truncate">{{ t.id }}</div>
                            <div class="text-xs text-slate-400 truncate">{{ t.spec_user_message_preview }}</div>
                        </div>
                        <div class="flex items-center gap-2">
                            <Badge size="sm">{{ t.stage }}</Badge>
                            <Badge
                                size="sm"
                                :variant="
                                    t.unified_status === 'DONE'
                                        ? 'success'
                                        : t.unified_status === 'FAILED'
                                          ? 'error'
                                          : 'default'
                                "
                            >
                                {{ t.unified_status }}
                            </Badge>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </div>
</template>
