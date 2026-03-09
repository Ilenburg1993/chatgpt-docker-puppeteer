<template>
    <div class="p-6">
        <h1 class="text-2xl font-bold mb-6">🎯 Painel do Audit Agent</h1>

        <!-- Navigation Cards -->
        <div class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
            <router-link
                to="/audit/jobs"
                class="p-6 bg-white rounded-lg shadow hover:shadow-md transition border border-gray-200"
            >
                <div class="flex items-center gap-3">
                    <svg class="w-8 h-8 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path
                            stroke-linecap="round"
                            stroke-linejoin="round"
                            stroke-width="2"
                            d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
                        />
                    </svg>
                    <div>
                        <h3 class="font-semibold text-lg">Jobs de Auditoria</h3>
                        <p class="text-sm text-gray-500">Gerenciar jobs de auditoria</p>
                    </div>
                </div>
            </router-link>

            <router-link
                to="/audit/inference"
                class="p-6 bg-white rounded-lg shadow hover:shadow-md transition border border-gray-200"
            >
                <div class="flex items-center gap-3">
                    <svg class="w-8 h-8 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path
                            stroke-linecap="round"
                            stroke-linejoin="round"
                            stroke-width="2"
                            d="M13 10V3L4 14h7v7l9-11h-7z"
                        />
                    </svg>
                    <div>
                        <h3 class="font-semibold text-lg">Inference Gateway</h3>
                        <p class="text-sm text-gray-500">Configuração de LLMs</p>
                    </div>
                </div>
            </router-link>

            <router-link
                to="/dashboard"
                class="p-6 bg-white rounded-lg shadow hover:shadow-md transition border border-gray-200"
            >
                <div class="flex items-center gap-3">
                    <svg class="w-8 h-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path
                            stroke-linecap="round"
                            stroke-linejoin="round"
                            stroke-width="2"
                            d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"
                        />
                    </svg>
                    <div>
                        <h3 class="font-semibold text-lg">Dashboard Principal</h3>
                        <p class="text-sm text-gray-500">Visão geral do sistema</p>
                    </div>
                </div>
            </router-link>
        </div>

        <!-- Quick Stats -->
        <div class="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
            <div class="bg-blue-50 p-4 rounded-lg border border-blue-200">
                <div class="text-2xl font-bold text-blue-600">{{ stats.jobsTotal || 0 }}</div>
                <div class="text-sm text-gray-600">Total de Jobs</div>
            </div>
            <div class="bg-yellow-50 p-4 rounded-lg border border-yellow-200">
                <div class="text-2xl font-bold text-yellow-600">{{ stats.jobsPending || 0 }}</div>
                <div class="text-sm text-gray-600">Pendentes</div>
            </div>
            <div class="bg-green-50 p-4 rounded-lg border border-green-200">
                <div class="text-2xl font-bold text-green-600">{{ stats.patchesApproved || 0 }}</div>
                <div class="text-sm text-gray-600">Patches Aprovados</div>
            </div>
            <div class="bg-red-50 p-4 rounded-lg border border-red-200">
                <div class="text-2xl font-bold text-red-600">{{ stats.findingsCount || 0 }}</div>
                <div class="text-sm text-gray-600">Findings</div>
            </div>
        </div>

        <!-- Recent Jobs -->
        <div class="bg-white rounded-lg shadow p-6">
            <h2 class="text-lg font-semibold mb-4">Jobs Recentes</h2>
            <div v-if="loading" class="text-center py-8">
                <div class="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
            </div>
            <div v-else-if="error" class="text-red-600 text-center py-4">
                {{ error }}
            </div>
            <div v-else-if="jobs.length === 0" class="text-gray-500 text-center py-8">Nenhum job encontrado</div>
            <div v-else class="space-y-2">
                <router-link
                    v-for="job in jobs.slice(0, 5)"
                    :key="job.id"
                    :to="`/audit/jobs/${job.id}`"
                    class="block p-3 rounded hover:bg-gray-50 border border-gray-100"
                >
                    <div class="flex justify-between items-center">
                        <span class="font-medium">{{ job.kind || 'audit' }}</span>
                        <span :class="statusClass(job.status)" class="px-2 py-1 text-xs rounded">
                            {{ job.status }}
                        </span>
                    </div>
                    <div class="text-sm text-gray-500 mt-1">
                        {{ formatDate(job.created_at) }}
                    </div>
                </router-link>
            </div>
        </div>
    </div>
</template>

<script setup>
import { useAudit } from '@/composables/useAudit';
import { onMounted, ref } from 'vue';

const { jobs, loading, error, listJobs } = useAudit();

const stats = ref({});

onMounted(async () => {
    try {
        await listJobs();
        stats.value = {
            jobsTotal: jobs.value.length,
            jobsPending: jobs.value.filter((j) => j.status === 'pending' || j.status === 'running').length,
            patchesApproved: jobs.value.filter((j) => j.status === 'waiting_approval').length,
            findingsCount: 0,
        };
    } catch (e) {
        console.error('Failed to load jobs:', e);
    }
});

function statusClass(status) {
    const classes = {
        pending: 'bg-yellow-100 text-yellow-800',
        running: 'bg-blue-100 text-blue-800',
        completed: 'bg-green-100 text-green-800',
        failed: 'bg-red-100 text-red-800',
        waiting_approval: 'bg-purple-100 text-purple-800',
    };
    return classes[status] || 'bg-gray-100 text-gray-800';
}

function formatDate(dateStr) {
    if (!dateStr) return '-';
    return new Date(dateStr).toLocaleString('pt-BR');
}
</script>
