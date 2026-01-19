/* scripts/gerador_tarefa.js (Audit Level 15 - Power CLI) */
// Responsabilidade: Interface de linha de comando para criação de tarefas robustas.
// Recursos: Modo Interativo, Templates, Escrita Atômica, Multi-Target.

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const QUEUE_DIR = path.join(ROOT, 'fila');
const TEMPLATE_DIR = path.join(ROOT, 'templates');

// --- HELPERS DE INFRAESTRUTURA ---

function atomicWrite(filepath, content) {
    const tmp = filepath + '.tmp.' + crypto.randomBytes(4).toString('hex');
    fs.writeFileSync(tmp, content, 'utf-8');
    fs.renameSync(tmp, filepath);
}

function generateUniqueId(prefix = 'TASK-CLI') {
    const ts = Date.now();
    const salt = crypto.randomBytes(3).toString('hex');
    return `${prefix}-${ts}-${salt}`;
}

// Garante infra
[QUEUE_DIR, TEMPLATE_DIR].forEach(d => { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); });

// --- CONFIGURAÇÃO DE MODELOS ---
const VALID_TARGETS = ['chatgpt', 'gemini', 'claude', 'perplexity'];
const VALID_MODELS = ['gpt-5', 'gpt-4o', 'o1-preview', 'gemini-1.5-pro', 'claude-3-opus'];

// --- PARSER DE ARGUMENTOS ---
function parseArgs(args) {
    const options = {
        prio: 5,
        model: 'gpt-5',
        target: 'chatgpt',
        system: '',
        tags: [],
        prompt: [],
        template: null,
        after: null,
        interactive: args.length === 0
    };

    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (arg === '--prio') options.prio = parseInt(args[++i], 10) || 5;
        else if (arg === '--model') options.model = args[++i];
        else if (arg === '--target') options.target = args[++i];
        else if (arg === '--system') options.system = args[++i];
        else if (arg === '--template') options.template = args[++i];
        else if (arg === '--after') options.after = args[++i];
        else if (arg === '--tags') options.tags = (args[++i] || '').split(',').map(t => t.trim()).filter(t => t);
        else if (arg.startsWith('--')) { /* ignora flags desconhecidas */ }
        else options.prompt.push(arg);
    }
    return options;
}

// --- HELPER DE AGENDAMENTO ---
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

// --- CORE: CRIAÇÃO DA TAREFA ---
function createTask(opts, promptText) {
    const id = generateUniqueId();
    const executeAfter = parseSchedule(opts.after);

    const task = {
        meta: {
            id: id,
            version: "3.0",
            created_at: new Date().toISOString(),
            priority: Math.max(0, Math.min(100, opts.prio)),
            source: "cli",
            tags: ["manual", ...opts.tags]
        },
        spec: {
            target: opts.target.toLowerCase(),
            model: opts.model,
            payload: {
                system_message: opts.system || "",
                user_message: promptText
            },
            config: { reset_context: false }
        },
        policy: {
            max_attempts: 3,
            timeout_ms: "auto",
            dependencies: [],
            execute_after: executeAfter
        },
        state: { status: "PENDING", attempts: 0, history: [] }
    };

    try {
        const filePath = path.join(QUEUE_DIR, `${id}.json`);
        atomicWrite(filePath, JSON.stringify(task, null, 2));
        
        console.log(`\n✅ TAREFA CRIADA: ${id}`);
        console.log(`   🎯 Alvo:    ${task.spec.target} (${task.spec.model})`);
        console.log(`   ⚖️  Prio:    ${task.meta.priority}`);
        if (executeAfter) console.log(`   ⏱️  Agenda:  ${new Date(executeAfter).toLocaleString()}`);
        console.log(`   📝 Prompt:  "${promptText.slice(0, 50)}..."`);
    } catch (e) {
        console.error(`\n❌ ERRO AO CRIAR TAREFA: ${e.message}`);
    }
}

// --- MODO INTERATIVO (WIZARD) ---
async function runInteractive() {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const ask = (q) => new Promise(r => rl.question(q, r));

    console.log('\n✨ WIZARD DE TAREFA UNIVERSAL (V3)\n');
    
    const prompt = await ask('1. Prompt do Usuário (Instrução): ');
    if (!prompt) { console.log('Cancelado.'); process.exit(0); }

    const system = await ask('2. System Prompt / Persona (Opcional): ');
    
    console.log(`   Disponíveis: [${VALID_TARGETS.join(', ')}]`);
    const target = await ask('3. Alvo (chatgpt): ') || 'chatgpt';
    
    const model = await ask(`4. Modelo (${target === 'chatgpt' ? 'gpt-5' : 'auto'}): `) || (target === 'chatgpt' ? 'gpt-5' : 'default');
    
    const prioInput = await ask('5. Prioridade (1-100, Default 5): ');
    const prio = parseInt(prioInput, 10) || 5;

    const after = await ask('6. Agendar para (ex: 10m, 1h ou data ISO): ');

    createTask({
        prio,
        model,
        target,
        system,
        after,
        tags: []
    }, prompt);

    rl.close();
}

// --- EXECUÇÃO ---
const opts = parseArgs(process.argv.slice(2));

if (opts.interactive) {
    runInteractive();
} else {
    let promptText = opts.prompt.join(' ').trim();

    if (opts.template) {
        const tplPath = path.join(TEMPLATE_DIR, opts.template.endsWith('.txt') ? opts.template : `${opts.template}.txt`);
        if (fs.existsSync(tplPath)) {
            const tplContent = fs.readFileSync(tplPath, 'utf-8');
            promptText = tplContent.replace(/{{INPUT}}/gi, promptText);
        } else {
            console.error(`❌ Template não encontrado: ${tplPath}`);
            process.exit(1);
        }
    }

    if (!promptText) {
        console.error('❌ Erro: Prompt vazio. Use argumentos ou o modo interativo.');
        process.exit(1);
    }

    createTask(opts, promptText);
}