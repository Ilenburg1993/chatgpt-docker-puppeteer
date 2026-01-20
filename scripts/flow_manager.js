/* scripts/flow_manager.js (Audit Level 15 - Enterprise Flow Manager) */
// Responsabilidade: Gerenciar fluxos de trabalho (Blueprints) com integridade total.
// Recursos: Detecção de Ciclos, Escrita Atômica, Idempotência e Sanitização.

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const ROOT = path.resolve(__dirname, '..');
const QUEUE_DIR = path.join(ROOT, 'fila');
const BLUEPRINTS_DIR = path.join(ROOT, 'blueprints');

// --- HELPERS DE ROBUSTEZ ---

function sanitize(name) {
    return name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 50);
}

function atomicWrite(filepath, content) {
    const tmp = filepath + '.tmp.' + Date.now();
    fs.writeFileSync(tmp, content, 'utf-8');
    fs.renameSync(tmp, filepath);
}

// Garante infraestrutura
[BLUEPRINTS_DIR, QUEUE_DIR].forEach(d => { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); });

// --- ARGUMENTOS ---

const args = process.argv.slice(2);
const isDryRun = args.includes('--dry-run');
const afterArgIndex = args.indexOf('--after');
const executeAfterInput = afterArgIndex !== -1 ? args[afterArgIndex + 1] : null;
const blueprintArg = args.find(a => !a.startsWith('--') && a !== executeAfterInput);

if (!blueprintArg) {
    console.log(`
Uso: node scripts/flow_manager.js <arquivo.yaml> [opções]

Opções:
  --dry-run      Apenas simula a criação das tarefas.
  --after <time> Agenda o início (ex: "10m", "1h", "2024-12-31").

Exemplo:
  node scripts/flow_manager.js projeto_livro --after 2h
`);
    process.exit(1);
}

// --- PARSER DE AGENDAMENTO ---

function parseSchedule(input) {
    if (!input) return null;
    const match = input.match(/^(\d+)([mh])$/);
    if (match) {
        const val = parseInt(match[1]);
        const unit = match[2];
        return new Date(Date.now() + val * (unit === 'm' ? 60000 : 3600000)).toISOString();
    }
    const date = new Date(input);
    return !isNaN(date.getTime()) ? date.toISOString() : null;
}

const executeAfterDate = parseSchedule(executeAfterInput);
const blueprintPath = path.join(BLUEPRINTS_DIR, blueprintArg.endsWith('.yaml') ? blueprintArg : `${blueprintArg}.yaml`);

if (!fs.existsSync(blueprintPath)) {
    console.error(`❌ ERRO: Blueprint não encontrado: ${blueprintPath}`);
    process.exit(1);
}

// --- LÓGICA PRINCIPAL ---

try {
    const fileContent = fs.readFileSync(blueprintPath, 'utf-8');
    const doc = yaml.load(fileContent);

    if (!doc.project || !Array.isArray(doc.tasks)) {
        throw new Error("Formato de YAML inválido. Requer 'project' (string) e 'tasks' (array).");
    }

    const projectPrefix = sanitize(doc.project);
    const defaults = doc.defaults || {};

    console.log(`\n📘 PROJETO: ${doc.project} (ID: ${projectPrefix})`);
    if (executeAfterDate) console.log(`   ⏱️ AGENDAMENTO: ${new Date(executeAfterDate).toLocaleString()}`);
    console.log(`   🛠️ MODO: ${isDryRun ? 'SIMULAÇÃO (DRY-RUN)' : 'EXECUÇÃO'}`);

    // 1. Mapeamento de IDs
    const tasks = [];
    const idMap = {}; // ID Curto -> ID Real do Sistema

    doc.tasks.forEach(t => {
        if (!t.id) throw new Error("Uma das tarefas não possui o campo 'id' obrigatório.");
        const realId = `${projectPrefix}-${sanitize(t.id)}`;
        idMap[t.id] = realId;
        tasks.push({ ...t, realId });
    });

    // 2. Validação de Dependências e Ciclos
    const adj = {};
    tasks.forEach(t => {
        const deps = t.depends_on || [];
        deps.forEach(d => {
            if (!idMap[d]) throw new Error(`Dependência quebrada: '${t.id}' refere-se a '${d}', que não existe.`);
        });
        adj[t.id] = deps;
    });

    const visited = new Set();
    const stack = new Set();
    function hasCycle(v) {
        visited.add(v);
        stack.add(v);
        for (const neighbor of (adj[v] || [])) {
            if (!visited.has(neighbor)) {
                if (hasCycle(neighbor)) return true;
            } else if (stack.has(neighbor)) return true;
        }
        stack.delete(v);
        return false;
    }

    for (const t of tasks) {
        if (!visited.has(t.id)) {
            if (hasCycle(t.id)) throw new Error(`ERRO: Ciclo de dependência detectado na tarefa '${t.id}'.`);
        }
    }

    // 3. Geração e Escrita Atômica
    let created = 0;
    let updated = 0;
    let skipped = 0;
    let previousTaskId = null;

    tasks.forEach(t => {
        const realDeps = (t.depends_on || []).map(d => idMap[d]);
        
        // Suporte a {{REF:LAST}}
        if (t.prompt.includes('{{REF:LAST}}') && previousTaskId) {
            if (!realDeps.includes(previousTaskId)) realDeps.push(previousTaskId);
        }

        // Resolução de Referências no Prompt
        let finalPrompt = t.prompt;
        Object.keys(idMap).forEach(shortId => {
            const regex = new RegExp(`\\{\\{REF:${shortId}\\}\\}`, 'g');
            finalPrompt = finalPrompt.replace(regex, `{{REF:${idMap[shortId]}}}`);
        });

        const taskObj = {
            meta: {
                id: t.realId,
                version: "3.0",
                created_at: new Date().toISOString(),
                priority: t.prio || defaults.prio || 5,
                source: "flow_manager",
                tags: [doc.project, t.id, ...(defaults.tags || [])]
            },
            spec: {
                target: t.target || defaults.target || "chatgpt",
                model: t.model || defaults.model || "gpt-5",
                payload: {
                    system_message: t.system || defaults.system || "",
                    user_message: finalPrompt
                },
                config: {
                    reset_context: t.reset_context !== undefined ? t.reset_context : (defaults.reset_context || false)
                }
            },
            policy: {
                max_attempts: t.max_attempts || defaults.max_attempts || 3,
                timeout_ms: t.timeout_ms || defaults.timeout_ms || "auto",
                dependencies: realDeps,
                execute_after: executeAfterDate
            },
            state: { status: "PENDING", attempts: 0, history: [] }
        };

        const filePath = path.join(QUEUE_DIR, `${t.realId}.json`);
        let action = "CREATE";

        if (fs.existsSync(filePath)) {
            try {
                const existing = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
                if (existing.state.status === 'DONE') {
                    console.log(`   [SKIP] ${t.id} (Já concluída)`);
                    skipped++;
                    previousTaskId = t.realId;
                    return;
                }
                action = "UPDATE";
            } catch (e) { action = "REPAIR"; }
        }

        if (!isDryRun) {
            atomicWrite(filePath, JSON.stringify(taskObj, null, 2));
            console.log(`   [${action}] ${t.id} -> ${t.realId}`);
            action === "CREATE" ? created++ : updated++;
        } else {
            console.log(`   [DRY] ${action}: ${t.id} (Deps: ${realDeps.length})`);
        }

        previousTaskId = t.realId;
    });

    console.log(`\n✅ SUCESSO: Fluxo processado.`);
    console.log(`   Criadas: ${created} | Atualizadas: ${updated} | Puladas: ${skipped}\n`);

} catch (e) {
    console.error(`\n❌ ERRO FATAL: ${e.message}`);
    process.exit(1);
}