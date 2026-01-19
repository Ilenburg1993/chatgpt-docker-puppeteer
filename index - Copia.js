/* ==========================================================================
   INDEX.JS — MAESTRO BOOTSTRAPPER (V360)
   Audit Level: 740 — Sovereign Wiring Authority (Singularity Edition)
   Status: CONSOLIDATED (Protocol 11 - Zero-Bug Tolerance)
   Responsabilidade: Orquestrar o nascimento da identidade, a carga reativa de 
                     configuração, a ignição do Kernel V1.6.0 e a fiação IPC 2.0.
   Sincronizado com: execution_engine.js V1.6.0, config.js V740, 
                     ipc_client.js V600, io.js V730.
========================================================================== */

const { log } = require('./src/core/logger');
const CONFIG = require('./src/core/config');
const { IPCCommand, IPCEvent } = require('./src/shared/ipc/constants');

// Kernel & Policies (O Cérebro)
const ExecutionEngine = require('./src/core/execution_engine');
const EnvironmentResolver = require('./src/core/environment_resolver');
const InfraFailurePolicy = require('./src/core/infra_failure_policy');
const identityManager = require('./src/core/identity_manager');

// Infraestrutura (Os Nervos e Persistência)
const io = require('./src/infra/io');
const ipc = require('./src/infra/ipc_client');
const { ConnectionOrchestrator } = require('./src/infra/connection_orchestrator');

/* ==========================================================================
   MAIN SEQUENCE (A IGNIÇÃO)
========================================================================== */

async function main() {
    // NASA Standard: Verificação de runtime para otimização de memória
    if (!global.gc) log('WARN', '[BOOT] Garbage Collection manual indisponível (Flag --expose-gc ausente).');
    
    log('INFO', '🚀 Maestro V360 Online (Singularity Edition - Phase 7)');
    
    try {
        // 1. HIGIENE FÍSICA E CARGA PARAMÉTRICA INICIAL
        // Limpa arquivos temporários órfãos e popula o cache de definições
        const cleanedCount = await io.cleanupOrphans();
        if (cleanedCount > 0) log('INFO', `[BOOT] Higiene: ${cleanedCount} arquivos .tmp removidos.`);
        
        // Carga assíncrona do config.json (Audit 740)
        await CONFIG.reload('sys-boot');
        log('DEBUG', '[BOOT] Configurações mestras sincronizadas.');

        // Limpeza preventiva da RAM após carga de módulos e I/O inicial
        if (global.gc) global.gc();

        // 2. IDENTIDADE SOBERANA (DNA & Vida)
        // Garante que o robô tenha um rosto (robot_id) antes de se apresentar ao servidor
        await identityManager.initialize();
        const identity = identityManager.getFullIdentity();
        log('INFO', `[BOOT] Identidade Consolidada: ${identity.robot_id} (Instance: ${identity.instance_id})`);

        // 3. MONTAGEM DO KERNEL (Injeção de Dependências)
        // O orquestrador recebe o snapshot atual da configuração
        const orchestrator = new ConnectionOrchestrator(CONFIG.all);
        const envResolver = new EnvironmentResolver();
        const infraPolicy = new InfraFailurePolicy();

        const engine = new ExecutionEngine({ 
            orchestrator,
            environmentResolver: envResolver,
            infraFailurePolicy: infraPolicy
        });

        // 4. WIRING IPC 2.0 (Conexão Comando -> Ação)
        // O connect() realiza a descoberta automática via estado.json
        await ipc.connect();
        
        // --- [CRÍTICO] Fiação de Comandos Remotos (Soberania do Dashboard) ---
        ipc.on(IPCCommand.ENGINE_PAUSE, () => engine.pause());
        ipc.on(IPCCommand.ENGINE_RESUME, () => engine.resume());
        ipc.on(IPCCommand.ENGINE_STOP, () => global.gracefulShutdown('REMOTE_STOP_SIGNAL'));
        
        // Conecta o aborto remoto diretamente ao método de interrupção do motor
        ipc.on(IPCCommand.TASK_ABORT, (payload) => {
            if (payload?.taskId) {
                engine.abortTask(payload.taskId);
            }
        });

        // --- [REATIVO] Sincronia de Dados e Hot-Reload ---
        ipc.on('cache_dirty', async () => {
            log('DEBUG', '[IPC] Sinal de inconsistência recebido. Recarregando caches...');
            
            // Invalida cache de fila (disco)
            if (io.setCacheDirty) io.setCacheDirty();
            
            // Invalida cache de parâmetros (RAM) - Hot-Reload V2
            await CONFIG.reload('ipc-signal');
        });

        ipc.on('reconnect', async ({ attempts }) => {
            log('INFO', `[IPC] Sincronia reestabelecida (${attempts}x). Forçando atualização.`);
            if (io.setCacheDirty) io.setCacheDirty();
            await CONFIG.reload('ipc-reconnect');
        });

        // 5. GOVERNANÇA DE CICLO DE VIDA (Graceful Shutdown)
        global.gracefulShutdown = async (signal) => {
            log('WARN', `[BOOT] Sinal ${signal} detectado. Iniciando encerramento atômico...`);
            
            try {
                // Interrompe o motor e libera locks físicos imediatamente
                if (engine) await engine.stop();
                
                // Notifica o Mission Control e fecha o socket de forma limpa
                if (ipc.isConnected()) {
                    ipc.emitEvent(IPCEvent.AGENT_HEARTBEAT, { status: 'SHUTTING_DOWN' });
                    await ipc.disconnect();
                }
            } catch (e) {
                log('ERROR', `[BOOT] Erro durante sequência de paragem: ${e.message}`);
            } finally {
                log('INFO', '[BOOT] Maestro encerrado.');
                process.exit(0);
            }
        };

        // Registro de sinais do SO
        process.on('SIGINT', () => global.gracefulShutdown('SIGINT'));
        process.on('SIGTERM', () => global.gracefulShutdown('SIGTERM'));

        // Tratamento de falhas catastróficas
        process.on('uncaughtException', async (err) => {
            log('FATAL', `[BOOT] COLAPSO (Uncaught): ${err.message}\n${err.stack}`);
            if (engine) await engine.stop();
            process.exit(1);
        });

        // 6. IGNIÇÃO DO MOTOR V1.6.0
        await engine.start();

    } catch (fatalErr) {
        log('FATAL', `[BOOT] Falha catastrófica na sequência de ignição: ${fatalErr.message}`);
        process.exit(1);
    }
}

main();