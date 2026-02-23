<template>
  <div class="p-6">
    <div class="flex justify-between items-center mb-6">
      <h1 class="text-2xl font-bold">Jobs de Auditoria</h1>
      <button
        @click="handleCreateJob"
        class="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition"
      >
        + Novo Job
      </button>
    </div>

    <!-- Filters -->
    <div class="mb-4 flex gap-4">
      <select v-model="statusFilter" class="px-3 py-2 border rounded">
        <option value="">Todos os status</option>
        <option value="pending">Pendente</option>
        <option value="running">Em execução</option>
        <option value="completed">Concluído</option>
        <option value="failed">Falhou</option>
        <option value="waiting_approval">Aguardando Aprovação</option>
      </select>
    </div>

    <!-- Jobs List -->
    <div v-if="loading" class="text-center py-8">
      <div class="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
    </div>
    <div v-else-if="error" class="text-red-600 text-center py-4">
      {{ error }}
    </div>
    <div v-else-if="filteredJobs.length === 0" class="text-gray-500 text-center py-8">
      Nenhum job encontrado
    </div>
    <div v-else class="bg-white rounded-lg shadow overflow-hidden">
      <table class="min-w-full divide-y divide-gray-200">
        <thead class="bg-gray-50">
          <tr>
            <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">ID</th>
            <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Tipo</th>
            <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
            <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Criado em</th>
            <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Ações</th>
          </tr>
        </thead>
        <tbody class="bg-white divide-y divide-gray-200">
          <tr v-for="job in filteredJobs" :key="job.id" class="hover:bg-gray-50">
            <td class="px-6 py-4 whitespace-nowrap text-sm">
              <router-link :to="`/audit/jobs/${job.id}`" class="text-blue-600 hover:text-blue-800">
                {{ job.id.slice(0, 8) }}...
              </router-link>
            </td>
            <td class="px-6 py-4 whitespace-nowrap text-sm">{{ job.kind || 'audit' }}</td>
            <td class="px-6 py-4 whitespace-nowrap">
              <span :class="statusClass(job.status)" class="px-2 py-1 text-xs rounded">
                {{ job.status }}
              </span>
            </td>
            <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
              {{ formatDate(job.created_at) }}
            </td>
            <td class="px-6 py-4 whitespace-nowrap text-sm">
              <button
                v-if="job.status === 'pending'"
                @click="handleRunJob(job.id)"
                class="text-green-600 hover:text-green-800 mr-3"
              >
                Executar
              </button>
              <button
                v-if="job.status === 'running'"
                @click="handleCancelJob(job.id)"
                class="text-red-600 hover:text-red-800"
              >
                Cancelar
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import { useAudit } from '@/composables/useAudit';

const { jobs, loading, error, listJobs, createJob, runJob, cancelJob } = useAudit();

const statusFilter = ref('');

const filteredJobs = computed(() => {
  if (!statusFilter.value) return jobs.value;
  return jobs.value.filter(j => j.status === statusFilter.value);
});

onMounted(async () => {
  await listJobs();
});

async function handleCreateJob() {
  try {
    await createJob({ kind: 'patch_suggest', config: {} });
    await listJobs();
  } catch (e) {
    console.error('Failed to create job:', e);
  }
}

async function handleRunJob(jobId) {
  try {
    await runJob(jobId);
    await listJobs();
  } catch (e) {
    console.error('Failed to run job:', e);
  }
}

async function handleCancelJob(jobId) {
  try {
    await cancelJob(jobId);
    await listJobs();
  } catch (e) {
    console.error('Failed to cancel job:', e);
  }
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

function formatDate(dateStr) {
  if (!dateStr) return '-';
  return new Date(dateStr).toLocaleString('pt-BR');
}
</script>
