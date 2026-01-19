/* ==========================================================================
   INDEX.JS — MAESTRO BOOTSTRAPPER (Protocol 11)
   Audit Level: 950 — Sovereign Wiring Authority
   Status: RECONSTRUCTED
   Responsabilidade: 
     - Orquestrar a injeção de dependência dos subsistemas (NERV + KERNEL).
     - Gerenciar o ciclo de vida do processo (Boot & Shutdown).
     - Garantir que o Cérebro (Kernel) e o Corpo (Effectors) estejam ligados.
========================================================================== */

require('dotenv').config(); // Carrega variáveis de ambiente (.env)

// 1. Configurações e Logs Legados (Mantidos para compatibilidade)
const { log } = require('./src/core/logger');
const CONFIG = require('./src/core/config');

// 2. Infraestrutura Física (Legado Adaptado)
// Precisamos do IO para ler a identidade antes de ligar o NERV
const io = require('./src/infra/io'); 

// 3. Os Novos Subsistemas (Protocol 11)
const createNerv = require('./src/nerv/core');
const createSocketAdapter = require('./src/infra/transport/socket_io_adapter');
const SovereignKernel = require('./src/kernel/core');
const IOEffector = require('./src/effectors/io_effector');
const TaskEffector = require('./src/effectors/task_effector');

// Variáveis globais para Shutdown Limpo
let nerv = null;
let kernel = null;

async function bootstrap() {
    log('INFO', '=================================================');
    log('INFO', '   MAESTRO PROTOCOL 11 — SINGULARITY BOOTSTRAP   ');
    log('INFO', '=================================================');

    try {
        // ----------------------------------------------------------------------
        // PASSO 1: IDENTIDADE SOBERANA
        // ----------------------------------------------------------------------
        log('INFO', '[BOOT] Carregando Identidade Soberana...');
        
        // Usa o infra/io legado para garantir que pegamos o mesmo ID de sempre
        let identity = await io.getIdentity();
        
        if (!identity || !identity.robot_id) {
            log('WARN', '[BOOT] Identidade não encontrada. Gerando nova identidade efêmera...');
            // Fallback simples se o arquivo não existir (ou usamos o identity_manager antigo)
            const { v4: uuidv4 } = require('uuid');
            identity = { robot_id: uuidv4(), created_at: Date.now() };
            await io.saveIdentity(identity);
        }
        
        log('INFO', `[BOOT] Identidade carregada: ${identity.robot_id}`);

        // ----------------------------------------------------------------------
        // PASSO 2: O SISTEMA NERVOSO (NERV)
        // ----------------------------------------------------------------------
        log('INFO', '[BOOT] Inicializando NERV e Transporte...');

        const socketAdapter = createSocketAdapter({
            // Usa a URL do config legado ou fallback para localhost
            url: CONFIG.SERVER_URL || 'http://localhost:3000',
            options: {
                query: { 
                    robot_id: identity.robot_id,
                    protocol: '2.0.0'
                }
            }
        });

        nerv = createNerv({
            connection: socketAdapter,
            identity: identity
        });

        // Conecta o log do NERV ao logger principal do sistema
        nerv.telemetry.on('nerv:log', (data) => {
            // Mapeia níveis do NERV para o logger legado
            const level = data.level === 'WARN' ? 'WARN' : 'INFO';
            log(level, `[NERV] ${data.msg}`);
        });

        nerv.telemetry.on('nerv:error', (err) => {
            log('ERROR', `[NERV] Erro de Transporte: ${err.msg || err.message}`);
        });

        // ----------------------------------------------------------------------
        // PASSO 3: OS MÚSCULOS (EFETORES)
        // ----------------------------------------------------------------------
        log('INFO', '[BOOT] Inicializando Efetores...');

        const ioEffector = new IOEffector(CONFIG);
        
        // O TaskEffector precisa de uma via para enviar observações ao Kernel
        // Como o Kernel ainda não foi instanciado, criamos um proxy ou passamos 
        // a função na instanciação do Kernel depois?
        // SOLUÇÃO: Instanciamos o Kernel primeiro ou usamos injeção tardia?
        // Vamos instanciar os efetores, e no callback injetamos no Kernel.
        
        const taskEffector = new TaskEffector({
            nerv: nerv,
            config: CONFIG,
            onObservation: (observation) => {
                // Ponte Crítica: Quando o Driver vê algo, o Kernel ingere.
                if (kernel) {
                    // Acessamos o método privado _ingest (ou criamos um público receiveObservation)
                    // Como JS permite acesso, usaremos _ingest para manter performance,
                    // assumindo que somos "friends" na arquitetura.
                    kernel._ingest(createEnvelopeFromObservation(observation));
                }
            }
        });

        // Helper para converter a observação crua do TaskEffector de volta num formato
        // que o Kernel aceite (se ele esperar Envelope) ou chamamos add direto.
        // O Kernel.core.js espera Envelopes no _ingest ou Observações no observations.add?
        // O Kernel._ingest recebe envelope. O kernel.observations.add recebe observação.
        // Vamos injetar direto na memória sensorial para menor latência.
        const injectSensorData = (obs) => {
            if (kernel) kernel.observations.add(obs);
        };

        // Atualizamos o callback do TaskEffector para usar o injetor direto
        taskEffector.emitObservation = injectSensorData;

        // ----------------------------------------------------------------------
        // PASSO 4: O CÉREBRO (KERNEL)
        // ----------------------------------------------------------------------
        log('INFO', '[BOOT] Inicializando Kernel Soberano...');

        kernel = new SovereignKernel({
            nerv: nerv,
            effectors: {
                io: ioEffector,
                task: taskEffector
            },
            config: CONFIG
        });

        // Escuta eventos vitais do Kernel
        kernel.on('kernel:boot:complete', () => log('INFO', '[KERNEL] Cérebro online e aguardando comandos.'));
        kernel.on('kernel:shutdown', () => log('INFO', '[KERNEL] Processo cognitivo encerrado.'));

        // ----------------------------------------------------------------------
        // PASSO 5: IGNIÇÃO
        // ----------------------------------------------------------------------
        
        // 1. Liga o Cérebro (Loop Cognitivo)
        await kernel.boot();

        // 2. Conecta o Sistema Nervoso (Inicia Handshake com Servidor)
        nerv.connect();

        log('INFO', '[BOOT] Sistema Maestro Operacional. (Protocol 11)');

    } catch (err) {
        log('FATAL', `[BOOT] Falha Catastrófica na Inicialização: ${err.message}`);
        console.error(err);
        process.exit(1);
    }
}

/* ==========================================================================
   ENCERRAMENTO GRACIOSO (GRACEFUL SHUTDOWN)
========================================================================== */
async function gracefulShutdown(signal) {
    console.log(`\n[BOOT] Sinal ${signal} recebido. Iniciando desligamento...`);
    
    try {
        if (nerv) {
            console.log('[BOOT] Desconectando NERV...');
            nerv.disconnect();
        }

        if (kernel) {
            console.log('[BOOT] Desligando Kernel...');
            await kernel.shutdown();
        }

        console.log('[BOOT] Shutdown completo. Bye.');
        process.exit(0);
    } catch (err) {
        console.error('[BOOT] Erro durante shutdown:', err);
        process.exit(1);
    }
}

// Captura de sinais do SO
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

// Captura de erros não tratados (Rede de segurança final)
process.on('uncaughtException', (err) => {
    console.error('[FATAL] UNCAUGHT EXCEPTION:', err);
    gracefulShutdown('UNCAUGHT_EXCEPTION');
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('[FATAL] UNHANDLED REJECTION:', reason);
    // Não matamos o processo em rejeição de promise para resiliência, 
    // a menos que seja crítico.
});

// Executa o boot
bootstrap();

/* ==========================================================================
   HELPERS INTERNOS
========================================================================== */
// Helper para simular um envelope vindo de dentro (loopback) se necessário
function createEnvelopeFromObservation(obs) {
    // Implementação mock caso precisemos passar pelo validador de envelopes
    return {
        type: { kind: 'EVENT', action: obs.code },
        payload: obs.payload,
        identity: { source: 'DRIVER', target: 'KERNEL' },
        causality: { correlation_id: obs.correlation_id || require('uuid').v4() }
    };
}