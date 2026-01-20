// tests/test_control_pause.js
// Verifica obediência aos estados PAUSED e RUN do controle.json

const fs = require('fs');
const path = require('path');
const { writeTask, readTask, startAgent, stopAgent, waitForCondition, sleep, ROOT } = require('./helpers');

(async () => {
  console.log('\n=== TEST: Controle de Pausa Dinâmica ===');
  const CONTROL = path.join(ROOT, 'controle.json');
  const TASK_ID = 'test-pause-check';

  // 1. Inicia em PAUSED
  fs.writeFileSync(CONTROL, JSON.stringify({ estado: 'PAUSED' }, null, 2));
  console.log('> Controle definido para PAUSED.');

  writeTask({
    id: TASK_ID,
    prompt: 'Esta tarefa deve esperar',
    status: 'PENDING',
    criadoEm: new Date().toISOString()
  });

  const agent = startAgent();
  
  try {
    await agent.ready;
    console.log('> Agente online. Aguardando 5s para verificar inatividade...');
    
    // Aguarda tempo suficiente para o agente ter pego a tarefa se estivesse bugado
    await sleep(5000);
    
    let t = readTask(TASK_ID);
    if (t.status !== 'PENDING') {
      throw new Error(`Falha: Agente processou a tarefa em modo PAUSED. Status: ${t.status}`);
    }
    console.log('> OK: Tarefa continua PENDING.');

    // 2. Muda para RUN
    console.log('> Alterando controle para RUN...');
    fs.writeFileSync(CONTROL, JSON.stringify({ estado: 'RUN' }, null, 2));

    const processed = await waitForCondition(() => {
      t = readTask(TASK_ID);
      return t.status === 'RUNNING' || t.status === 'DONE' || t.status === 'FAILED';
    }, 20000);

    if (processed) {
      console.log(`PASS: Agente retomou o trabalho. Status atual: ${t.status}`);
    } else {
      throw new Error('Timeout: Agente não acordou após RUN.');
    }

  } catch (e) {
    console.error('FAIL:', e.message);
    process.exit(1);
  } finally {
    stopAgent(agent.proc);
    // Restaura para RUN para não travar uso futuro
    try { fs.writeFileSync(CONTROL, JSON.stringify({ estado: 'RUN' }, null, 2)); } catch(e){}
  }
})();