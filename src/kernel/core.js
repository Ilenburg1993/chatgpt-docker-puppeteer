/* ==========================================================================
   src/kernel/core.js
   Audit Level: 800 — Sovereign Decision Kernel (The Brain)
   Status: CONSOLIDATED (Protocol 11)
   Responsabilidade: 
     - Manter o Loop de Controle (Observe-Orient-Decide-Act).
     - Ingerir telemetria do NERV e transformá-la em Observações.
     - Consultar o Motor de Políticas.
     - Emitir Propostas de Ação para os Efetores.
========================================================================== */

const EventEmitter = require('events');
const { v4: uuidv4 } = require('uuid');

// Ontologia Constitucional
const { 
    MessageType, 
    ActionCode, 
    ActorRole 
} = require('../shared/ipc/constants');

// Dependências Internas (Serão criadas nas próximas subfases)
// Se o Node reclamar da falta delas agora, é esperado.
const ObservationStore = require('./state/observation_store');
const TaskStore = require('./state/task_store');
const PolicyEngine = require('./policies/policy_engine');

class SovereignKernel extends EventEmitter {
    /**
     * @param {object} deps
     * @param {object} deps.nerv - O Sistema Nervoso (Transporte).
     * @param {object} deps.effectors - O Sistema Muscular (Executores).
     * @param {object} deps.config - Configurações estáticas.
     */
    constructor({ nerv, effectors, config }) {
        super();
        this.nerv = nerv;
        this.effectors = effectors;
        this.config = config;

        // Estado Interno
        this.running = false;
        this.tickInterval = null;
        
        // Subsistemas de Estado (Memória de Curto Prazo)
        this.observations = new ObservationStore();
        this.tasks = new TaskStore();
        
        // Subsistema de Julgamento (Leis e Regras)
        this.policies = new PolicyEngine(config);

        this._bindNerv();
    }

    /* =========================================================
       1. CICLO DE VIDA (BOOT & SHUTDOWN)
    ========================================================= */

    async boot() {
        if (this.running) return;
        
        this.emit('kernel:boot:start');
        console.log('[KERNEL] Inicializando córtex cerebral...');

        // 1. Inicializa subsistemas
        this.observations.clear();
        this.tasks.hydrate(); // Tenta carregar estado anterior do disco (se houver)

        // 2. Inicia o Loop Cognitivo (Heartbeat do Cérebro)
        this.running = true;
        this.tickInterval = setInterval(() => this._tick(), this.config.CYCLE_DELAY || 1000);

        // 3. Avisa o mundo que está vivo
        this.emit('kernel:boot:complete');
        console.log('[KERNEL] Soberania estabelecida. Aguardando estímulos.');
    }

    async shutdown() {
        this.running = false;
        if (this.tickInterval) clearInterval(this.tickInterval);
        
        console.log('[KERNEL] Desligando processos cognitivos...');
        // Persistência de emergência seria chamada aqui
        this.emit('kernel:shutdown');
    }

    /* =========================================================
       2. INTEGRAÇÃO SENSORIAL (NERV -> KERNEL)
    ========================================================= */

    /**
     * Conecta os "nervos" ao cérebro.
     */
    _bindNerv() {
        // Escuta envelopes chegando do servidor
        this.nerv.telemetry.on('nerv:inbound', (envelope) => {
            this._ingest(envelope);
        });

        // Escuta problemas no transporte (Dor)
        this.nerv.telemetry.on('nerv:backpressure:change', (data) => {
            if (data.to === 'CRITICAL') {
                this._ingestSystemSignal('HIGH_PRESSURE', data);
            }
        });
    }

    /**
     * Transforma um Envelope Bruto em uma Observação Semântica.
     */
    _ingest(envelope) {
        // Filtra ruído: Só processa o que é relevante para decisão
        const observation = {
            id: uuidv4(),
            type: envelope.type.kind,
            code: envelope.type.action,
            payload: envelope.payload,
            timestamp: Date.now(),
            source: envelope.identity.source,
            correlation_id: envelope.causality.correlation_id
        };

        // Armazena na memória de curto prazo
        this.observations.add(observation);
        
        // Gatilho imediato para alta prioridade (Reflexo)
        if (envelope.type.kind === MessageType.COMMAND) {
            this._processImmediate(observation);
        }
    }

    _ingestSystemSignal(code, data) {
        this.observations.add({
            id: uuidv4(),
            type: MessageType.EVENT,
            code: code,
            payload: data,
            timestamp: Date.now(),
            source: 'SYSTEM'
        });
    }

    /* =========================================================
       3. LOOP COGNITIVO (OODA LOOP)
       Observe -> Orient -> Decide -> Act
    ========================================================= */

    _tick() {
        if (!this.running) return;

        try {
            // 1. OBSERVE: O que mudou desde o último tick?
            const pendingObs = this.observations.getPending();
            if (pendingObs.length === 0 && !this.tasks.hasActiveTask()) return;

            // 2. ORIENT: Atualiza o modelo de mundo com base nas observações
            this._updateWorldModel(pendingObs);

            // 3. DECIDE: O que devemos fazer? (Consulta Políticas)
            const proposals = this.policies.evaluate(this.tasks.getState(), pendingObs);

            // 4. ACT: Executa as propostas através dos Efetores
            this._executeProposals(proposals);

            // Limpeza
            this.observations.markProcessed(pendingObs);

        } catch (err) {
            console.error('[KERNEL PANIC] Erro no loop cognitivo:', err);
            // Autocura do próprio Kernel: não deixa o loop morrer
        }
    }

    /* =========================================================
       4. EXECUÇÃO E REAÇÃO
    ========================================================= */

    _updateWorldModel(observations) {
        for (const obs of observations) {
            // Se recebemos uma tarefa nova do servidor
            if (obs.code === ActionCode.PROPOSE_TASK) {
                this.tasks.stageNewTask(obs.payload);
            }
            // Se o motorista (Driver) reportou erro
            if (obs.code === 'TASK_FAILED') {
                this.tasks.recordFailure(obs.payload);
            }
        }
    }

    _processImmediate(observation) {
        // Tratamento de interrupções urgentes (Ex: ABORT_TASK)
        if (observation.code === ActionCode.ABORT_TASK) {
            console.log('[KERNEL] Interrupção de emergência recebida.');
            this.effectors.task.abort();
            this.tasks.clearActive();
        }
    }

    _executeProposals(proposals) {
        if (!proposals || proposals.length === 0) return;

        for (const prop of proposals) {
            console.log(`[KERNEL DECISION] Executando: ${prop.action}`);
            
            switch (prop.action) {
                case 'ACTIVATE_TASK':
                    this.effectors.task.start(prop.payload);
                    break;
                
                case 'EMIT_EVENT':
                    // O Kernel fala através do NERV
                    this.nerv.send(prop.payload);
                    break;
                
                case 'PERSIST_STATE':
                    this.effectors.io.save(this.tasks.getState());
                    break;
            }
        }
    }
}

module.exports = SovereignKernel;