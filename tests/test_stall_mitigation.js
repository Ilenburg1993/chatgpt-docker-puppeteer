/* tests/test_stall_mitigation.js (V3 Compliant) */
const puppeteer = require('puppeteer-core'); // Usa core para conectar no local
const { writeTask, startAgent, stopAgent, readLatestGlobalLogTail, waitForCondition, sleep } = require('./helpers');

(async () => {
  console.log('\n=== TEST: Stall Mitigation (Watchdog V4) ===');
  
  const TASK_ID = 'test-stall-001';
  writeTask({
    id: TASK_ID,
    prompt: 'Teste de Stall Simulado',
    status: 'PENDING'
  });

  const agent = startAgent();
  
  try {
    await agent.ready;
    console.log('> Agente online.');

    // Conecta ao browser para sabotagem
    const browser = await puppeteer.connect({ browserURL: 'http://localhost:9222' });
    const pages = await browser.pages();
    const page = pages.find(p => p.url().includes('chatgpt.com'));

    if (!page) throw new Error('Aba ChatGPT não encontrada.');

    // Espera o agente começar a processar
    await sleep(8000);

    console.log('> Injetando sabotagem temporal...');
    await page.evaluate(() => {
      // Sabota as variáveis exatas que o src/driver/browser.js usa
      // window.__wd_last_change é a chave do novo driver
      window.__wd_last_change = Date.now() - 300000; // 5 minutos atrás
      
      // Garante que o observer existe para não ser recriado imediatamente
      if (!window.__wd_obs) window.__wd_obs = true; 
    });

    console.log('> Aguardando reação do Triage...');
    const mitigated = await waitForCondition(() => {
      const logs = readLatestGlobalLogTail(100);
      // Procura por logs do Triage ou do Browser
      return logs.includes('Stall detectado') || logs.includes('Diagnóstico') || logs.includes('FATAL_STALL');
    }, 45000);

    if (mitigated) {
      console.log('PASS: O sistema detectou o stall artificial.');
    } else {
      throw new Error('FAIL: Agente ignorou o stall injetado.');
    }

    browser.disconnect();

  } catch (e) {
    console.error('FAIL:', e.message);
    console.error('Logs:', readLatestGlobalLogTail(30));
    process.exit(1);
  } finally {
    stopAgent(agent.proc);
  }
})();