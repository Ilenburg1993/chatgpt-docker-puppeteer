<template>
  <div class="p-6">
    <div class="flex items-center gap-4 mb-6">
      <router-link to="/audit/jobs" class="text-blue-600 hover:text-blue-800">
        ← Voltar aos Jobs
      </router-link>
    </div>

    <div v-if="loading" class="text-center py-8">
      <div class="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
    </div>
    <div v-else-if="error" class="text-red-600 text-center py-4">
      {{ error }}
    </div>
    <div v-else-if="patch">
      <!-- Header -->
      <div class="bg-white rounded-lg shadow p-6 mb-6">
        <div class="flex justify-between items-start">
          <div>
            <h1 class="text-2xl font-bold">Patch: {{ patch.id.slice(0, 8) }}...</h1>
            <p class="text-gray-500 mt-1">Job: {{ patch.job_id?.slice(0, 8) }}...</p>
          </div>
          <span :class="patchStatusClass(patch.status)" class="px-3 py-1 text-sm rounded">
            {{ patch.status }}
          </span>
        </div>
        <div class="mt-4 text-sm text-gray-500">
          Criado em: {{ formatDate(patch.created_at) }}
        </div>
      </div>

      <!-- Apply Readiness -->
      <div v-if="applyReadiness" class="bg-white rounded-lg shadow p-6 mb-6">
        <h2 class="text-lg font-semibold mb-4">Apply Readiness</h2>
        <div class="grid grid-cols-2 gap-4">
          <div>
            <span class="text-gray-500">Pode aplicar:</span>
            <span :class="applyReadiness.will_execute_real_apply ? 'text-green-600' : 'text-red-600'" class="ml-2">
              {{ applyReadiness.will_execute_real_apply ? 'Sim' : 'Não' }}
            </span>
          </div>
          <div>
            <span class="text-gray-500">Modo:</span>
            <span class="ml-2">{{ applyReadiness.mode }}</span>
          </div>
          <div class="col-span-2">
            <span class="text-gray-500">Bloqueios:</span>
            <ul v-if="applyReadiness.blocking_reasons?.length" class="mt-1 text-red-600">
              <li v-for="reason in applyReadiness.blocking_reasons" :key="reason">
                {{ reason }}
              </li>
            </ul>
            <span v-else class="ml-2 text-green-600">Nenhum</span>
          </div>
        </div>
      </div>

      <!-- Dry Run State -->
      <div v-if="patch.dry_run_state" class="bg-white rounded-lg shadow p-6 mb-6">
        <h2 class="text-lg font-semibold mb-4">Estado do Dry-Run</h2>
        <div class="grid grid-cols-2 gap-4">
          <div>
            <span class="text-gray-500">Estado:</span>
            <span class="ml-2">{{ patch.dry_run_state }}</span>
          </div>
          <div v-if="patch.dry_run_result_json?.ok">
            <span class="text-gray-500">Resultado:</span>
            <span :class="patch.dry_run_result_json.ok ? 'text-green-600' : 'text-red-600'" class="ml-2">
              {{ patch.dry_run_result_json.ok ? 'Sucesso' : 'Falhou' }}
            </span>
          </div>
        </div>
      </div>

      <!-- LLM Patch Summary -->
      <div v-if="patch.llm_patch_summary" class="bg-white rounded-lg shadow p-6 mb-6">
        <h2 class="text-lg font-semibold mb-4">Resumo do Patch LLM</h2>
        <div class="space-y-3">
          <div v-if="patch.llm_patch_summary.summary">
            <span class="text-gray-500">Summary:</span>
            <p class="mt-1">{{ patch.llm_patch_summary.summary }}</p>
          </div>
          <div v-if="patch.llm_patch_summary.risk_score !== undefined">
            <span class="text-gray-500">Risk Score:</span>
            <span class="ml-2">{{ patch.llm_patch_summary.risk_score }}</span>
          </div>
          <div v-if="patch.llm_patch_summary.candidate_files?.length">
            <span class="text-gray-500">Arquivos:</span>
            <ul class="mt-1 list-disc list-inside">
              <li v-for="file in patch.llm_patch_summary.candidate_files" :key="file">{{ file }}</li>
            </ul>
          </div>
        </div>
      </div>

      <!-- Actions -->
      <div class="flex gap-4 mb-6">
        <button
          v-if="patch.status === 'pending'"
          @click="handleApprove"
          class="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700"
        >
          Aprovar
        </button>
        <button
          v-if="patch.status === 'pending'"
          @click="handleReject"
          class="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700"
        >
          Rejeitar
        </button>
        <button
          v-if="patch.status === 'approved'"
          @click="handleApply"
          class="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
        >
          Aplicar Patch
        </button>
        <button
          @click="handleCheckReadiness"
          class="px-4 py-2 bg-gray-600 text-white rounded hover:bg-gray-700"
        >
          Verificar Readiness
        </button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { useRoute } from 'vue-router';
import { useAudit } from '@/composables/useAudit';

const route = useRoute();
const { patch, applyReadiness, loading, error, getPatch, approvePatch, rejectPatch, applyPatch, getPatchApplyReadiness } = useAudit();

const patchId = route.params.id;

onMounted(async () => {
  await getPatch(patchId);
  await handleCheckReadiness();
});

async function handleCheckReadiness() {
  await getPatchApplyReadiness(patchId);
}

async function handleApprove() {
  await approvePatch(patchId);
  await getPatch(patchId);
}

async function handleReject() {
  await rejectPatch(patchId);
  await getPatch(patchId);
}

async function handleApply() {
  await applyPatch(patchId);
  await getPatch(patchId);
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

function formatDate(dateStr) {
  if (!dateStr) return '-';
  return new Date(dateStr).toLocaleString('pt-BR');
}
</script>
