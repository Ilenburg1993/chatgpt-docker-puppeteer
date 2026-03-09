<script setup>
import Button from '@/components/ui/Button.vue';
import Card from '@/components/ui/Card.vue';
import { formatHttpError, http } from '@/lib/http';
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';

const route = useRoute();
const router = useRouter();

const artifactId = computed(() => String(route.params.id || ''));

const loading = ref(false);
const error = ref(null);
const meta = ref(null);
const text = ref(null);

async function fetchMeta() {
    if (!artifactId.value) return;
    loading.value = true;
    error.value = null;
    try {
        const res = await http.get(`/api/artifacts/${artifactId.value}`);
        meta.value = res.data?.data?.artifact || res.data?.artifact || null;
    } catch (err) {
        error.value = formatHttpError(err).message;
    } finally {
        loading.value = false;
    }
}

async function fetchText() {
    if (!artifactId.value) return;
    try {
        const res = await http.get(`/api/artifacts/${artifactId.value}/text`, { params: { max_chars: 50000 } });
        text.value = res.data?.data?.text || res.data?.text || null;
    } catch (_) {
        text.value = null;
    }
}

const downloadUrl = computed(() => `/api/artifacts/${artifactId.value}/content?disposition=attachment`);
const inlineUrl = computed(() => `/api/artifacts/${artifactId.value}/content?disposition=inline`);

onMounted(async () => {
    await fetchMeta();
    await fetchText();
});

watch(artifactId, async () => {
    await fetchMeta();
    await fetchText();
});
</script>

<template>
    <div class="space-y-6">
        <div class="flex items-center justify-between">
            <div>
                <h1 class="text-2xl font-bold text-white">Artefato</h1>
                <p class="text-sm text-slate-300 mt-1 font-mono">{{ artifactId }}</p>
            </div>
            <div class="flex items-center gap-2">
                <Button variant="ghost" size="sm" @click="router.back()">Voltar</Button>
                <a :href="downloadUrl" class="inline-flex">
                    <Button variant="secondary" size="sm">Baixar</Button>
                </a>
                <a :href="inlineUrl" target="_blank" rel="noreferrer" class="inline-flex">
                    <Button variant="ghost" size="sm">Abrir</Button>
                </a>
            </div>
        </div>

        <div v-if="error" class="p-4 rounded-xl border border-red-500/30 bg-red-950/30 text-red-200">
            {{ error }}
        </div>

        <div v-if="loading" class="text-slate-300">Carregando…</div>

        <div v-else class="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card>
                <template #header>
                    <div class="text-sm font-semibold text-slate-200">Metadados</div>
                </template>
                <div class="text-sm text-slate-300 space-y-2 font-mono">
                    <div><span class="text-slate-500">kind:</span> {{ meta?.kind || '-' }}</div>
                    <div><span class="text-slate-500">mime:</span> {{ meta?.mime || '-' }}</div>
                    <div><span class="text-slate-500">size:</span> {{ meta?.size_bytes ?? '-' }}</div>
                    <div><span class="text-slate-500">sha256:</span> {{ meta?.sha256 || '-' }}</div>
                    <div><span class="text-slate-500">storage_uri:</span> {{ meta?.storage_uri || '-' }}</div>
                    <div><span class="text-slate-500">created_at_ms:</span> {{ meta?.created_at_ms ?? '-' }}</div>
                </div>
            </Card>

            <Card>
                <template #header>
                    <div class="text-sm font-semibold text-slate-200">Prévia (texto)</div>
                </template>
                <div
                    v-if="text"
                    class="text-xs text-slate-200 whitespace-pre-wrap font-mono bg-slate-950/50 border border-slate-800 rounded-lg p-3 max-h-[520px] overflow-auto"
                >
                    {{ text }}
                </div>
                <div v-else class="text-sm text-slate-400">Sem prévia disponível.</div>
            </Card>
        </div>
    </div>
</template>
