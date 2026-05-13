// @ts-check
/**
 * Mapa navegável do subsistema de dialog do agent.
 *
 * Este arquivo é intencionalmente dado estático: ele torna explícito o papel de cada módulo e permite contratos
 * arquiteturais sem acoplar testes à heurística de nomes.
 */

/**
 * @typedef {'entrypoint'
 *     | 'controller'
 *     | 'orchestrator'
 *     | 'executor'
 *     | 'boot'
 *     | 'policy'
 *     | 'state'
 *     | 'wiring'
 *     | 'watchdog'
 *     | 'seam'} DialogModuleRole
 *
 *
 * @typedef {'primary' | 'secondary' | 'internal'} DialogModuleTier
 *
 * @typedef {{ path: string; role: DialogModuleRole; tier: DialogModuleTier; public: boolean; summary: string }} DialogModuleDescriptor
 */

/** @type {readonly DialogModuleDescriptor[]} */
export const DIALOG_MODULE_LAYOUT = Object.freeze([
    {
        path: 'index.js',
        role: 'entrypoint',
        tier: 'primary',
        public: true,
        summary: 'Sub-barrel publico do dialog loop.',
    },
    {
        path: 'module-map.js',
        role: 'entrypoint',
        tier: 'primary',
        public: true,
        summary: 'Inventario executavel de papeis e tiers do diretorio.',
    },
    {
        path: 'boot/index.js',
        role: 'boot',
        tier: 'secondary',
        public: false,
        summary: 'Barrel puro das capacidades de boot do dialog loop.',
    },
    {
        path: 'controllers/index.js',
        role: 'controller',
        tier: 'secondary',
        public: false,
        summary: 'Barrel puro dos controllers do dialog.',
    },
    {
        path: 'executors/index.js',
        role: 'executor',
        tier: 'secondary',
        public: false,
        summary: 'Barrel puro dos executores de turno.',
    },
    {
        path: 'orchestrators/index.js',
        role: 'orchestrator',
        tier: 'secondary',
        public: false,
        summary: 'Barrel puro dos orquestradores do dialog.',
    },
    {
        path: 'policies/index.js',
        role: 'policy',
        tier: 'secondary',
        public: false,
        summary: 'Barrel puro das politicas do dialog.',
    },
    {
        path: 'seams/index.js',
        role: 'seam',
        tier: 'secondary',
        public: false,
        summary: 'Barrel puro dos seams de execução de turno.',
    },
    {
        path: 'state/index.js',
        role: 'state',
        tier: 'secondary',
        public: false,
        summary: 'Barrel puro do estado interno do dialog.',
    },
    {
        path: 'watchdogs/index.js',
        role: 'watchdog',
        tier: 'secondary',
        public: false,
        summary: 'Barrel puro dos watchdogs do dialog.',
    },
    {
        path: 'watchdogs/core/index.js',
        role: 'watchdog',
        tier: 'internal',
        public: false,
        summary: 'Barrel puro de compatibilidade do watchdog core.',
    },
    {
        path: 'wiring/index.js',
        role: 'wiring',
        tier: 'secondary',
        public: false,
        summary: 'Barrel puro do wiring do dialog.',
    },
    {
        path: 'controllers/agent-dialog-controller.js',
        role: 'controller',
        tier: 'primary',
        public: true,
        summary: 'Controller de alto nivel entre AlwaysAliveAgent, DialogHost e loop.',
    },
    {
        path: 'orchestrators/loop-manager.js',
        role: 'orchestrator',
        tier: 'primary',
        public: true,
        summary: 'Orquestrador do ciclo vivo do dialog loop.',
    },
    {
        path: 'executors/turn-executor.js',
        role: 'executor',
        tier: 'primary',
        public: true,
        summary: 'Executor do turno e fronteira quente com sendDialogTurn.',
    },
    {
        path: 'boot/loop-boot-runner.js',
        role: 'boot',
        tier: 'secondary',
        public: false,
        summary: 'Sequencia de boot do dialog loop e handshakes iniciais.',
    },
    {
        path: 'boot/loop-boot-circuit.js',
        role: 'boot',
        tier: 'secondary',
        public: false,
        summary: 'Circuit breaker local para falhas repetidas no boot do dialog loop.',
    },
    {
        path: 'boot/loop-runtime-kit.js',
        role: 'boot',
        tier: 'secondary',
        public: false,
        summary: 'Kit de dependencias runtime usado pelo loop manager.',
    },
    {
        path: 'policies/compaction-policy.js',
        role: 'policy',
        tier: 'secondary',
        public: true,
        summary: 'Politica de compactacao automatica do dialog.',
    },
    {
        path: 'policies/resume-policy.js',
        role: 'policy',
        tier: 'secondary',
        public: true,
        summary: 'Politica de retomada/restart apos eventos do SDK.',
    },
    {
        path: 'policies/model-fallback.js',
        role: 'policy',
        tier: 'secondary',
        public: false,
        summary: 'Normalizacao de fallback de modelo no caminho de dialog.',
    },
    {
        path: 'state/state-machine.js',
        role: 'state',
        tier: 'secondary',
        public: true,
        summary: 'Maquina de estados do dialog loop.',
    },
    {
        path: 'state/pending-question-shadow.js',
        role: 'state',
        tier: 'secondary',
        public: false,
        summary: 'Estado auxiliar para shadow de pergunta pendente.',
    },
    {
        path: 'state/cost-ledger.js',
        role: 'state',
        tier: 'secondary',
        public: true,
        summary: 'Ledger local de custo/uso do dialog.',
    },
    {
        path: 'state/backpressure.js',
        role: 'state',
        tier: 'secondary',
        public: false,
        summary: 'Controle de backpressure e limites de fila.',
    },
    {
        path: 'wiring/event-wiring.js',
        role: 'wiring',
        tier: 'secondary',
        public: false,
        summary: 'Wiring de eventos externos para o dialog loop.',
    },
    {
        path: 'wiring/user-input-handler.js',
        role: 'wiring',
        tier: 'secondary',
        public: true,
        summary: 'Handler canonico de input humano/ask_user.',
    },
    {
        path: 'watchdogs/watchdog.js',
        role: 'watchdog',
        tier: 'secondary',
        public: true,
        summary: 'Watchdog de turnos e thresholds operacionais.',
    },
    {
        path: 'watchdogs/watchdog-supervisor.js',
        role: 'watchdog',
        tier: 'secondary',
        public: true,
        summary: 'Supervisor lifecycle do watchdog.',
    },
    {
        path: 'seams/turn-execution-context.js',
        role: 'seam',
        tier: 'internal',
        public: false,
        summary: 'Seam interna para preparacao de contexto e lifecycle manager do turno.',
    },
    {
        path: 'seams/turn-input-validation.js',
        role: 'seam',
        tier: 'internal',
        public: false,
        summary: 'Seam interna para validacao e normalizacao de input de turno.',
    },
    {
        path: 'seams/turn-result-persistence.js',
        role: 'seam',
        tier: 'internal',
        public: false,
        summary: 'Seam interna para persistencia, progresso e efeitos pos-turno.',
    },
]);

/**
 * @param {DialogModuleRole} role
 * @returns {DialogModuleDescriptor[]}
 */
export function listDialogModulesByRole(role) {
    return DIALOG_MODULE_LAYOUT.filter((entry) => entry.role === role);
}

/**
 * @param {string} path
 * @returns {DialogModuleDescriptor | undefined}
 */
export function getDialogModuleDescriptor(path) {
    return DIALOG_MODULE_LAYOUT.find((entry) => entry.path === path);
}

/**
 * @param {string} path
 * @returns {DialogModuleRole | undefined}
 */
export function getDialogModuleRole(path) {
    return getDialogModuleDescriptor(path)?.role;
}
