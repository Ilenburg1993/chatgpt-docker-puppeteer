/* tests/test_schema_validation.js (Audit Level 15 - Deep Validation) */
const { startAgent, stopAgent, waitForCondition, removeRunLock, cleanTmp } = require('./helpers');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const QUEUE_DIR = path.join(ROOT, 'fila');
const CORRUPT_DIR = path.join(QUEUE_DIR, 'corrupted');

// Helper para injetar arquivos brutos ignorando o gerador oficial
function injectRaw(filename, content) {
    fs.writeFileSync(path.join(QUEUE_DIR, filename), 
        typeof content === 'string' ? content : JSON.stringify(content, null, 2));
}

async function runTest() {
  console.log('\n=== [INICIANDO SUÍTE DE VALIDAÇÃO DE DADOS] ===');
  removeRunLock();
  cleanTmp();
  
  // Limpa quarentena anterior
  if (fs.existsSync(CORRUPT_DIR)) {
      fs.readdirSync(CORRUPT_DIR).forEach(f => fs.unlinkSync(path.join(CORRUPT_DIR, f)));
  } else {
      fs.mkdirSync(CORRUPT_DIR, { recursive: true });
  }

  // --- PREPARAÇÃO DOS CASOS DE TESTE ---

  // Caso 1: JSON com Sintaxe Quebrada (Faltando fechar chaves)
  const ID_CORRUPT = 'TEST-ERR-SINTAXE';
  injectRaw(`${ID_CORRUPT}.json`, `{ "id": "${ID_CORRUPT}", "status": "incomplete" `);

  // Caso 2: Schema V2 legado (Deve ser aceito e convertido pelo adaptador)
  const ID_LEGACY = 'TEST-OK-LEGADO';
  injectRaw(`${ID_LEGACY}.json`, { id: ID_LEGACY, prompt: "Prompt Legado", status: "PENDING" });

  // Caso 3: Tipo de Dado Errado (Priority como String em vez de Number)
  const ID_TYPE = 'TEST-ERR-TYPE';
  injectRaw(`${ID_TYPE}.json`, {
      meta: { id: ID_TYPE, created_at: new Date().toISOString(), priority: "MUITO_ALTA" },
      spec: { payload: { user_message: "Erro de Tipo" } },
      state: { status: "PENDING" }
  });

  // Caso 4: Valor de Enum Inválido (Target inexistente)
  const ID_ENUM = 'TEST-ERR-ENUM';
  injectRaw(`${ID_ENUM}.json`, {
      meta: { id: ID_ENUM, created_at: new Date().toISOString() },
      spec: { target: "IA-DA-NASA", payload: { user_message: "Erro de Enum" } },
      state: { status: "PENDING" }
  });

  console.log(`> Injetados: 1 Corrompido, 1 Legado (OK), 2 Inválidos.`);

  // --- EXECUÇÃO ---
  const agent = startAgent();
  await agent.ready;
  console.log(`> Agente Online. Monitorando reações...\n`);

  // --- VERIFICAÇÕES ---

  // 1. Check Quarentena (Sintaxe)
  const checkQuarantine = await waitForCondition(() => {
    const files = fs.readdirSync(CORRUPT_DIR);
    return files.some(f => f.includes(ID_CORRUPT) && f.endsWith('.bad'));
  }, 8000);
  console.log(checkQuarantine ? '  [PASS] Quarentena: Arquivo malformado isolado como .bad' : '  [FAIL] Quarentena: Arquivo malformado não isolado');

  // 2. Check Adaptador Legado
  const checkLegacy = await waitForCondition(() => {
    try {
        const t = JSON.parse(fs.readFileSync(path.join(QUEUE_DIR, `${ID_LEGACY}.json`), 'utf-8'));
        // O index deve ter pego, convertido e começado a rodar ou falhado (mas não ignorado)
        return t.state && t.state.status !== 'PENDING';
    } catch { return false; }
  }, 8000);
  console.log(checkLegacy ? '  [PASS] Adaptador: Tarefa V2 convertida para V3' : '  [FAIL] Adaptador: Tarefa V2 ignorada ou crashou');

  // 3. Check Rejeição de Tipo
  const checkType = await waitForCondition(() => {
    try {
        const t = JSON.parse(fs.readFileSync(path.join(QUEUE_DIR, `${ID_TYPE}.json`), 'utf-8'));
        return t.state.status === 'FAILED' && JSON.stringify(t).includes('priority');
    } catch { return false; }
  }, 8000);
  console.log(checkType ? '  [PASS] Validação: Erro de tipo (Number) detectado' : '  [FAIL] Validação: Erro de tipo ignorado');

  // 4. Check Rejeição de Enum
  const checkEnum = await waitForCondition(() => {
    try {
        const t = JSON.parse(fs.readFileSync(path.join(QUEUE_DIR, `${ID_ENUM}.json`), 'utf-8'));
        return t.state.status === 'FAILED' && JSON.stringify(t).includes('target');
    } catch { return false; }
  }, 8000);
  console.log(checkEnum ? '  [PASS] Validação: Erro de enum (Target) detectado' : '  [FAIL] Validação: Erro de enum ignorado');

  // --- CONCLUSÃO ---
  const success = checkQuarantine && checkLegacy && checkType && checkEnum;
  
  stopAgent(agent.proc);

  if (success) {
      console.log('\n✅ SUCESSO: Todas as funções básicas e intermediárias de integridade estão perfeitas.');
      process.exit(0);
  } else {
      console.error('\n❌ FALHA: Uma ou mais proteções de integridade falharam.');
      process.exit(1);
  }
}

runTest().catch(e => {
  console.error('Erro fatal no teste:', e);
  process.exit(1);
});