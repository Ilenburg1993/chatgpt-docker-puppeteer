/* tests/test_running_recovery.js (V3 Compliant) */
const { writeTask, readTask, startAgent, stopAgent, waitForCondition, removeRunLock } = require('./helpers');

(async () => {
  console.log('\n=== TEST: Recovery de Zumbis (Schema V3) ===');
  removeRunLock();

  const TASK_ID = 'test-zombie-v3';
  const twoHoursAgo = new Date(Date.now() - 7200000).toISOString();
  
  // Cria tarefa V3 já em estado RUNNING antigo
  writeTask({
    id: TASK_ID,
    prompt: 'Zombie task',
    status: 'RUNNING',
    startedEm: twoHoursAgo // O helper coloca isso em state.started_at
  });
  
  const agent = startAgent();

  try {
    await agent.ready;
    
    const recovered = await waitForCondition(() => {
      const t = readTask(TASK_ID);
      // Verifica no local correto do Schema V3
      return t.state.status === 'FAILED';
    }, 15000);

    if (recovered) {
      const t = readTask(TASK_ID);
      if ((t.erro || '').includes('Zombie') || (t.state.history && JSON.stringify(t.state.history).includes('Zombie'))) {
        console.log('PASS: Zumbi V3 eliminado.');
      } else {
        console.log(`PASS: Recuperado (Erro: ${t.erro})`);
      }
    } else {
      throw new Error('Timeout: Zumbi sobreviveu.');
    }

  } catch (e) {
    console.error('FAIL:', e.message);
    process.exit(1);
  } finally {
    stopAgent(agent.proc);
  }
})();