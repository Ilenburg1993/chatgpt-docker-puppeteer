<template>
    <div class="p-6">
        <div class="flex items-center gap-4 mb-6">
            <router-link to="/audit" class="text-blue-600 hover:text-blue-800"> ← Voltar ao Painel </router-link>
        </div>

        <h1 class="text-2xl font-bold mb-6">⚡ Inference Gateway</h1>

        <!-- Tabs -->
        <div class="mb-6">
            <button
                v-for="tab in ['summary', 'profiles', 'backends', 'models']"
                :key="tab"
                @click="activeTab = tab"
                class="px-4 py-2 mr-2 rounded"
                :class="activeTab === tab ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-700'"
            >
                {{ tabLabels[tab] }}
            </button>
        </div>

        <!-- Loading -->
        <div v-if="loading" class="text-center py-8">
            <div class="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
        </div>
        <div v-else-if="error" class="text-red-600 text-center py-4">
            {{ error }}
        </div>

        <!-- Summary Tab -->
        <div v-else-if="activeTab === 'summary'">
            <div class="bg-white rounded-lg shadow p-6">
                <h2 class="text-lg font-semibold mb-4">Resumo</h2>
                <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div class="bg-blue-50 p-4 rounded-lg">
                        <div class="text-2xl font-bold text-blue-600">{{ summary?.backendsTotal || 0 }}</div>
                        <div class="text-sm text-gray-600">Backends</div>
                    </div>
                    <div class="bg-green-50 p-4 rounded-lg">
                        <div class="text-2xl font-bold text-green-600">{{ summary?.modelsTotal || 0 }}</div>
                        <div class="text-sm text-gray-600">Modelos</div>
                    </div>
                    <div class="bg-purple-50 p-4 rounded-lg">
                        <div class="text-2xl font-bold text-purple-600">{{ summary?.profilesTotal || 0 }}</div>
                        <div class="text-sm text-gray-600">Perfis</div>
                    </div>
                    <div class="bg-yellow-50 p-4 rounded-lg">
                        <div class="text-2xl font-bold text-yellow-600">{{ summary?.policiesTotal || 0 }}</div>
                        <div class="text-sm text-gray-600">Políticas</div>
                    </div>
                </div>

                <!-- Capabilities -->
                <div v-if="summary?.capabilities" class="mt-6">
                    <h3 class="font-semibold mb-3">Capacidades</h3>
                    <div class="flex flex-wrap gap-2">
                        <span
                            v-for="cap in summary.capabilities"
                            :key="cap"
                            class="px-3 py-1 bg-gray-100 rounded-full text-sm"
                        >
                            {{ cap }}
                        </span>
                    </div>
                </div>
            </div>
        </div>

        <!-- Profiles Tab -->
        <div v-else-if="activeTab === 'profiles'">
            <div class="bg-white rounded-lg shadow overflow-hidden">
                <table class="min-w-full divide-y divide-gray-200">
                    <thead class="bg-gray-50">
                        <tr>
                            <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Nome</th>
                            <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Modelo</th>
                            <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Backend</th>
                            <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Timeout</th>
                        </tr>
                    </thead>
                    <tbody class="bg-white divide-y divide-gray-200">
                        <tr v-for="profile in profiles" :key="profile.id" class="hover:bg-gray-50">
                            <td class="px-6 py-4 whitespace-nowrap">{{ profile.name }}</td>
                            <td class="px-6 py-4 whitespace-nowrap">{{ profile.model }}</td>
                            <td class="px-6 py-4 whitespace-nowrap">{{ profile.backend }}</td>
                            <td class="px-6 py-4 whitespace-nowrap">{{ profile.timeout_ms }}ms</td>
                        </tr>
                    </tbody>
                </table>
                <div v-if="profiles.length === 0" class="text-center py-8 text-gray-500">Nenhum perfil encontrado</div>
            </div>
        </div>

        <!-- Backends Tab -->
        <div v-else-if="activeTab === 'backends'">
            <div class="bg-white rounded-lg shadow overflow-hidden">
                <table class="min-w-full divide-y divide-gray-200">
                    <thead class="bg-gray-50">
                        <tr>
                            <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Nome</th>
                            <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">URL</th>
                            <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                            <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Ações</th>
                        </tr>
                    </thead>
                    <tbody class="bg-white divide-y divide-gray-200">
                        <tr v-for="backend in backends" :key="backend.id" class="hover:bg-gray-50">
                            <td class="px-6 py-4 whitespace-nowrap">{{ backend.name }}</td>
                            <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{{ backend.url }}</td>
                            <td class="px-6 py-4 whitespace-nowrap">
                                <span
                                    :class="backend.enabled ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'"
                                    class="px-2 py-1 text-xs rounded"
                                >
                                    {{ backend.enabled ? 'Ativo' : 'Inativo' }}
                                </span>
                            </td>
                            <td class="px-6 py-4 whitespace-nowrap">
                                <button
                                    @click="handleToggleBackend(backend.id, !backend.enabled)"
                                    class="text-blue-600 hover:text-blue-800"
                                >
                                    {{ backend.enabled ? 'Desativar' : 'Ativar' }}
                                </button>
                            </td>
                        </tr>
                    </tbody>
                </table>
                <div v-if="backends.length === 0" class="text-center py-8 text-gray-500">Nenhum backend encontrado</div>
            </div>
        </div>

        <!-- Models Tab -->
        <div v-else-if="activeTab === 'models'">
            <div class="bg-white rounded-lg shadow overflow-hidden">
                <table class="min-w-full divide-y divide-gray-200">
                    <thead class="bg-gray-50">
                        <tr>
                            <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Nome</th>
                            <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Backend</th>
                            <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                            <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Capacidades</th>
                            <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Ações</th>
                        </tr>
                    </thead>
                    <tbody class="bg-white divide-y divide-gray-200">
                        <tr v-for="model in models" :key="model.id" class="hover:bg-gray-50">
                            <td class="px-6 py-4 whitespace-nowrap">{{ model.name }}</td>
                            <td class="px-6 py-4 whitespace-nowrap">{{ model.backend }}</td>
                            <td class="px-6 py-4 whitespace-nowrap">
                                <span
                                    :class="model.enabled ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'"
                                    class="px-2 py-1 text-xs rounded"
                                >
                                    {{ model.enabled ? 'Ativo' : 'Inativo' }}
                                </span>
                            </td>
                            <td class="px-6 py-4">
                                <div class="flex flex-wrap gap-1">
                                    <span
                                        v-for="cap in model.capabilities"
                                        :key="cap"
                                        class="px-2 py-0.5 bg-gray-100 rounded text-xs"
                                    >
                                        {{ cap }}
                                    </span>
                                </div>
                            </td>
                            <td class="px-6 py-4 whitespace-nowrap">
                                <button
                                    @click="handleToggleModel(model.id, !model.enabled)"
                                    class="text-blue-600 hover:text-blue-800"
                                >
                                    {{ model.enabled ? 'Desativar' : 'Ativar' }}
                                </button>
                            </td>
                        </tr>
                    </tbody>
                </table>
                <div v-if="models.length === 0" class="text-center py-8 text-gray-500">Nenhum modelo encontrado</div>
            </div>
        </div>
    </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { useAudit } from '@/composables/useAudit';

const {
    summary,
    profiles,
    backends,
    models,
    loading,
    error,
    getInferenceSummary,
    listInferenceProfiles,
    listInferenceBackends,
    listInferenceModels,
    toggleInferenceBackend,
    toggleInferenceModel,
} = useAudit();

const activeTab = ref('summary');

const tabLabels = {
    summary: 'Resumo',
    profiles: 'Perfis',
    backends: 'Backends',
    models: 'Modelos',
};

onMounted(async () => {
    await loadTabData();
});

async function loadTabData() {
    loading.value = true;
    try {
        switch (activeTab.value) {
            case 'summary':
                await getInferenceSummary();
                break;
            case 'profiles':
                await listInferenceProfiles();
                break;
            case 'backends':
                await listInferenceBackends();
                break;
            case 'models':
                await listInferenceModels();
                break;
        }
    } catch (e) {
        console.error('Failed to load data:', e);
    } finally {
        loading.value = false;
    }
}

async function handleToggleBackend(id, enabled) {
    try {
        await toggleInferenceBackend(id, enabled);
        await listInferenceBackends();
    } catch (e) {
        console.error('Failed to toggle backend:', e);
    }
}

async function handleToggleModel(id, enabled) {
    try {
        await toggleInferenceModel(id, enabled);
        await listInferenceModels();
    } catch (e) {
        console.error('Failed to toggle model:', e);
    }
}
</script>
