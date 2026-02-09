<script setup>
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import Button from '@/components/ui/Button.vue';
import Badge from '@/components/ui/Badge.vue';
import Card from '@/components/ui/Card.vue';
import Input from '@/components/ui/Input.vue';
import VisGraph from '@/components/graphs/VisGraph.vue';
import { http } from '@/lib/http';
import { formatHttpError } from '@/lib/http';

const route = useRoute();
const router = useRouter();

const taskId = computed(() => String(route.params.id || ''));

const loading = ref(false);
const error = ref(null);
const tab = ref('resumo'); // resumo|attempts|artifacts|eventos|deps|json

const detail = ref(null);
const task = computed(() => detail.value?.task || null);
const attempts = computed(() => detail.value?.attempts || []);
const events = computed(() => detail.value?.events || []);
const dependencies = computed(() => detail.value?.dependencies || []);
const workflow = computed(() => detail.value?.workflow || []);
const artifacts = computed(() => detail.value?.artifacts || []);

const edit = ref({
    stage: 'READY',
    status: 'PENDING',
    target: 'auto',
    model: '',
    priority: 5,
    mission_id: '',
    system_message: '',
    user_message: '',
    execute_after_ms: null,
});

const depsText = ref('');
const jsonText = ref('');

function statusVariant(status) {
    const s = String(status || '').toUpperCase();
    if (s === 'RUNNING') return 'info';
    if (s === 'DONE') return 'success';
    if (s === 'FAILED') return 'error';
    if (s === 'PAUSED' || s === 'CANCELLED') return 'warning';
    if (s === 'BLOCKED') return 'warning';
    return 'default';
}

async function fetchDetail() {
    if (!taskId.value) return;
    loading.value = true;
    error.value = null;
    try {
        const res = await http.get(`/api/dashboard/tasks/${taskId.value}`, {
            params: { include: 'attempts,events,dependencies,workflow,artifacts' },
        });
        detail.value = res.data?.data || null;

        const t = detail.value?.task || {};
        edit.value = {
            stage: t.stage || 'READY',
            status: t.unified_status || t.state?.status || 'PENDING',
            target: t.spec?.target || 'auto',
            model: t.spec?.model || '',
            priority: t.meta?.priority ?? 5,
            mission_id: t.meta?.mission_id || t.mission?.mission_id || '',
            system_message: t.spec?.payload?.system_message || '',
            user_message: t.spec?.payload?.user_message || '',
            execute_after_ms: null,
        };

        depsText.value = JSON.stringify((t.policy?.dependencies || []).map(String), null, 2);
        jsonText.value = JSON.stringify(t, null, 2);
    } catch (err) {
        error.value = formatHttpError(err).message;
    } finally {
        loading.value = false;
    }
}

async function saveBasics() {
    const payload = {
        stage: edit.value.stage,
        unified_status: edit.value.status,
        meta: {
            priority: Number(edit.value.priority) || 0,
            mission_id: edit.value.mission_id || undefined,
        },
        spec: {
            target: edit.value.target,
            model: edit.value.model || undefined,
            payload: {
                system_message: edit.value.system_message || '',
                user_message: edit.value.user_message || '',
            },
        },
    };
    await http.patch(`/api/tasks/${taskId.value}`, payload);
    await fetchDetail();
}

async function saveDependencies() {
    let deps = [];
    try {
        deps = JSON.parse(depsText.value || '[]');
    } catch (_) {
        alert('JSON de dependências inválido (use ["task-..."]).');
        return;
    }
    await http.put(`/api/tasks/${taskId.value}/dependencies`, { dependencies: deps });
    await fetchDetail();
}

async function saveJsonAdvanced() {
    let obj = null;
    try {
        obj = JSON.parse(jsonText.value);
    } catch (_) {
        alert('JSON inválido');
        return;
    }
    await http.patch(`/api/tasks/${taskId.value}`, obj);
    await fetchDetail();
}

async function action(actionName) {
    await http.post(`/api/tasks/${taskId.value}/${actionName}`);
    await fetchDetail();
}

const depsGraphNodes = computed(() => {
    const t = task.value;
    if (!t?.meta?.id) return [];
    const nodes = [];
    nodes.push({ id: t.meta.id, label: `${t.meta.id}\nSELF`, color: { background: '#1e3a8a', border: '#60a5fa' } });
    for (const d of dependencies.value) {
        nodes.push({ id: d.id, label: `${d.id}\nDEP`, color: { background: '#0f172a', border: '#334155' } });
    }
    return nodes;
});

const depsGraphEdges = computed(() => {
    const t = task.value;
    if (!t?.meta?.id) return [];
    return dependencies.value.map(d => ({ from: d.id, to: t.meta.id }));
});

onMounted(fetchDetail);
watch(taskId, () => void fetchDetail());
</script>

<template>
    <div class="space-y-6">
        <div class="flex items-center justify-between">
            <div>
                <h1 class="text-2xl font-bold text-white">Tarefa</h1>
                <p class="text-sm text-slate-300 mt-1 font-mono">{{ taskId }}</p>
            </div>
            <div class="flex items-center gap-2">
                <Button variant="ghost" size="sm" @click="router.back()">Voltar</Button>
                <Button variant="secondary" size="sm" @click="fetchDetail" :disabled="loading">Atualizar</Button>
            </div>
        </div>

        <div v-if="error" class="p-4 rounded-xl border border-red-500/30 bg-red-950/30 text-red-200">
            {{ error }}
        </div>

        <div v-if="loading" class="text-slate-300">Carregando…</div>

        <div v-else-if="task" class="space-y-6">
            <Card>
                <template #header>
                    <div class="flex items-center justify-between gap-4">
                        <div class="min-w-0">
                            <div class="text-sm text-slate-400">Stage/Status/Target</div>
                            <div class="flex items-center gap-2 flex-wrap mt-1">
                                <Badge size="sm">{{ task.stage }}</Badge>
                                <Badge size="sm" :variant="statusVariant(task.unified_status)">{{ task.unified_status }}</Badge>
                                <Badge size="sm">{{ task.spec?.target }}</Badge>
                                <Badge size="sm">pri: {{ task.meta?.priority ?? 0 }}</Badge>
                                <Badge size="sm" v-if="task.meta?.mission_id">mission: {{ task.meta.mission_id }}</Badge>
                            </div>
                        </div>
                        <div class="flex items-center gap-2 flex-wrap justify-end">
                            <Button v-if="task.unified_status === 'PENDING'" variant="secondary" size="sm" @click="action('pause')">Pausar</Button>
                            <Button v-if="task.unified_status === 'PAUSED'" variant="secondary" size="sm" @click="action('resume')">Retomar</Button>
                            <Button v-if="task.unified_status === 'BLOCKED'" variant="secondary" size="sm" @click="action('unblock')">Desbloquear</Button>
                            <Button v-if="['DONE','FAILED','CANCELLED','PAUSED','BLOCKED'].includes(task.unified_status)" variant="ghost" size="sm" @click="action('retry')">Reexecutar</Button>
                            <Button v-if="['PENDING','PAUSED'].includes(task.unified_status)" variant="danger" size="sm" @click="action('cancel')">Cancelar</Button>
                        </div>
                    </div>
                </template>

                <div class="text-sm text-slate-300 whitespace-pre-wrap bg-slate-950/40 border border-slate-800 rounded-lg p-3 font-mono">
                    {{ task.spec?.payload?.user_message || '' }}
                </div>
            </Card>

            <div class="flex items-center gap-2 flex-wrap">
                <Button size="sm" variant="ghost" @click="tab = 'resumo'" :disabled="tab === 'resumo'">Resumo</Button>
                <Button size="sm" variant="ghost" @click="tab = 'attempts'" :disabled="tab === 'attempts'">Tentativas</Button>
                <Button size="sm" variant="ghost" @click="tab = 'artifacts'" :disabled="tab === 'artifacts'">Artefatos</Button>
                <Button size="sm" variant="ghost" @click="tab = 'eventos'" :disabled="tab === 'eventos'">Eventos</Button>
                <Button size="sm" variant="ghost" @click="tab = 'deps'" :disabled="tab === 'deps'">Dependências</Button>
                <Button size="sm" variant="ghost" @click="tab = 'json'" :disabled="tab === 'json'">JSON avançado</Button>
            </div>

            <div v-if="tab === 'resumo'" class="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <Card>
                    <template #header><div class="text-sm font-semibold text-slate-200">Editar</div></template>
                    <div class="space-y-4">
                        <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
                            <div>
                                <label class="text-sm text-slate-300">Stage</label>
                                <select v-model="edit.stage" class="w-full px-3 py-2 rounded-lg bg-slate-900/60 border border-slate-700/50 text-slate-200">
                                    <option value="DRAFT">DRAFT</option>
                                    <option value="PROPOSED">PROPOSED</option>
                                    <option value="READY">READY</option>
                                    <option value="REJECTED">REJECTED</option>
                                    <option value="ARCHIVED">ARCHIVED</option>
                                </select>
                            </div>
                            <div>
                                <label class="text-sm text-slate-300">Status</label>
                                <select v-model="edit.status" class="w-full px-3 py-2 rounded-lg bg-slate-900/60 border border-slate-700/50 text-slate-200">
                                    <option value="PENDING">PENDING</option>
                                    <option value="PAUSED">PAUSED</option>
                                    <option value="CANCELLED">CANCELLED</option>
                                </select>
                            </div>
                        </div>
                        <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
                            <div>
                                <label class="text-sm text-slate-300">Target</label>
                                <select v-model="edit.target" class="w-full px-3 py-2 rounded-lg bg-slate-900/60 border border-slate-700/50 text-slate-200">
                                    <option value="auto">auto</option>
                                    <option value="chatgpt">chatgpt</option>
                                    <option value="gemini">gemini</option>
                                    <option value="claude">claude</option>
                                    <option value="ollama">ollama</option>
                                </select>
                            </div>
                            <div>
                                <label class="text-sm text-slate-300">Model</label>
                                <Input v-model="edit.model" placeholder="ex: gpt-4o" />
                            </div>
                            <div>
                                <label class="text-sm text-slate-300">Prioridade</label>
                                <input v-model.number="edit.priority" type="number" min="0" max="10" class="w-full px-3 py-2 rounded-lg bg-slate-900/60 border border-slate-700/50 text-slate-200" />
                            </div>
                        </div>
                        <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
                            <div>
                                <label class="text-sm text-slate-300">Mission ID</label>
                                <Input v-model="edit.mission_id" placeholder="mission-..." />
                            </div>
                        </div>
                        <div>
                            <label class="text-sm text-slate-300">System message</label>
                            <textarea v-model="edit.system_message" rows="2" class="w-full px-3 py-2 rounded-lg bg-slate-900/60 border border-slate-700/50 text-slate-200" />
                        </div>
                        <div>
                            <label class="text-sm text-slate-300">User message</label>
                            <textarea v-model="edit.user_message" rows="6" class="w-full px-3 py-2 rounded-lg bg-slate-900/60 border border-slate-700/50 text-slate-200" />
                        </div>
                        <div class="flex justify-end">
                            <Button variant="primary" size="sm" @click="saveBasics">Salvar</Button>
                        </div>
                    </div>
                </Card>

                <Card>
                    <template #header><div class="text-sm font-semibold text-slate-200">Workflow</div></template>
                    <div v-if="workflow && workflow.length" class="space-y-2">
                        <div
                            v-for="t in workflow"
                            :key="t.id"
                            class="px-3 py-2 rounded-lg border border-slate-800 bg-slate-950/40 hover:bg-slate-900/40 cursor-pointer"
                            @click="router.push(`/tasks/${t.id}`)"
                        >
                            <div class="text-xs font-mono text-slate-200">{{ t.id }}</div>
                            <div class="text-xs text-slate-400 truncate">{{ t.spec_user_message_preview }}</div>
                        </div>
                        <div class="pt-2">
                            <Button v-if="task.meta?.workflow_id" variant="secondary" size="sm" @click="router.push(`/workflows/${task.meta.workflow_id}`)">
                                Abrir workflow
                            </Button>
                        </div>
                    </div>
                    <div v-else class="text-sm text-slate-400">Sem workflow associado.</div>
                </Card>
            </div>

            <div v-else-if="tab === 'attempts'" class="rounded-xl border border-slate-700/50 bg-slate-950/40 backdrop-blur-sm overflow-hidden">
                <div v-if="attempts.length === 0" class="px-4 py-6 text-slate-400">Nenhuma tentativa registrada.</div>
                <div v-else class="divide-y divide-slate-800">
                    <div v-for="a in attempts" :key="a.id" class="px-4 py-3 space-y-2">
                        <div class="flex items-center justify-between gap-4">
                            <div class="text-sm font-mono text-slate-200">{{ a.id }}</div>
                            <Badge size="sm" :variant="statusVariant(a.status)">{{ a.status }}</Badge>
                        </div>
                        <div class="text-xs text-slate-400">
                            criado: {{ a.created_at_ms ? new Date(a.created_at_ms).toLocaleString() : '-' }} ·
                            ended: {{ a.ended_at_ms ? new Date(a.ended_at_ms).toLocaleString() : '-' }}
                        </div>
                        <div class="flex items-center gap-2 flex-wrap">
                            <Button v-if="a.rendered_prompt_artifact_id" variant="ghost" size="sm" class="h-7 px-2 text-xs" @click="router.push(`/artifacts/${a.rendered_prompt_artifact_id}`)">
                                Prompt renderizado
                            </Button>
                            <Button v-if="a.response_text_artifact_id" variant="ghost" size="sm" class="h-7 px-2 text-xs" @click="router.push(`/artifacts/${a.response_text_artifact_id}`)">
                                Resposta (txt)
                            </Button>
                            <Button v-if="a.response_v2_json_artifact_id" variant="ghost" size="sm" class="h-7 px-2 text-xs" @click="router.push(`/artifacts/${a.response_v2_json_artifact_id}`)">
                                Resposta (json)
                            </Button>
                            <Button v-if="a.response_md_artifact_id" variant="ghost" size="sm" class="h-7 px-2 text-xs" @click="router.push(`/artifacts/${a.response_md_artifact_id}`)">
                                Resposta (md)
                            </Button>
                            <Button v-if="a.response_html_artifact_id" variant="ghost" size="sm" class="h-7 px-2 text-xs" @click="router.push(`/artifacts/${a.response_html_artifact_id}`)">
                                Resposta (html)
                            </Button>
                        </div>
                        <div v-if="a.error" class="text-xs text-red-200 bg-red-950/30 border border-red-500/30 rounded-lg p-2 whitespace-pre-wrap font-mono">{{ a.error }}</div>
                    </div>
                </div>
            </div>

            <div v-else-if="tab === 'artifacts'" class="rounded-xl border border-slate-700/50 bg-slate-950/40 backdrop-blur-sm overflow-hidden">
                <div v-if="artifacts.length === 0" class="px-4 py-6 text-slate-400">Nenhum artefato listado.</div>
                <div v-else class="divide-y divide-slate-800">
                    <div v-for="a in artifacts" :key="a.id" class="px-4 py-3 flex items-center justify-between gap-4 hover:bg-slate-900/40 cursor-pointer" @click="router.push(`/artifacts/${a.id}`)">
                        <div class="min-w-0">
                            <div class="text-sm font-mono text-slate-200 truncate">{{ a.id }}</div>
                            <div class="text-xs text-slate-400 truncate">{{ a.kind }} · {{ a.mime }} · {{ a.size_bytes }} bytes</div>
                        </div>
                        <Badge size="sm">{{ a.kind }}</Badge>
                    </div>
                </div>
            </div>

            <div v-else-if="tab === 'eventos'" class="rounded-xl border border-slate-700/50 bg-slate-950/40 backdrop-blur-sm overflow-hidden">
                <div v-if="events.length === 0" class="px-4 py-6 text-slate-400">Sem eventos.</div>
                <div v-else class="divide-y divide-slate-800">
                    <div v-for="e in events" :key="e.id" class="px-4 py-3">
                        <div class="flex items-center justify-between gap-4">
                            <div class="text-xs text-slate-400 font-mono truncate">#{{ e.id }} · {{ e.actor_type }} · {{ e.actor_id || '-' }}</div>
                            <div class="text-xs text-slate-500">{{ new Date(e.ts_ms).toLocaleString() }}</div>
                        </div>
                        <div class="text-sm text-slate-200 font-semibold">{{ e.event_type }}</div>
                        <pre class="text-xs text-slate-300 bg-slate-950/50 border border-slate-800 rounded-lg p-3 mt-2 overflow-auto max-h-56">{{ JSON.stringify(e.payload, null, 2) }}</pre>
                    </div>
                </div>
            </div>

            <div v-else-if="tab === 'deps'" class="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <Card>
                    <template #header><div class="text-sm font-semibold text-slate-200">Editar dependências</div></template>
                    <textarea v-model="depsText" rows="10" class="w-full px-3 py-2 rounded-lg bg-slate-900/60 border border-slate-700/50 text-slate-200 font-mono text-xs" />
                    <div class="flex justify-end mt-3">
                        <Button variant="primary" size="sm" @click="saveDependencies">Salvar deps</Button>
                    </div>
                    <div class="text-xs text-slate-400 mt-2">Formato: <span class="font-mono">["task-...","task-..."]</span></div>
                </Card>
                <div class="space-y-3">
                    <VisGraph :nodes="depsGraphNodes" :edges="depsGraphEdges" height="480px" />
                    <Card>
                        <template #header><div class="text-sm font-semibold text-slate-200">Dependências atuais</div></template>
                        <div v-if="dependencies.length === 0" class="text-sm text-slate-400">Nenhuma.</div>
                        <div v-else class="space-y-2">
                            <div v-for="d in dependencies" :key="d.id" class="text-xs font-mono text-slate-200 cursor-pointer hover:underline" @click="router.push(`/tasks/${d.id}`)">
                                {{ d.id }}
                            </div>
                        </div>
                    </Card>
                </div>
            </div>

            <div v-else-if="tab === 'json'" class="space-y-3">
                <Card>
                    <template #header><div class="text-sm font-semibold text-slate-200">JSON avançado (Task V5)</div></template>
                    <textarea v-model="jsonText" rows="22" class="w-full px-3 py-2 rounded-lg bg-slate-900/60 border border-slate-700/50 text-slate-200 font-mono text-xs" />
                    <div class="flex justify-end mt-3">
                        <Button variant="primary" size="sm" @click="saveJsonAdvanced">Salvar JSON</Button>
                    </div>
                </Card>
            </div>
        </div>
    </div>
</template>
