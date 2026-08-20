<script setup lang="ts">
import { DataSet } from 'vis-data';
import { Network, type Edge, type Node, type Options } from 'vis-network';
import 'vis-network/styles/vis-network.min.css';
import { onMounted, onUnmounted, ref, watch } from 'vue';

const props = withDefaults(defineProps<{ nodes?: Node[]; edges?: Edge[]; height?: string; options?: Options }>(), {
    nodes: () => [],
    edges: () => [],
    height: '420px',
    options: () => ({}),
});

const containerRef = ref<HTMLDivElement | null>(null);
let network: Network | null = null;
let nodesDs: DataSet<Node> | null = null;
let edgesDs: DataSet<Edge> | null = null;

function _defaultOptions(): Options {
    return {
        autoResize: true,
        layout: { improvedLayout: true },
        physics: { enabled: true, stabilization: { iterations: 200 } },
        interaction: { hover: true, navigationButtons: true, keyboard: true },
        nodes: {
            shape: 'box',
            margin: { top: 10, right: 10, bottom: 10, left: 10 },
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
            smooth: { enabled: true, type: 'cubicBezier', forceDirection: 'horizontal', roundness: 0.5 },
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
        network.fit({ animation: true });
    },
    { deep: true },
);
</script>

<template>
    <div class="rounded-xl border border-slate-700/50 bg-slate-950/40 backdrop-blur-sm overflow-hidden">
        <div ref="containerRef" :style="{ height }" />
    </div>
</template>
