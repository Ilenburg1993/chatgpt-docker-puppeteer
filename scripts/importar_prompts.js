/* scripts/importar_prompts.js (Audit Level 14 - Industrial Bulk Import) */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const QUEUE_DIR = path.join(ROOT, 'fila');
const SOURCE_FILE = process.argv[2] || path.join(ROOT, 'prompts.txt');

// --- HELPERS DE ROBUSTEZ ---

function sanitizePrompt(text) {
  if (!text || typeof text !== 'string') return "";
  // Remove caracteres de controle ASCII que podem confundir o Puppeteer
  return text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '').trim();
}

function atomicWrite(filepath, content) {
  const tmp = filepath + '.tmp.' + Date.now();
  fs.writeFileSync(tmp, content, 'utf-8');
  fs.renameSync(tmp, filepath);
}

// --- INICIALIZAÇÃO ---

if (!fs.existsSync(QUEUE_DIR)) fs.mkdirSync(QUEUE_DIR, { recursive: true });

if (!fs.existsSync(SOURCE_FILE)) {
  console.log(`[INFO] Fonte não encontrada. Gerando template em: ${SOURCE_FILE}`);
  fs.writeFileSync(SOURCE_FILE, "Exemplo de prompt simples\n{\"prompt\": \"Exemplo JSONL\", \"prio\": 10}", 'utf-8');
  process.exit(0);
}

// 1. Indexação para Deduplicação (Otimizada)
const existingHashes = new Set();
console.log("🔍 Indexando fila atual para evitar duplicatas...");

fs.readdirSync(QUEUE_DIR).forEach(f => {
    if (!f.endsWith('.json')) return;
    try {
        const content = fs.readFileSync(path.join(QUEUE_DIR, f), 'utf-8');
        const t = JSON.parse(content);
        const p = t.spec?.payload?.user_message || t.prompt || '';
        if (p) existingHashes.add(crypto.createHash('md5').update(p).digest('hex'));
    } catch(e) {}
});

// 2. Leitura com Verificação de Encoding
const rawBuffer = fs.readFileSync(SOURCE_FILE);
let content = rawBuffer.toString('utf-8');

// Detecta se houve falha na decodificação (caracteres de substituição)
if (content.includes('')) {
    console.warn("[AVISO] Detectada provável falha de encoding (ANSI?). Tentando conversão...");
    // Em um sistema real, usaríamos jschardet. Aqui, alertamos o usuário.
    console.error("❌ ERRO: O arquivo deve estar em formato UTF-8. Salve o arquivo corretamente e tente de novo.");
    process.exit(1);
}

const lines = content.split(/\r?\n/).filter(l => l.trim());

console.log(`\n📦 PROCESSANDO LOTE: ${lines.length} itens`);

let imported = 0;
let skipped = 0;
let errors = 0;

lines.forEach((line, idx) => {
    let taskData = {
        user_prompt: "",
        system_prompt: "",
        prio: 5,
        model: "gpt-5",
        target: "chatgpt",
        tags: ["bulk"]
    };

    // Detecção e Parsing de JSONL
    if (line.trim().startsWith('{')) {
        try {
            const json = JSON.parse(line);
            taskData.user_prompt = sanitizePrompt(json.prompt || json.user_message || "");
            taskData.system_prompt = sanitizePrompt(json.system || json.system_message || "");
            taskData.prio = parseInt(json.prio || json.priority) || 5;
            taskData.model = json.model || "gpt-5";
            taskData.target = json.target || "chatgpt";
            if (Array.isArray(json.tags)) taskData.tags.push(...json.tags);
        } catch (e) {
            console.error(`   [!] Linha ${idx+1}: JSON inválido. Pulando.`);
            errors++;
            return;
        }
    } else {
        taskData.user_prompt = sanitizePrompt(line);
    }

    if (!taskData.user_prompt) {
        skipped++;
        return;
    }

    // Deduplicação
    const hash = crypto.createHash('md5').update(taskData.user_prompt).digest('hex');
    if (existingHashes.has(hash)) {
        skipped++;
        return;
    }

    // Criação do Objeto V3
    const id = `TASK-BULK-${Date.now()}-${String(idx).padStart(3,'0')}`;
    const task = {
      meta: {
        id: id,
        version: "3.0",
        created_at: new Date().toISOString(),
        priority: taskData.prio,
        source: "bulk_import",
        tags: [...new Set(taskData.tags)]
      },
      spec: {
        target: taskData.target,
        model: taskData.model,
        payload: {
          system_message: taskData.system_prompt,
          user_message: taskData.user_prompt
        },
        config: { reset_context: false }
      },
      policy: { max_attempts: 3, timeout_ms: "auto", dependencies: [] },
      state: { status: "PENDING", attempts: 0, history: [] }
    };

    try {
        atomicWrite(path.join(QUEUE_DIR, `${id}.json`), JSON.stringify(task, null, 2));
        existingHashes.add(hash);
        imported++;
        if (imported % 10 === 0) process.stdout.write(".");
    } catch (e) {
        errors++;
    }
});

console.log(`\n\n✅ RELATÓRIO FINAL:`);
console.log(`   - Importadas:  ${imported}`);
console.log(`   - Duplicadas:  ${skipped}`);
console.log(`   - Erros:       ${errors}`);
if (imported > 0) console.log(`\n[DICA] O Agente processará estas tarefas na ordem de prioridade.`);