import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import crypto from 'node:crypto';

const ROOT = path.resolve(import.meta.dirname, '..');
const QUEUE_DIR = path.join(ROOT, 'fila');
const TEMPLATE_DIR = path.join(ROOT, 'templates');

// --- HELPERS DE INFRAESTRUTURA ---

/**
 * Grava conteúdo em um arquivo de forma atômica, evitando corrupção parcial.
 * Side-effects: Cria arquivo temporário e renomeia para o destino final.
 * @param {string} filepath - Caminho do arquivo de destino.
 * @param {string} content - Conteúdo a ser gravado.
 */
function atomicWrite(filepath, content) {
    const tmp = `${filepath}.tmp.${crypto.randomBytes(4).toString('hex')}`;
    fs.writeFileSync(tmp, content, 'utf-8');
    fs.renameSync(tmp, filepath);
}

/**
 * Gera um ID único para identificação de tarefas.
 * @param {string} [prefix='TASK-CLI'] - Prefixo para o ID gerado.
 * @returns {string} ID único no formato "prefix-timestamp-salt".
 */
function generateUniqueId(prefix = 'TASK-CLI') {
    const ts = Date.now();
    const salt = crypto.randomBytes(3).toString('hex');
    return `${prefix}-${ts}-${salt}`;
}

// Garante infra
[QUEUE_DIR, TEMPLATE_DIR].forEach(d => {
    if (!fs.existsSync(d)) {
        fs.mkdirSync(d, { recursive: true });
    }
});

// --- CONFIGURAÇÃO DE MODELOS ---
const VALID_TARGETS = ['chatgpt', 'gemini', 'claude', 'perplexity'];
const _VALID_MODELS = ['gpt-5', 'gpt-4o', 'o1-preview', 'gemini-1.5-pro', 'claude-3-opus'];

/**
 * Parseia argumentos da linha de comando para opções de criação de tarefa.
 * @param {string[]} args - Array de argumentos da linha de comando.
 * @returns {Object} Opções parseadas com valores padrão.
 * @property {number} prio - Prioridade da tarefa (0-100).
 * @property {string} model - Modelo de IA a ser utilizado.
 * @property {string} target - Plataforma alvo (chatgpt, gemini, etc).
 * @property {string} system - Mensagem do sistema/persona.
 * @property {string[]} tags - Tags para categorização.
 * @property {string[]} prompt - Parte do prompt que não são argumentos.
 * @property {string|null} template - Nome do template a ser usado.
 * @property {string|null} after - Data/agendamento para execução.
 * @property {boolean} interactive - Modo interativo ativado.
 */
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
        interactive: args.length === 0,
    };

    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (arg === '--prio') {
            options.prio = parseInt(args[++i], 10) || 5;
        } else if (arg === '--model') {
            options.model = args[++i];
        } else if (arg === '--target') {
            options.target = args[++i];
        } else if (arg === '--system') {
            options.system = args[++i];
        } else if (arg === '--template') {
            options.template = args[++i];
        } else if (arg === '--after') {
            options.after = args[++i];
        } else if (arg === '--tags') {
            options.tags = (args[++i] || '')
                .split(',')
                .map(t => t.trim())
                .filter(t => t);
        } else if (arg.startsWith('--')) {
            /* ignora flags desconhecidas */
        } else {
            options.prompt.push(arg);
        }
    }
    return options;
}

/**
 * Parseia uma string de agendamento para uma data ISO.
 * Suporta formatos como "10m" (10 minutos), "1h" (1 hora) ou datas ISO.
 * @param {string|null} input - String de agendamento ou null.
 * @returns {string|null} Data ISO se válida, null se inválida.
 */
function parseSchedule(input) {
    if (!input) {
        return null;
    }
    const match = input.match(/^(\d+)([mh])$/);
    if (match) {
        const val = parseInt(match[1], 10);
        const unit = match[2];
        return new Date(Date.now() + val * (unit === 'm' ? 60000 : 3600000)).toISOString();
    }
    const date = new Date(input);
    return !isNaN(date.getTime()) ? date.toISOString() : null;
}

/**
 * Cria uma nova tarefa e a salva no diretório de fila.
 * Side-effects: Cria arquivo JSON no diretório de fila, imprime informações no console.
 * @param {Object} opts - Opções da tarefa.
 * @param {number} opts.prio - Prioridade da tarefa (0-100).
 * @param {string} opts.model - Modelo de IA a ser utilizado.
 * @param {string} opts.target - Plataforma alvo (chatgpt, gemini, etc).
 * @param {string} opts.system - Mensagem do sistema/persona.
 * @param {string} opts.after - Data/agendamento para execução.
 * @param {string[]} opts.tags - Tags para categorização.
 * @param {string} promptText - Texto do prompt do usuário.
 */
function createTask(opts, promptText) {
    const id = generateUniqueId();
    const executeAfter = parseSchedule(opts.after);

    const task = {
        meta: {
            id: id,
            version: '3.0',
            created_at: new Date().toISOString(),
            priority: Math.max(0, Math.min(100, opts.prio)),
            source: 'cli',
            tags: ['manual', ...opts.tags],
        },
        spec: {
            target: opts.target.toLowerCase(),
            model: opts.model,
            payload: {
                system_message: opts.system || '',
                user_message: promptText,
            },
            config: { reset_context: false },
        },
        policy: {
            max_attempts: 3,
            timeout_ms: 'auto',
            dependencies: [],
            execute_after: executeAfter,
        },
        state: { status: 'PENDING', attempts: 0, history: [] },
    };

    try {
        const filePath = path.join(QUEUE_DIR, `${id}.json`);
        atomicWrite(filePath, JSON.stringify(task, null, 2));

        console.log(`\n✅ TAREFA CRIADA: ${id}`);
        console.log(`   🎯 Alvo:    ${task.spec.target} (${task.spec.model})`);
        console.log(`   ⚖️  Prio:    ${task.meta.priority}`);
        if (executeAfter) {
            console.log(`   ⏱️  Agenda:  ${new Date(executeAfter).toLocaleString()}`);
        }
        console.log(`   📝 Prompt:  "${promptText.slice(0, 50)}..."`);
    } catch (e) {
        console.error(`\n❌ ERRO AO CRIAR TAREFA: ${e.message}`);
    }
}

/**
 * Executa o modo interativo (wizard) para criação de tarefas.
 * Solicita informações ao usuário e cria uma tarefa com base nas entradas.
 * Side-effects: Lê entrada do usuário via stdin, cria tarefa, pode encerrar o processo.
 * @returns {Promise<void>} Promessa que resolve quando o wizard é concluído.
 */
async function runInteractive() {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const ask = q =>
        new Promise(r => {
            rl.question(q, r);
        });

    console.log('\n✨ WIZARD DE TAREFA UNIVERSAL (V3)\n');

    const prompt = await ask('1. Prompt do Usuário (Instrução): ');
    if (!prompt) {
        console.log('Cancelado.');
        process.exit(0);
    }

    const system = await ask('2. System Prompt / Persona (Opcional): ');

    console.log(`   Disponíveis: [${VALID_TARGETS.join(', ')}]`);
    const target = (await ask('3. Alvo (chatgpt): ')) || 'chatgpt';

    const model =
        (await ask(`4. Modelo (${target === 'chatgpt' ? 'gpt-5' : 'auto'}): `)) ||
        (target === 'chatgpt' ? 'gpt-5' : 'default');

    const prioInput = await ask('5. Prioridade (1-100, Default 5): ');
    const prio = parseInt(prioInput, 10) || 5;

    const after = await ask('6. Agendar para (ex: 10m, 1h ou data ISO): ');

    createTask(
        {
            prio,
            model,
            target,
            system,
            after,
            tags: [],
        },
        prompt
    );

    rl.close();
}

/**
 * Função principal que executa o script de acordo com os argumentos fornecidos.
 * Pode rodar em modo interativo ou com argumentos da linha de comando.
 * Side-effects: Lê argumentos, pode ler templates, cria tarefas, pode encerrar o processo.
 */
function main() {
    const opts = parseArgs(process.argv.slice(2));

    if (opts.interactive) {
        runInteractive();
    } else {
        let promptText = opts.prompt.join(' ').trim();

        if (opts.template) {
            const tplPath = path.join(
                TEMPLATE_DIR,
                opts.template.endsWith('.txt') ? opts.template : `${opts.template}.txt`
            );
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
}

// --- EXECUÇÃO ---
main();
