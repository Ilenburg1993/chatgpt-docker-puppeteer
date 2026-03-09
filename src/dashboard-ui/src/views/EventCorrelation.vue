<script setup>
import Badge from '@/components/ui/Badge.vue';
import Button from '@/components/ui/Button.vue';
import Input from '@/components/ui/Input.vue';
import { useSocket } from '@/composables/useSocket';
import { useEventsVNextStore } from '@/stores/events_vnext';
import { computed, onMounted, ref } from 'vue';

const store = useEventsVNextStore();
const { isConnected } = useSocket();

const tab = ref('ao_vivo'); // ao_vivo|historico

const liveItems = computed(() => store.items.slice(0, 300));

async function refreshHistory() {
    await store.fetchFirstPage({ limit: 200 });
}

onMounted(() => {
    if (store.items.length === 0) {
        refreshHistory().catch(() => {});
    }
});
</script>

<template>
    <div class="space-y-6">
        <div class="flex items-center justify-between">
            <div>
                <h1 class="text-2xl font-bold text-white">Eventos</h1>
                <p class="text-sm text-slate-300 mt-1">
                    Feed SSOT (SQLite) em realtime
                    <span v-if="isConnected" class="ml-2 text-xs text-emerald-300">• conectado</span>
                    <span v-else class="ml-2 text-xs text-slate-400">• desconectado</span>
                </p>
            </div>
            <div class="flex items-center gap-2">
                <Button size="sm" variant="ghost" @click="tab = 'ao_vivo'" :disabled="tab === 'ao_vivo'"
                    >Ao vivo</Button
                >
                <Button size="sm" variant="ghost" @click="tab = 'historico'" :disabled="tab === 'historico'"
                    >Histórico</Button
                >
            </div>
        </div>

        <div
            v-if="tab === 'ao_vivo'"
            class="rounded-xl border border-slate-700/50 bg-slate-950/40 backdrop-blur-sm overflow-hidden"
        >
            <div v-if="liveItems.length === 0" class="px-4 py-6 text-slate-400">Nenhum evento recebido ainda.</div>
            <div v-else class="divide-y divide-slate-800">
                <div v-for="e in liveItems" :key="e.id" class="px-4 py-3">
                    <div class="flex items-center justify-between gap-4">
                        <div class="text-xs text-slate-400 font-mono truncate">
                            #{{ e.id }} · {{ e.entity_type }} · {{ e.entity_id }}
                        </div>
                        <div class="text-xs text-slate-500">{{ new Date(e.ts_ms).toLocaleString() }}</div>
                    </div>
                    <div class="flex items-center gap-2 mt-1 flex-wrap">
                        <Badge size="sm">{{ e.event_type }}</Badge>
                        <Badge size="sm">{{ e.actor_type }}</Badge>
                        <Badge v-if="e.actor_id" size="sm">{{ e.actor_id }}</Badge>
                    </div>
                    <pre
                        class="text-xs text-slate-300 bg-slate-950/50 border border-slate-800 rounded-lg p-3 mt-2 overflow-auto max-h-56"
                        >{{ JSON.stringify(e.payload, null, 2) }}</pre
                    >
                </div>
            </div>
        </div>

        <div v-else class="space-y-4">
            <div
                class="rounded-xl border border-slate-700/50 bg-slate-950/40 backdrop-blur-sm p-4 grid grid-cols-1 md:grid-cols-4 gap-3"
            >
                <select
                    v-model="store.filters.entity_type"
                    class="w-full px-3 py-2 rounded-lg bg-slate-900/60 border border-slate-700/50 text-slate-200"
                >
                    <option :value="null">entity_type (todos)</option>
                    <option value="task">task</option>
                    <option value="mission">mission</option>
                    <option value="queue">queue</option>
                    <option value="system">system</option>
                </select>
                <Input v-model="store.filters.entity_id" placeholder="entity_id (opcional)" />
                <Input v-model="store.filters.event_type" placeholder="event_type (opcional)" />
                <div class="flex justify-end">
                    <Button size="sm" variant="primary" @click="refreshHistory" :disabled="store.loading"
                        >Aplicar</Button
                    >
                </div>
            </div>

            <div v-if="store.error" class="p-4 rounded-xl border border-red-500/30 bg-red-950/30 text-red-200">
                {{ store.error }}
            </div>

            <div v-if="store.loading" class="text-slate-300">Carregando…</div>

            <div v-else class="rounded-xl border border-slate-700/50 bg-slate-950/40 backdrop-blur-sm overflow-hidden">
                <div v-if="store.items.length === 0" class="px-4 py-6 text-slate-400">Sem eventos.</div>
                <div v-else class="divide-y divide-slate-800">
                    <div v-for="e in store.items" :key="e.id" class="px-4 py-3">
                        <div class="flex items-center justify-between gap-4">
                            <div class="text-xs text-slate-400 font-mono truncate">
                                #{{ e.id }} · {{ e.entity_type }} · {{ e.entity_id }}
                            </div>
                            <div class="text-xs text-slate-500">{{ new Date(e.ts_ms).toLocaleString() }}</div>
                        </div>
                        <div class="flex items-center gap-2 mt-1 flex-wrap">
                            <Badge size="sm">{{ e.event_type }}</Badge>
                            <Badge size="sm">{{ e.actor_type }}</Badge>
                            <Badge v-if="e.actor_id" size="sm">{{ e.actor_id }}</Badge>
                        </div>
                        <pre
                            class="text-xs text-slate-300 bg-slate-950/50 border border-slate-800 rounded-lg p-3 mt-2 overflow-auto max-h-56"
                            >{{ JSON.stringify(e.payload, null, 2) }}</pre
                        >
                    </div>
                </div>
            </div>

            <div class="flex justify-center" v-if="store.hasMore">
                <Button
                    variant="secondary"
                    size="sm"
                    @click="store.fetchNextPage({ limit: 200 })"
                    :disabled="store.loading"
                    >Carregar mais</Button
                >
            </div>
        </div>
    </div>
</template>
