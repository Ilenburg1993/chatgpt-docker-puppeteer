<template>
    <div class="workflow-editor">
        <!-- Header -->
        <div class="page-header">
            <div class="header-left">
                <h1>Workflow Editor</h1>
                <span class="workflow-count"
                    >{{ workflows.length }} workflow{{ workflows.length !== 1 ? 's' : '' }}</span
                >
            </div>
            <div class="header-actions">
                <button class="btn btn-primary" @click="createNewWorkflow">+ Novo Workflow</button>
            </div>
        </div>

        <!-- Main Layout -->
        <div class="editor-layout">
            <!-- Workflow List (left sidebar) -->
            <div class="workflow-list">
                <h3>Workflows</h3>
                <div class="list-body">
                    <div
                        v-for="wf in workflows"
                        :key="wf.id"
                        class="workflow-item"
                        :class="{ active: currentWorkflow && currentWorkflow.id === wf.id }"
                        @click="selectWorkflow(wf)"
                    >
                        <span class="wf-name">{{ wf.name }}</span>
                        <span class="wf-nodes">{{ (wf.nodes || []).length }} nós</span>
                    </div>
                    <div class="list-empty" v-if="workflows.length === 0">Nenhum workflow criado</div>
                </div>
            </div>

            <!-- DAG Canvas (center) -->
            <div class="canvas-area">
                <!-- Toolbar -->
                <div class="toolbar" v-if="currentWorkflow">
                    <div class="toolbar-left">
                        <input
                            v-model="currentWorkflow.name"
                            class="workflow-name-input"
                            placeholder="Nome do workflow"
                        />
                    </div>
                    <div class="toolbar-actions">
                        <button class="btn" @click="addNode">+ Nó</button>
                        <button class="btn" :class="{ active: edgeMode }" @click="toggleEdgeMode">
                            {{ edgeMode ? 'Conectar (ativo)' : 'Conectar' }}
                        </button>
                        <button class="btn btn-danger" @click="deleteSelected" :disabled="!selectedNode">
                            Deletar
                        </button>
                        <div class="toolbar-divider"></div>
                        <button class="btn" @click="validateWorkflow">Validar</button>
                        <button class="btn btn-primary" @click="saveWorkflow">Salvar</button>
                        <button class="btn btn-success" @click="executeWorkflow">Executar</button>
                    </div>
                </div>

                <!-- Canvas -->
                <div class="canvas-container" ref="canvasContainer">
                    <div v-if="!currentWorkflow" class="canvas-empty">
                        <p>Selecione ou crie um workflow para começar</p>
                    </div>
                    <div v-else ref="cytoscapeMount" class="cytoscape-canvas"></div>
                </div>

                <!-- Validation Result -->
                <div class="validation-result" v-if="validationResult">
                    <div :class="'validation-' + validationResult.status">
                        <span class="validation-icon">{{ validationResult.status === 'valid' ? '✓' : '✗' }}</span>
                        <span class="validation-message">{{ validationResult.message }}</span>
                    </div>
                </div>
            </div>

            <!-- Node Editor (right sidebar) -->
            <div class="node-editor" v-if="selectedNode">
                <h3>Editar Nó</h3>
                <div class="editor-form">
                    <div class="form-group">
                        <label>Nome</label>
                        <input v-model="selectedNode.data.label" type="text" class="input" />
                    </div>
                    <div class="form-group">
                        <label>Tipo</label>
                        <select v-model="selectedNode.data.type" class="input">
                            <option value="prompt">Prompt</option>
                            <option value="validate">Validar</option>
                            <option value="branch">Branch</option>
                            <option value="aggregate">Agregar</option>
                        </select>
                    </div>
                    <div class="form-group">
                        <label>Descrição</label>
                        <textarea v-model="selectedNode.data.description" rows="3" class="input"></textarea>
                    </div>
                    <div class="form-group" v-if="selectedNode.data.type === 'prompt'">
                        <label>Template do Prompt</label>
                        <textarea
                            v-model="selectedNode.data.prompt"
                            rows="5"
                            class="input"
                            placeholder="Use {step_id} para referenciar resultados anteriores"
                        ></textarea>
                    </div>
                    <div class="form-group" v-if="selectedNode.data.type === 'validate'">
                        <label>Critérios de Validação</label>
                        <textarea
                            v-model="selectedNode.data.criteria"
                            rows="3"
                            class="input"
                            placeholder="coerência, precisão, formato"
                        ></textarea>
                    </div>
                    <div class="form-group">
                        <label>Em caso de falha</label>
                        <select v-model="selectedNode.data.onFailure" class="input">
                            <option value="abort">Abortar</option>
                            <option value="retry">Retry</option>
                            <option value="skip">Pular</option>
                        </select>
                    </div>
                    <div class="form-actions">
                        <button class="btn btn-primary" @click="updateNode">Atualizar</button>
                        <button class="btn" @click="deselectNode">Cancelar</button>
                    </div>
                </div>

                <!-- Node info -->
                <div class="node-info" v-if="selectedNode">
                    <h4>Dependências</h4>
                    <div class="deps-list">
                        <span v-for="dep in getNodeDependencies(selectedNode.data.id)" :key="dep" class="dep-tag">
                            {{ dep }}
                        </span>
                        <span v-if="getNodeDependencies(selectedNode.data.id).length === 0" class="no-deps">
                            Nenhuma dependência
                        </span>
                    </div>
                </div>
            </div>
        </div>
    </div>
</template>

<script>
import cytoscape from 'cytoscape';
import { computed, onUnmounted, ref, watch } from 'vue';

export default {
    name: 'WorkflowEditor',

    setup() {
        const cytoscapeMount = ref(null);
        const currentWorkflow = ref(null);
        const selectedNode = ref(null);
        const edgeMode = ref(false);
        const edgeModeSource = ref(null);
        const validationResult = ref(null);
        let cy = null;

        // Simulated workflows storage (in-memory for now)
        const workflows = ref([
            {
                id: 'wf-default',
                name: 'Exemplo: Escrita de Documento',
                nodes: [
                    {
                        data: {
                            id: 'n1',
                            label: 'Gerar Outline',
                            type: 'prompt',
                            description: 'Cria a estrutura do documento',
                            prompt: 'Gere um outline detalhado para: {topic}',
                            onFailure: 'abort',
                        },
                    },
                    {
                        data: {
                            id: 'n2',
                            label: 'Escrever Seção 1',
                            type: 'prompt',
                            description: 'Primeira seção',
                            prompt: 'Escreva a seção 1 baseada no outline: {n1}',
                            onFailure: 'retry',
                        },
                    },
                    {
                        data: {
                            id: 'n3',
                            label: 'Escrever Seção 2',
                            type: 'prompt',
                            description: 'Segunda seção',
                            prompt: 'Escreva a seção 2 baseada no outline: {n1}',
                            onFailure: 'retry',
                        },
                    },
                    {
                        data: {
                            id: 'n4',
                            label: 'Revisar',
                            type: 'validate',
                            description: 'Verifica coerência',
                            criteria: 'coerência, precisão, estilo',
                            onFailure: 'abort',
                        },
                    },
                    {
                        data: {
                            id: 'n5',
                            label: 'Compilar Final',
                            type: 'aggregate',
                            description: 'Junta todas as seções',
                            onFailure: 'abort',
                        },
                    },
                ],
                edges: [
                    { data: { source: 'n1', target: 'n2' } },
                    { data: { source: 'n1', target: 'n3' } },
                    { data: { source: 'n2', target: 'n4' } },
                    { data: { source: 'n3', target: 'n4' } },
                    { data: { source: 'n4', target: 'n5' } },
                ],
            },
        ]);

        // Node type colors
        const typeColors = {
            prompt: '#3498db',
            validate: '#27ae60',
            branch: '#f39c12',
            aggregate: '#9b59b6',
        };

        // Initialize Cytoscape
        function initCytoscape() {
            if (!cytoscapeMount.value || !currentWorkflow.value) return;

            // Destroy previous instance
            if (cy) {
                cy.destroy();
                cy = null;
            }

            const elements = [...(currentWorkflow.value.nodes || []), ...(currentWorkflow.value.edges || [])];

            cy = cytoscape({
                container: cytoscapeMount.value,
                elements: elements,
                style: [
                    {
                        selector: 'node',
                        css: {
                            'background-color': (ele) => typeColors[ele.data('type')] || '#64748b',
                            label: 'data(label)',
                            color: '#fff',
                            'text-align': 'center',
                            'text-valign': 'middle',
                            'font-size': '11px',
                            'font-weight': '600',
                            width: '120px',
                            height: '50px',
                            'border-radius': '8px',
                            'border-width': '2px',
                            'border-color': '#fff',
                            'box-shadow-color': 'rgba(0,0,0,0.15)',
                            'box-shadow-blur-radius': '6px',
                            'box-shadow-offset-x': '0px',
                            'box-shadow-offset-y': '2px',
                        },
                    },
                    {
                        selector: 'node:selected',
                        css: {
                            'border-color': '#fbbf24',
                            'border-width': '3px',
                        },
                    },
                    {
                        selector: 'edge',
                        css: {
                            width: '2px',
                            'line-color': '#94a3b8',
                            'target-arrow-color': '#94a3b8',
                            'target-arrow-shape': 'classic',
                            'curve-style': 'bezier',
                            'source-endpoint': 'south',
                            'target-endpoint': 'north',
                        },
                    },
                    {
                        selector: 'edge:selected',
                        css: {
                            'line-color': '#3498db',
                            'target-arrow-color': '#3498db',
                            width: '3px',
                        },
                    },
                ],
                layout: {
                    name: 'dagre',
                    rankDir: 'TB',
                    padding: 20,
                    spacingFactor: 1.5,
                },
                userDragPan: true,
                userZoomable: true,
                autoEdgesAsLines: true,
                autoArrowsAsEdges: true,
            });

            // Node click handler
            cy.on('tap', 'node', (evt) => {
                const node = evt.target;

                if (edgeMode) {
                    if (!edgeModeSource.value) {
                        // First click: select source
                        edgeModeSource.value = node.id();
                        node.addClass('edge-source');
                    } else if (edgeModeSource.value !== node.id()) {
                        // Second click: create edge
                        const existingEdge = cy.getElementById(`${edgeModeSource.value}-${node.id()}`);
                        if (!existingEdge.length) {
                            const newEdge = { data: { source: edgeModeSource.value, target: node.id() } };
                            cy.add(newEdge);
                            currentWorkflow.value.edges.push(newEdge);
                        }
                        cy.$('.edge-source').removeClass('edge-source');
                        edgeModeSource.value = null;
                    }
                } else {
                    // Select node for editing
                    const nodeData = node.data();
                    selectedNode.value = {
                        data: { ...nodeData },
                    };
                }
            });

            // Background click: deselect
            cy.on('tap', (evt) => {
                if (evt.target === cy) {
                    deselectNode();
                    if (edgeMode) {
                        cy.$('.edge-source').removeClass('edge-source');
                        edgeModeSource.value = null;
                    }
                }
            });

            // Drag end: update positions
            cy.on('dragfreeon', 'node', () => {
                syncPositions();
            });
        }

        // Sync positions from cytoscape to workflow data
        function syncPositions() {
            if (!cy || !currentWorkflow.value) return;

            cy.nodes().forEach((node) => {
                const pos = node.position();
                const nodeData = currentWorkflow.value.nodes.find((n) => n.data.id === node.id());
                if (nodeData) {
                    nodeData.data.position = { x: pos.x, y: pos.y };
                }
            });
        }

        // Sync edges from cytoscape to workflow
        function syncEdges() {
            if (!cy || !currentWorkflow.value) return;

            currentWorkflow.value.edges = [];
            cy.edges().forEach((edge) => {
                currentWorkflow.value.edges.push({
                    data: { source: edge.source().id(), target: edge.target().id() },
                });
            });
        }

        // Add new node
        function addNode() {
            if (!currentWorkflow.value) return;

            const newId = `node-${Date.now()}`;
            const newNode = {
                data: {
                    id: newId,
                    label: 'Novo Nó',
                    type: 'prompt',
                    description: '',
                    prompt: '',
                    onFailure: 'abort',
                },
            };

            currentWorkflow.value.nodes.push(newNode);

            if (cy) {
                cy.add({ data: { ...newNode.data } });
                cy.layout({ name: 'dagre', rankDir: 'TB', padding: 20, spacingFactor: 1.5 }).run();
            }

            validationResult.value = null;
        }

        // Toggle edge drawing mode
        function toggleEdgeMode() {
            edgeMode.value = !edgeMode.value;
            edgeModeSource.value = null;
            if (cy) {
                cy.$('.edge-source').removeClass('edge-source');
            }
        }

        // Delete selected node
        function deleteSelected() {
            if (!selectedNode.value || !cy) return;

            const nodeId = selectedNode.value.data.id;

            // Remove from cytoscape
            cy.getElementById(nodeId).remove();

            // Sync back
            currentWorkflow.value.nodes = currentWorkflow.value.nodes.filter((n) => n.data.id !== nodeId);
            syncEdges();

            selectedNode.value = null;
            validationResult.value = null;
        }

        // Update node data
        function updateNode() {
            if (!selectedNode.value || !cy) return;

            const nodeId = selectedNode.value.data.id;
            const cyNode = cy.getElementById(nodeId);

            if (cyNode.length) {
                cyNode.data('label', selectedNode.value.data.label);
                cyNode.data('type', selectedNode.value.data.type);
                cyNode.style('background-color', typeColors[selectedNode.value.data.type] || '#64748b');
            }

            // Update workflow data
            const nodeData = currentWorkflow.value.nodes.find((n) => n.data.id === nodeId);
            if (nodeData) {
                nodeData.data = { ...selectedNode.value.data };
            }

            validationResult.value = null;
        }

        // Deselect node
        function deselectNode() {
            selectedNode.value = null;
            if (cy) {
                cy.$('node').deselect();
            }
        }

        // Get dependencies for a node
        function getNodeDependencies(nodeId) {
            if (!currentWorkflow.value) return [];

            return currentWorkflow.value.edges
                .filter((e) => e.data.target === nodeId)
                .map((e) => {
                    const sourceNode = currentWorkflow.value.nodes.find((n) => n.data.id === e.data.source);
                    return sourceNode ? sourceNode.data.label : e.data.source;
                });
        }

        // Select a workflow
        function selectWorkflow(wf) {
            currentWorkflow.value = JSON.parse(JSON.stringify(wf));
            selectedNode.value = null;
            edgeMode.value = false;
            validationResult.value = null;

            // Init cytoscape after next tick (DOM updated)
            setTimeout(() => {
                initCytoscape();
            }, 50);
        }

        // Create new workflow
        function createNewWorkflow() {
            const newWorkflow = {
                id: `wf-${Date.now()}`,
                name: 'Novo Workflow',
                nodes: [],
                edges: [],
            };

            workflows.value.push(newWorkflow);
            selectWorkflow(newWorkflow);
        }

        // Validate workflow (check for cycles, orphans)
        function validateWorkflow() {
            if (!currentWorkflow.value) return;

            const nodes = currentWorkflow.value.nodes || [];
            const edges = currentWorkflow.value.edges || [];

            // Check: at least one node
            if (nodes.length === 0) {
                validationResult.value = { status: 'invalid', message: 'Workflow deve ter pelo menos um nó.' };
                return;
            }

            // Check: cycle detection (simple DFS)
            const adj = {};
            nodes.forEach((n) => {
                adj[n.data.id] = [];
            });
            edges.forEach((e) => {
                if (adj[e.data.source]) {
                    adj[e.data.source].push(e.data.target);
                }
            });

            const visited = new Set();
            const inStack = new Set();

            function hasCycle(node) {
                visited.add(node);
                inStack.add(node);

                for (const neighbor of adj[node] || []) {
                    if (inStack.has(neighbor)) return true;
                    if (!visited.has(neighbor) && hasCycle(neighbor)) return true;
                }

                inStack.delete(node);
                return false;
            }

            for (const node of nodes) {
                if (!visited.has(node.data.id)) {
                    if (hasCycle(node.data.id)) {
                        validationResult.value = {
                            status: 'invalid',
                            message: 'Ciclo detectado no grafo de dependências.',
                        };
                        return;
                    }
                }
            }

            // Check: orphan detection (nodes with no in or out edges, except start/end nodes)
            const nodesWithEdges = new Set();
            edges.forEach((e) => {
                nodesWithEdges.add(e.data.source);
                nodesWithEdges.add(e.data.target);
            });

            const orphans = nodes.filter((n) => !nodesWithEdges.has(n.data.id));
            if (orphans.length > 0 && nodes.length > 1) {
                validationResult.value = {
                    status: 'warning',
                    message: `${orphans.length} nó(s) sem conexão: ${orphans.map((o) => o.data.label).join(', ')}`,
                };
                return;
            }

            // Valid
            validationResult.value = { status: 'valid', message: 'Workflow é um DAG válido.' };
        }

        // Save workflow
        function saveWorkflow() {
            if (!currentWorkflow.value) return;

            syncPositions();
            syncEdges();

            // Update in workflows list
            const idx = workflows.value.findIndex((w) => w.id === currentWorkflow.value.id);
            if (idx !== -1) {
                workflows.value[idx] = JSON.parse(JSON.stringify(currentWorkflow.value));
            }

            validationResult.value = null;
            alert('Workflow salvo com sucesso.');
        }

        // Execute workflow (placeholder)
        function executeWorkflow() {
            validateWorkflow();
            if (validationResult.value?.status !== 'valid') return;

            alert('Execução do workflow iniciada. (Funcionalidade em desenvolvimento)');
        }

        // Computed list (just the workflows reference)
        const workflowCount = computed(() => workflows.value.length);

        // Watch workflow changes to re-init
        watch(currentWorkflow, () => {
            // Handled by selectWorkflow
        });

        // Cleanup on unmount
        onUnmounted(() => {
            if (cy) {
                cy.destroy();
                cy = null;
            }
        });

        return {
            cytoscapeMount,
            currentWorkflow,
            selectedNode,
            edgeMode,
            validationResult,
            workflows,
            workflowCount,
            addNode,
            toggleEdgeMode,
            deleteSelected,
            updateNode,
            deselectNode,
            getNodeDependencies,
            selectWorkflow,
            createNewWorkflow,
            validateWorkflow,
            saveWorkflow,
            executeWorkflow,
        };
    },
};
</script>

<style scoped>
.workflow-editor {
    padding: 20px;
    height: calc(100vh - 80px);
    display: flex;
    flex-direction: column;
}

/* Header */
.page-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 16px;
}

.header-left {
    display: flex;
    align-items: center;
    gap: 12px;
}

.page-header h1 {
    font-size: 1.5rem;
    font-weight: 600;
    color: #1e293b;
    margin: 0;
}

.workflow-count {
    font-size: 0.8rem;
    color: #64748b;
}

/* Editor Layout */
.editor-layout {
    display: grid;
    grid-template-columns: 220px 1fr 260px;
    gap: 12px;
    flex: 1;
    min-height: 0;
    overflow: hidden;
}

/* Workflow List */
.workflow-list {
    background: #fff;
    border: 1px solid #e2e8f0;
    border-radius: 12px;
    display: flex;
    flex-direction: column;
    overflow: hidden;
}

.workflow-list h3 {
    font-size: 0.85rem;
    font-weight: 600;
    color: #475569;
    margin: 0;
    padding: 12px 14px;
    border-bottom: 1px solid #f1f5f9;
    background: #f8fafc;
}

.list-body {
    flex: 1;
    overflow-y: auto;
    padding: 8px;
    display: flex;
    flex-direction: column;
    gap: 4px;
}

.workflow-item {
    padding: 10px 12px;
    border-radius: 8px;
    cursor: pointer;
    transition: background 0.15s;
    display: flex;
    flex-direction: column;
    gap: 2px;
}

.workflow-item:hover {
    background: #f1f5f9;
}

.workflow-item.active {
    background: #eff6ff;
    border: 1px solid #bfdbfe;
}

.wf-name {
    font-size: 0.85rem;
    font-weight: 600;
    color: #1e293b;
}

.wf-nodes {
    font-size: 0.7rem;
    color: #94a3b8;
}

.list-empty {
    font-size: 0.8rem;
    color: #94a3b8;
    text-align: center;
    padding: 20px 10px;
}

/* Canvas Area */
.canvas-area {
    display: flex;
    flex-direction: column;
    overflow: hidden;
}

/* Toolbar */
.toolbar {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 8px;
    padding: 8px 0;
    flex-shrink: 0;
}

.toolbar-left {
    flex-shrink: 0;
}

.workflow-name-input {
    padding: 6px 10px;
    border: 1px solid #e2e8f0;
    border-radius: 6px;
    font-size: 0.85rem;
    color: #1e293b;
    background: #fff;
    width: 200px;
}

.workflow-name-input:focus {
    outline: none;
    border-color: #3b82f6;
}

.toolbar-actions {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
}

.toolbar-divider {
    width: 1px;
    height: 28px;
    background: #e2e8f0;
    margin: 0 4px;
}

/* Canvas Container */
.canvas-container {
    flex: 1;
    background: #fff;
    border: 1px solid #e2e8f0;
    border-radius: 12px;
    overflow: hidden;
    position: relative;
    min-height: 0;
}

.canvas-empty {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100%;
    color: #94a3b8;
    font-size: 0.9rem;
}

.cytoscape-canvas {
    width: 100%;
    height: 100%;
}

/* Validation Result */
.validation-result {
    padding: 8px 0;
    flex-shrink: 0;
}

.validation-valid,
.validation-invalid,
.validation-warning {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    border-radius: 6px;
    font-size: 0.8rem;
}

.validation-valid {
    background: #f0fdf4;
    border: 1px solid #bbf7d0;
    color: #166534;
}

.validation-invalid {
    background: #fef2f2;
    border: 1px solid #fecaca;
    color: #991b1b;
}

.validation-warning {
    background: #fffbeb;
    border: 1px solid #fde68a;
    color: #92400e;
}

.validation-icon {
    font-weight: 700;
}

/* Node Editor */
.node-editor {
    background: #fff;
    border: 1px solid #e2e8f0;
    border-radius: 12px;
    display: flex;
    flex-direction: column;
    overflow-y: auto;
}

.node-editor h3 {
    font-size: 0.85rem;
    font-weight: 600;
    color: #475569;
    margin: 0;
    padding: 12px 14px;
    border-bottom: 1px solid #f1f5f9;
    background: #f8fafc;
}

.editor-form {
    padding: 14px;
    display: flex;
    flex-direction: column;
    gap: 12px;
}

.form-group {
    display: flex;
    flex-direction: column;
    gap: 4px;
}

.form-group label {
    font-size: 0.75rem;
    font-weight: 600;
    color: #64748b;
    text-transform: uppercase;
}

.input {
    padding: 6px 10px;
    border: 1px solid #e2e8f0;
    border-radius: 6px;
    font-size: 0.8rem;
    color: #1e293b;
    background: #fff;
    font-family: inherit;
}

.input:focus {
    outline: none;
    border-color: #3b82f6;
}

textarea.input {
    resize: vertical;
}

.form-actions {
    display: flex;
    gap: 8px;
    padding-top: 4px;
    border-top: 1px solid #f1f5f9;
    margin-top: 4px;
}

/* Node Info */
.node-info {
    padding: 14px;
    border-top: 1px solid #f1f5f9;
}

.node-info h4 {
    font-size: 0.75rem;
    font-weight: 600;
    color: #64748b;
    text-transform: uppercase;
    margin: 0 0 8px 0;
}

.deps-list {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
}

.dep-tag {
    padding: 3px 8px;
    background: #eff6ff;
    border: 1px solid #bfdbfe;
    border-radius: 12px;
    font-size: 0.7rem;
    color: #1d4ed8;
}

.no-deps {
    font-size: 0.75rem;
    color: #94a3b8;
}

/* Buttons */
.btn {
    padding: 6px 12px;
    border: 1px solid #e2e8f0;
    border-radius: 6px;
    background: #fff;
    color: #475569;
    font-size: 0.8rem;
    cursor: pointer;
    transition: all 0.15s;
    white-space: nowrap;
}

.btn:hover:not(:disabled) {
    background: #f1f5f9;
}

.btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
}

.btn.active {
    background: #dbeafe;
    border-color: #93c5fd;
    color: #1d4ed8;
}

.btn-primary {
    background: #3b82f6;
    border-color: #3b82f6;
    color: #fff;
}

.btn-primary:hover:not(:disabled) {
    background: #2563eb;
}

.btn-success {
    background: #22c55e;
    border-color: #22c55e;
    color: #fff;
}

.btn-success:hover:not(:disabled) {
    background: #16a34a;
}

.btn-danger {
    color: #dc2626;
}

.btn-danger:hover:not(:disabled) {
    background: #fef2f2;
    border-color: #fecaca;
}

/* Responsive */
@media (max-width: 1100px) {
    .editor-layout {
        grid-template-columns: 1fr;
        grid-template-rows: auto 1fr auto;
    }

    .workflow-list {
        flex-direction: row;
        max-height: 120px;
    }

    .list-body {
        flex-direction: row;
        overflow-x: auto;
        overflow-y: hidden;
    }

    .workflow-item {
        min-width: 140px;
        flex-shrink: 0;
    }

    .node-editor {
        max-height: 250px;
    }
}
</style>
