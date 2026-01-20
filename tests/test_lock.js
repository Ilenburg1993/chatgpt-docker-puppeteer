// tests/test_lock.js
// Testa se dois processos respeitam a exclusão mútua.

const { writeTask, readTask, startAgent, stopAgent, waitForCondition, removeRunLock, readLatestGlobalLogTail, sleep } = require('./helpers');

(async () => {
    console.log('\n=== TEST: Lock Atomicidade & Concorrência ===');

    // 1. Limpeza
    removeRunLock();
    const TASK_ID = 'test-lock-atomic';

    // 2. Cria Tarefa
    writeTask({
        id: TASK_ID,
        prompt: 'Teste de Lock Atomicidade',
        status: 'PENDING',
        criadoEm: new Date().toISOString()
    });

    console.log(`> Tarefa criada: ${TASK_ID}`);

    // 3. Inicia 2 Agentes Simultaneamente
    console.log('> Disparando Agente A e Agente B...');
    const agentA = startAgent(15000);
    const agentB = startAgent(15000);

    try {
    // Aguarda prontidão (pode falhar se um deles detectar erro de porta 9222 ocupada, mas o código deve tratar isso)
    // Nota: Puppeteer connect permite múltiplas conexões, então ambos devem subir.
        await Promise.allSettled([agentA.ready, agentB.ready]);
        console.log('> Ambos processos iniciados.');

        // 4. Aguarda processamento
        console.log('> Aguardando processamento da tarefa...');
        const processed = await waitForCondition(() => {
            const t = readTask(TASK_ID);
            return t && t.status !== 'PENDING';
        }, 20000);

        if (!processed) {
            throw new Error('Timeout: Tarefa nunca saiu de PENDING.');
        }

        // 5. Validação
        const finalTask = readTask(TASK_ID);
        const logs = readLatestGlobalLogTail(200);

        const finalStatus = finalTask && finalTask.state ? finalTask.state.status : (finalTask && finalTask.status) || undefined;
        console.log(`> Status Final: ${finalStatus}`);

        // Critério de Sucesso:
        // - Tarefa foi processada (DONE/RUNNING) OU
        // - Um agente detectou conflito e pausou a tarefa (PAUSED)
        // - NÃO pode haver erros de corrupção de arquivo JSON

        const conflictDetected = logs.includes('Conflito de lock') || logs.includes('LOCKED') || logs.includes('RUN_LOCK_ALREADY_EXISTS');

        if (finalStatus === 'RUNNING' || finalStatus === 'DONE') {
            console.log('PASS: Tarefa adquirida e processada com sucesso.');
            if (conflictDetected) {console.log('INFO: Contenção de lock registrada nos logs (Comportamento esperado).');}
        } else if (finalStatus === 'PAUSED' && ((finalTask && (finalTask.erro || finalTask.error)) || '').includes('Conflito')) {
            console.log('PASS: Tarefa pausada corretamente devido a conflito de lock.');
        } else {
            const finalErr = finalTask && (finalTask.erro || finalTask.error || (finalTask.state && finalTask.state.erro) || (finalTask.state && finalTask.state.error));
            throw new Error(`Estado inválido: ${finalStatus}. Erro: ${finalErr}`);
        }

    } catch (e) {
        console.error('FAIL:', e.message);
        console.error('--- LOGS RECENTES ---');
        console.error(readLatestGlobalLogTail(50));
        process.exit(1);
    } finally {
        stopAgent(agentA.proc);
        stopAgent(agentB.proc);
        removeRunLock(); // Limpa para não afetar próximos testes
    }
})();
