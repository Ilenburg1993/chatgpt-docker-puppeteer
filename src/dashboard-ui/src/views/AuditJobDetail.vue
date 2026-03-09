<template>
    <div class="p-6">
        <div class="flex items-center gap-4 mb-6">
            <router-link to="/audit/jobs" class="text-blue-600 hover:text-blue-800"> ← Voltar </router-link>
        </div>

        <div v-if="loading" class="text-center py-8">
            <div class="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
        </div>
        <div v-else-if="error" class="text-red-600 text-center py-4">
            {{ error }}
        </div>
        <div v-else-if="job">
            <!-- Header -->
            <div class="bg-white rounded-lg shadow p-6 mb-6">
                <div class="flex justify-between items-start">
                    <div>
                        <h1 class="text-2xl font-bold">Job: {{ job.id.slice(0, 8) }}...</h1>
                        <p class="text-gray-500 mt-1">Tipo: {{ job.kind || 'audit' }}</p>
                    </div>
                    <span :class="statusClass(job.status)" class="px-3 py-1 text-sm rounded">
                        {{ job.status }}
                    </span>
                </div>
                <div class="mt-4 text-sm text-gray-500">
                    Criado em: {{ formatDate(job.created_at) }}
                    <span v-if="job.updated_at"> | Atualizado em: {{ formatDate(job.updated_at) }}</span>
                </div>
            </div>

            <!-- Actions -->
            <div class="flex gap-4 mb-6">
                <button
                    v-if="job.status === 'pending'"
                    @click="handleRunJob"
                    class="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700"
                >
                    Executar
                </button>
                <button
                    v-if="job.status === 'running'"
                    @click="handleCancelJob"
                    class="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700"
                >
                    Cancelar
                </button>
                <button
                    v-if="job.status === 'waiting_approval'"
                    @click="handleCreatePatchJob"
                    class="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
                >
                    Criar Novo Patch
                </button>
            </div>

            <!-- LLM Triage Summary -->
            <div v-if="job.llm_triage_summary" class="bg-white rounded-lg shadow p-6 mb-6">
                <h2 class="text-lg font-semibold mb-4">Resumo de Triagem LLM</h2>
                <div class="grid grid-cols-2 gap-4">
                    <div>
                        <span class="text-gray-500">Status:</span>
                        <span :class="job.llm_triage_summary.ok ? 'text-green-600' : 'text-red-600'" class="ml-2">
                            {{ job.llm_triage_summary.ok ? 'OK' : 'Falhou' }}
                        </span>
                    </div>
                    <div v-if="job.llm_triage_summary.risk_level">
                        <span class="text-gray-500">Nível de Risco:</span>
                        <span class="ml-2">{{ job.llm_triage_summary.risk_level }}</span>
                    </div>
                    <div v-if="job.llm_triage_summary.model" class="col-span-2">
                        <span class="text-gray-500">Modelo:</span>
                        <span class="ml-2">{{ job.llm_triage_summary.model }}</span>
                    </div>
                    <div v-if="job.llm_triage_summary.summary" class="col-span-2">
                        <span class="text-gray-500">Summary:</span>
                        <p class="mt-1 text-gray-700">{{ job.llm_triage_summary.summary }}</p>
                    </div>
                </div>
            </div>

            <!-- Findings -->
            <div class="bg-white rounded-lg shadow p-6 mb-6">
                <h2 class="text-lg font-semibold mb-4">Findings ({{ findings.length }})</h2>
                <div v-if="findings.length === 0" class="text-gray-500 text-center py-4">Nenhum finding encontrado</div>
                <div v-else class="space-y-3">
                    <div
                        v-for="finding in findings"
                        :key="finding.id"
                        class="p-3 border rounded"
                        :class="severityClass(finding.severity)"
                    >
                        <div class="flex justify-between items-start">
                            <div>
                                <span class="font-medium">{{ finding.rule_id || finding.type }}</span>
                                <p class="text-sm text-gray-600 mt-1">{{ finding.message }}</p>
                                <p v-if="finding.file_path" class="text-xs text-gray-500 mt-1">
                                    {{ finding.file_path }}:{{ finding.line }}
                                </p>
                            </div>
                            <span class="px-2 py-1 text-xs rounded" :class="severityClass(finding.severity)">
                                {{ finding.severity || 'info' }}
                            </span>
                        </div>
                    </div>
                </div>
            </div>

            <!-- Patches -->
            <div class="bg-white rounded-lg shadow p-6">
                <h2 class="text-lg font-semibold mb-4">Patches ({{ patches.length }})</h2>
                <div v-if="patches.length === 0" class="text-gray-500 text-center py-4">Nenhum patch encontrado</div>
                <div v-else class="space-y-3">
                    <router-link
                        v-for="patch in patches"
                        :key="patch.id"
                        :to="`/audit/patches/${patch.id}`"
                        class="block p-4 border rounded hover:bg-gray-50"
                    >
                        <div class="flex justify-between items-center">
                            <span class="font-medium">Patch {{ patch.id.slice(0, 8) }}...</span>
                            <span :class="patchStatusClass(patch.status)" class="px-2 py-1 text-xs rounded">
                                {{ patch.status }}
                            </span>
                        </div>
                        <p v-if="patch.dry_run_state" class="text-sm text-gray-500 mt-1">
                            Dry-run: {{ patch.dry_run_state }}
                        </p>
                    </router-link>
                </div>
            </div>
        </div>
    </div>
</template>

<script setup>
import { useAudit } from '@/composables/useAudit';
import { onMounted } from 'vue';
import { useRoute } from 'vue-router';

const route = useRoute();
const { job, findings, patches, loading, error, getJob, runJob, cancelJob, listFindings } = useAudit();

const jobId = route.params.id;

onMounted(async () => {
    await getJob(jobId);
});

async function handleRunJob() {
    await runJob(jobId);
    await getJob(jobId);
}

async function handleCancelJob() {
    await cancelJob(jobId);
    await getJob(jobId);
}

async function handleCreatePatchJob() {
    // Navigate to create new patch
}

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

function patchStatusClass(status) {
    const classes = {
        draft: 'bg-gray-100 text-gray-800',
        pending: 'bg-yellow-100 text-yellow-800',
        approved: 'bg-green-100 text-green-800',
        rejected: 'bg-red-100 text-red-800',
        applied: 'bg-blue-100 text-blue-800',
    };
    return classes[status] || 'bg-gray-100 text-gray-800';
}

function severityClass(severity) {
    const classes = {
        critical: 'border-red-300 bg-red-50',
        error: 'border-red-200 bg-red-50',
        warning: 'border-yellow-300 bg-yellow-50',
        info: 'border-blue-200 bg-blue-50',
    };
    return classes[severity] || 'border-gray-200';
}

function formatDate(dateStr) {
    if (!dateStr) return '-';
    return new Date(dateStr).toLocaleString('pt-BR');
}
</script>
