<script setup>
import { onMounted, onUnmounted, ref, watch } from 'vue';
import { DataSet } from 'vis-data';
import { Network } from 'vis-network';
import 'vis-network/styles/vis-network.min.css';

const props = defineProps({
    nodes: { type: Array, default: () => [] },
    edges: { type: Array, default: () => [] },
    height: { type: String, default: '420px' },
    options: { type: Object, default: () => ({}) },
});

const containerRef = ref(null);
let network = null;
let nodesDs = null;
let edgesDs = null;

function _defaultOptions() {
    return {
        autoResize: true,
        layout: { improvedLayout: true },
        physics: { enabled: true, stabilization: { iterations: 200 } },
        interaction: { hover: true, navigationButtons: true, keyboard: true },
        nodes: {
            shape: 'box',
            margin: 10,
            font: { color: '#e5e7eb', face: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas' },
            color: {
                background: '#0f172a',
                border: '#334155',
                highlight: { background: '#1e40af', border: '#60a5fa' },
            },
        },
        edges: {
            arrows: { to: { enabled: true, scaleFactor: 0.8 } },
            color: { color: '#475569', highlight: '#60a5fa' },
            smooth: { type: 'cubicBezier', forceDirection: 'horizontal' },
            font: { color: '#94a3b8', align: 'middle' },
        },
    };
}

function _mount() {
    if (!containerRef.value) return;
    nodesDs = new DataSet(props.nodes || []);
    edgesDs = new DataSet(props.edges || []);
    const data = { nodes: nodesDs, edges: edgesDs };
    network = new Network(containerRef.value, data, { ..._defaultOptions(), ...(props.options || {}) });
}

function _destroy() {
    if (network) {
        network.destroy();
        network = null;
    }
    nodesDs = null;
    edgesDs = null;
}

onMounted(() => {
    _mount();
});

onUnmounted(() => {
    _destroy();
});

watch(
    () => [props.nodes, props.edges],
    () => {
        if (!network || !nodesDs || !edgesDs) return;
        nodesDs.clear();
        edgesDs.clear();
        nodesDs.add(props.nodes || []);
        edgesDs.add(props.edges || []);
        network.fit({ animation: { duration: 250 } });
    },
    { deep: true }
);
</script>

<template>
    <div class="rounded-xl border border-slate-700/50 bg-slate-950/40 backdrop-blur-sm overflow-hidden">
        <div ref="containerRef" :style="{ height }" />
    </div>
</template>

