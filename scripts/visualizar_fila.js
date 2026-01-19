/* scripts/visualizar_fila.js (Audit Level 15 - Project Topology) */
// Responsabilidade: Gerar visualização topológica da fila (DOT ou HTML Interativo).
// Uso: node scripts/visualizar_fila.js [--html] [--prio-min N]

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const QUEUE_DIR = path.join(ROOT, 'fila');
const PUBLIC_DIR = path.join(ROOT, 'public');
const HTML_OUT = path.join(PUBLIC_DIR, 'graph.html');
const MODE_HTML = process.argv.includes('--html');

// --- HELPERS DE DADOS (V3) ---
const getStatus = (t) => t.state?.status || t.status || 'UNKNOWN';
const getId = (t) => t.meta?.id || t.id || '???';
const getDeps = (t) => t.policy?.dependencies || t.dependsOn || [];
const getPrompt = (t) => t.spec?.payload?.user_message || t.prompt || '';
const getPrio = (t) => t.meta?.priority ?? t.prioridade ?? 5;
const getAttempts = (t) => t.state?.attempts || 0;
const getProject = (t) => (t.meta?.tags && t.meta.tags.length > 0) ? t.meta.tags[0] : 'Sem Projeto';

// Cores Semânticas
const COLORS = {
    PENDING: '#8b949e', // Cinza
    RUNNING: '#d29922', // Amarelo/Ouro
    DONE: '#238636',    // Verde
    FAILED: '#f85149',  // Vermelho
    SKIPPED: '#30363d', // Cinza Escuro
    SCHEDULED: '#58a6ff' // Azul
};

// --- INICIALIZAÇÃO ---

if (!fs.existsSync(QUEUE_DIR)) {
    console.error("❌ Erro: Pasta 'fila' não encontrada.");
    process.exit(1);
}
if (MODE_HTML && !fs.existsSync(PUBLIC_DIR)) fs.mkdirSync(PUBLIC_DIR, { recursive: true });

const files = fs.readdirSync(QUEUE_DIR).filter(f => f.endsWith('.json'));
const tasks = [];

files.forEach(f => {
    try {
        const content = fs.readFileSync(path.join(QUEUE_DIR, f), 'utf-8');
        tasks.push(JSON.parse(content));
    } catch(e) { /* arquivo em escrita */ }
});

// --- MODO HTML (Vis.js) ---

if (MODE_HTML) {
    const nodes = tasks.map(t => {
        const status = getStatus(t);
        const attempts = getAttempts(t);
        const prio = getPrio(t);
        
        let label = `${getId(t)}\n[${status}]`;
        if (attempts > 0) label += `\nRetry: ${attempts}`;

        return {
            id: getId(t),
            label: label,
            group: getProject(t),
            title: `<b>Prompt:</b> ${getPrompt(t).slice(0, 500)}...<br><b>Prio:</b> ${prio}<br><b>Status:</b> ${status}`,
            color: {
                background: COLORS[status] || '#fff',
                border: '#30363d',
                highlight: { background: '#58a6ff', border: '#fff' }
            },
            font: { color: '#ffffff', face: 'monospace', size: 12 },
            shape: 'box',
            margin: 10,
            shadow: true
        };
    });

    const edges = [];
    tasks.forEach(t => {
        getDeps(t).forEach(depId => {
            const exists = tasks.some(x => getId(x) === depId);
            edges.push({ 
                from: depId, 
                to: getId(t), 
                arrows: 'to',
                dashes: !exists,
                color: exists ? '#8b949e' : '#f85149',
                width: exists ? 1 : 3,
                title: exists ? 'Dependência OK' : 'ERRO: Dependência Inexistente'
            });
        });
    });

    const htmlContent = `
<!DOCTYPE html>
<html>
<head>
    <title>Mission Control - Task Topology</title>
    <meta charset="utf-8">
    <script type="text/javascript" src="https://unpkg.com/vis-network/standalone/umd/vis-network.min.js"></script>
    <style>
        body { margin: 0; background: #0d1117; color: #c9d1d9; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif; overflow: hidden; }
        #mynetwork { width: 100vw; height: 100vh; }
        .ui-overlay { position: absolute; top: 20px; left: 20px; background: rgba(22, 27, 34, 0.9); padding: 20px; border-radius: 8px; border: 1px solid #30363d; z-index: 1000; pointer-events: none; }
        .legend-item { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; font-size: 12px; font-weight: 600; }
        .dot { width: 12px; height: 12px; border-radius: 2px; border: 1px solid rgba(255,255,255,0.1); }
        h1 { font-size: 16px; margin: 0 0 15px 0; color: #fff; border-bottom: 1px solid #30363d; padding-bottom: 10px; }
    </style>
</head>
<body>
    <div class="ui-overlay">
        <h1>MAPA DE DEPENDÊNCIAS</h1>
        <div class="legend-item"><span class="dot" style="background:${COLORS.RUNNING}"></span> RODANDO</div>
        <div class="legend-item"><span class="dot" style="background:${COLORS.DONE}"></span> CONCLUÍDO</div>
        <div class="legend-item"><span class="dot" style="background:${COLORS.PENDING}"></span> PENDENTE</div>
        <div class="legend-item"><span class="dot" style="background:${COLORS.FAILED}"></span> FALHA</div>
        <div class="legend-item"><span class="dot" style="background:${COLORS.SKIPPED}"></span> PULADO</div>
        <div style="margin-top:15px; font-size:10px; color:#8b949e;">Scroll: Zoom | Drag: Mover | Hover: Detalhes</div>
    </div>
    <div id="mynetwork"></div>
    <script type="text/javascript">
        var nodes = new vis.DataSet(${JSON.stringify(nodes)});
        var edges = new vis.DataSet(${JSON.stringify(edges)});
        var container = document.getElementById('mynetwork');
        var data = { nodes: nodes, edges: edges };
        var options = {
            layout: { 
                hierarchical: { 
                    direction: "LR", 
                    sortMethod: "directed", 
                    levelSeparation: 300,
                    nodeSpacing: 100
                } 
            },
            physics: false,
            interaction: { hover: true, tooltipDelay: 200 },
            groups: {
                // Estilos automáticos por projeto poderiam ser definidos aqui
            }
        };
        var network = new vis.Network(container, data, options);
    </script>
</body>
</html>`;

    fs.writeFileSync(HTML_OUT, htmlContent);
    console.log(`\n✅ Grafo gerado: public/graph.html`);
    console.log(`   Acesse: http://localhost:3000/graph.html`);

} else {
    // --- MODO DOT (Padrão para CLI) ---
    console.log('digraph Fila {');
    console.log('  rankdir=LR; bgcolor="#0d1117";');
    console.log('  node [shape=box, style="filled,rounded", fontname="Arial", fontcolor="#ffffff", color="#30363d"];');
    console.log('  edge [color="#8b949e", arrowsize=0.7];');
    
    tasks.forEach(t => {
        const id = getId(t);
        const status = getStatus(t);
        const color = COLORS[status] || '#ffffff';
        console.log(`  "${id}" [label="${id}\\n(${status})", fillcolor="${color}"];`);
        
        getDeps(t).forEach(depId => {
            const exists = tasks.some(x => getId(x) === depId);
            const edgeColor = exists ? '#8b949e' : '#f85149';
            const style = exists ? 'solid' : 'dashed';
            console.log(`  "${depId}" -> "${id}" [color="${edgeColor}", style="${style}"];`);
        });
    });
    console.log('}');
}