// @ts-check
/**
 * Mapa navegável da borda terminal LLM-B.
 *
 * Este mapa governa a raiz de `terminal/`: subdiretórios já possuem ownership próprio e serão detalhados em ondas
 * locais posteriores.
 */

/**
 * @typedef {'file' | 'directory'} TerminalModuleKind
 *
 * @typedef {'entrypoint'
 *     | 'barrel'
 *     | 'boot'
 *     | 'orchestrator'
 *     | 'repl'
 *     | 'command-surface'
 *     | 'dialog-surface'
 *     | 'frontend-surface'
 *     | 'handler-surface'
 *     | 'event-adapter'
 *     | 'state'
 *     | 'store'
 *     | 'passthrough'
 *     | 'sdk-adapter'
 *     | 'dev-tooling'
 *     | 'wiring'} TerminalModuleRole
 *
 *
 * @typedef {'primary' | 'secondary' | 'internal'} TerminalModuleTier
 *
 * @typedef {'stable' | 'watch' | 'hotspot'} TerminalModuleRisk
 *
 * @typedef {{
 *     path: string;
 *     kind: TerminalModuleKind;
 *     role: TerminalModuleRole;
 *     tier: TerminalModuleTier;
 *     risk: TerminalModuleRisk;
 *     public: boolean;
 *     summary: string;
 * }} TerminalModuleDescriptor
 */

/** @type {readonly TerminalModuleDescriptor[]} */
export const TERMINAL_MODULE_LAYOUT = Object.freeze([
    {
        path: 'index.js',
        kind: 'file',
        role: 'barrel',
        tier: 'primary',
        risk: 'stable',
        public: true,
        summary: 'Barrel público puro da borda terminal: surface root, module-map e composition root nomeado.',
    },
    {
        path: 'runtime-root.js',
        kind: 'file',
        role: 'orchestrator',
        tier: 'primary',
        risk: 'watch',
        public: true,
        summary: 'Composition root explícito do terminal: DI, fases de boot, listeners e start do REPL.',
    },
    {
        path: 'bootstrap.js',
        kind: 'file',
        role: 'entrypoint',
        tier: 'primary',
        risk: 'stable',
        public: false,
        summary: 'Entrypoint executável da task terminal:llm-b.',
    },
    {
        path: 'bootstrap-dotenv.js',
        kind: 'file',
        role: 'boot',
        tier: 'secondary',
        risk: 'stable',
        public: false,
        summary:
            'Side-effect import precoce que carrega .env.local antes das demais leituras de configuração do terminal.',
    },
    {
        path: 'bootstrap-dotenv-loader.js',
        kind: 'file',
        role: 'boot',
        tier: 'secondary',
        risk: 'stable',
        public: false,
        summary: 'Loader testável de .env.local com override=false para preservar env explícito da task/harness.',
    },
    {
        path: 'bootstrap-lifecycle.js',
        kind: 'file',
        role: 'boot',
        tier: 'secondary',
        risk: 'stable',
        public: false,
        summary: 'Lifecycle fatal de boot, sinais e shutdown por falha de bootstrap.',
    },
    {
        path: 'bootstrap-runtime.js',
        kind: 'file',
        role: 'boot',
        tier: 'secondary',
        risk: 'watch',
        public: false,
        summary: 'Composição testável do runtime de bootstrap antes da entrada no REPL.',
    },
    {
        path: 'dev-watch.js',
        kind: 'file',
        role: 'dev-tooling',
        tier: 'secondary',
        risk: 'watch',
        public: false,
        summary:
            'Monitor passivo de mudanças em src/copilot/** (notify) ou auto-restart supervisionado (auto). Activado por COPILOT_DEV_WATCH. Expõe getDevWatchStatus() para introspection.',
    },
    {
        path: 'module-map.js',
        kind: 'file',
        role: 'entrypoint',
        tier: 'primary',
        risk: 'stable',
        public: true,
        summary: 'Inventário executável da raiz do terminal.',
    },
    {
        path: 'repl/repl.js',
        kind: 'file',
        role: 'repl',
        tier: 'secondary',
        risk: 'hotspot',
        public: true,
        summary: 'Loop readline e roteamento de input humano para comandos/turnos.',
    },
    {
        path: 'repl/repl-listeners.js',
        kind: 'file',
        role: 'repl',
        tier: 'secondary',
        risk: 'stable',
        public: false,
        summary: 'Listeners que traduzem eventos vivos para UX do REPL.',
    },
    {
        path: 'repl/repl-banner.js',
        kind: 'file',
        role: 'repl',
        tier: 'secondary',
        risk: 'stable',
        public: false,
        summary: 'Banner operacional do REPL e lista compacta de comandos/endpoints.',
    },
    {
        path: 'repl/repl-command-parser.js',
        kind: 'file',
        role: 'repl',
        tier: 'secondary',
        risk: 'stable',
        public: false,
        summary: 'Parser puro de comandos slash e aliases resolvidos.',
    },
    {
        path: 'repl/repl-input-routing.js',
        kind: 'file',
        role: 'repl',
        tier: 'secondary',
        risk: 'stable',
        public: false,
        summary: 'Policy de comandos imediatos e avisos de fila para input concorrente do REPL.',
    },
    {
        path: 'repl/repl-command-router.js',
        kind: 'file',
        role: 'repl',
        tier: 'secondary',
        risk: 'hotspot',
        public: false,
        summary: 'Tabela CMD_ROUTES e dispatcher dispatchCmd — routing de comandos REPL.',
    },
    {
        path: 'repl/repl-lifecycle.js',
        kind: 'file',
        role: 'repl',
        tier: 'secondary',
        risk: 'hotspot',
        public: false,
        summary: 'Lifecycle readline do REPL: criação do interface, tab completion e event handlers.',
    },
    {
        path: 'repl/auto-brief.js',
        kind: 'file',
        role: 'repl',
        tier: 'secondary',
        risk: 'hotspot',
        public: false,
        summary: 'Auto-brief progressivo do terminal, emitido no boot parcial e no pós-bootstrap real.',
    },
    {
        path: 'repl/live-status-line.js',
        kind: 'file',
        role: 'repl',
        tier: 'secondary',
        risk: 'hotspot',
        public: false,
        summary: 'Linha viva permanente do terminal com status operacional, heartbeat e atividade atual.',
    },
    {
        path: 'repl/repl-multiline.js',
        kind: 'file',
        role: 'repl',
        tier: 'secondary',
        risk: 'stable',
        public: false,
        summary: 'Estado de input multiline por backslash continuation.',
    },
    {
        path: 'wiring/terminal-agent-wiring.js',
        kind: 'file',
        role: 'wiring',
        tier: 'secondary',
        risk: 'hotspot',
        public: false,
        summary: 'Wiring de alto nível entre terminal, agent e SSE local.',
    },
    {
        path: 'events/event-adapters.js',
        kind: 'file',
        role: 'event-adapter',
        tier: 'secondary',
        risk: 'stable',
        public: false,
        summary: 'Composition root canônico dos adapters de eventos do terminal para REPL e headless.',
    },
    {
        path: 'events/event-adapter-events.js',
        kind: 'file',
        role: 'event-adapter',
        tier: 'secondary',
        risk: 'hotspot',
        public: false,
        summary: 'Matriz contratual dos eventos do agent, fontes públicas canônicas, passthrough residual e ignorados.',
    },
    {
        path: 'events/agent-runtime-events.js',
        kind: 'file',
        role: 'event-adapter',
        tier: 'secondary',
        risk: 'hotspot',
        public: false,
        summary: 'Adapta eventos normalizados do runtime/agent para stdout e SSE.',
    },
    {
        path: 'events/sdk-session-events.js',
        kind: 'file',
        role: 'event-adapter',
        tier: 'secondary',
        risk: 'hotspot',
        public: false,
        summary: 'Adapta sinais vanilla da sessão SDK para a UX do terminal.',
    },
    {
        path: 'events/io-activity-events.js',
        kind: 'file',
        role: 'event-adapter',
        tier: 'secondary',
        risk: 'hotspot',
        public: false,
        summary: 'Adapta diagnostics_channel de I/O real para /activity, SSE e narrativa live do terminal.',
    },
    {
        path: 'events/task-stream-events.js',
        kind: 'file',
        role: 'event-adapter',
        tier: 'secondary',
        risk: 'hotspot',
        public: false,
        summary: 'Renderiza e transmite eventos de streaming de tarefas internas.',
    },
    {
        path: 'events/task-transcript-accumulator.js',
        kind: 'file',
        role: 'event-adapter',
        tier: 'internal',
        risk: 'stable',
        public: false,
        summary: 'Acumula deltas textuais de tarefas e promove conteúdo relevante a transcript persistente.',
    },
    {
        path: 'events/assistant-transcript-renderer.js',
        kind: 'file',
        role: 'event-adapter',
        tier: 'internal',
        risk: 'stable',
        public: false,
        summary: 'Renderiza mensagens persistentes da LLM-B recebidas fora do fluxo explícito de diálogo.',
    },
    {
        path: 'events/intent-renderer.js',
        kind: 'file',
        role: 'event-adapter',
        tier: 'internal',
        risk: 'stable',
        public: false,
        summary: 'Renderiza e persiste intents explícitos da LLM-B vindos de assistant.intent e report_intent.',
    },
    {
        path: 'events/agent-sse-passthrough.js',
        kind: 'file',
        role: 'passthrough',
        tier: 'internal',
        risk: 'stable',
        public: false,
        summary: 'Passthrough SSE explícito e estreito para eventos do agent ainda sem adapter dedicado.',
    },
    {
        path: 'state/sdk-interactions.js',
        kind: 'file',
        role: 'sdk-adapter',
        tier: 'secondary',
        risk: 'hotspot',
        public: false,
        summary:
            'Estado local das interações humanas com elicitation/permissões; consome SDK via gateway terminal-owned.',
    },
    {
        path: 'events/tool-activity-presenter.js',
        kind: 'file',
        role: 'event-adapter',
        tier: 'secondary',
        risk: 'hotspot',
        public: false,
        summary: 'Presenter canônico para identidade/narrativa operacional de tools, arquivos e comandos no terminal.',
    },
    {
        path: 'state/activity-state.js',
        kind: 'file',
        role: 'state',
        tier: 'secondary',
        risk: 'hotspot',
        public: true,
        summary: 'Estado observável da atividade terminal para comandos e métricas locais.',
    },
    {
        path: 'state/display-policy.js',
        kind: 'file',
        role: 'state',
        tier: 'secondary',
        risk: 'hotspot',
        public: false,
        summary: 'Policy de densidade visual: presets, toggles e impacto em prompt/waiting.',
    },
    {
        path: 'state/ui-preferences.js',
        kind: 'file',
        role: 'state',
        tier: 'secondary',
        risk: 'stable',
        public: false,
        summary: 'Preferências locais de UI do terminal persistidas para comandos e projeções.',
    },
    {
        path: 'state/ui-theme.js',
        kind: 'file',
        role: 'state',
        tier: 'secondary',
        risk: 'hotspot',
        public: false,
        summary: 'Tokens e helpers de tema visual do terminal.',
    },
    {
        path: 'state/transcript-state.js',
        kind: 'file',
        role: 'state',
        tier: 'secondary',
        risk: 'watch',
        public: false,
        summary: 'Feed local elástico de mensagens da LLM-B com controle de pressão de memória.',
    },
    {
        path: 'state/transcript-archive.js',
        kind: 'file',
        role: 'state',
        tier: 'secondary',
        risk: 'stable',
        public: false,
        summary: 'Archive JSONL durável para transcripts do terminal preservados fora da janela em memória.',
    },
    {
        path: 'state/intent-state.js',
        kind: 'file',
        role: 'state',
        tier: 'secondary',
        risk: 'stable',
        public: false,
        summary: 'Histórico elástico de intents explícitos da LLM-B para /intent, prompt e transcript.',
    },
    {
        path: 'state/pending-question-replay.js',
        kind: 'file',
        role: 'state',
        tier: 'secondary',
        risk: 'stable',
        public: false,
        summary: 'Policy de replay/dedupe para perguntas pendentes no terminal.',
    },
    {
        path: 'state/pending-question-answer.js',
        kind: 'file',
        role: 'state',
        tier: 'secondary',
        risk: 'stable',
        public: false,
        summary: 'Policy de roteamento de input humano para ask_user pendente sem deadlock de fila.',
    },
    {
        path: 'state/turn-trace-state.js',
        kind: 'file',
        role: 'state',
        tier: 'secondary',
        risk: 'hotspot',
        public: true,
        summary: 'Estado canônico de resumo por turno para tools, arquivos tocados e activity projections.',
    },
    {
        path: 'state/turn-materialization-state.js',
        kind: 'file',
        role: 'state',
        tier: 'secondary',
        risk: 'hotspot',
        public: true,
        summary: 'Materializa reply direto, assistant.message e deltas incrementais em uma resposta final canônica.',
    },
    {
        path: 'state/rate-limiter-state.js',
        kind: 'file',
        role: 'state',
        tier: 'internal',
        risk: 'stable',
        public: false,
        summary: 'Estado local do rate limiter usado por comandos/handlers do terminal.',
    },
    {
        path: 'stores/alias-store.js',
        kind: 'file',
        role: 'store',
        tier: 'secondary',
        risk: 'watch',
        public: true,
        summary: 'Persistência dos aliases humanos do REPL.',
    },
    {
        path: 'commands/',
        kind: 'directory',
        role: 'command-surface',
        tier: 'secondary',
        risk: 'hotspot',
        public: true,
        summary: 'Comandos REPL finos, orientados a operações do runtime.',
    },
    {
        path: 'dialog/',
        kind: 'directory',
        role: 'dialog-surface',
        tier: 'secondary',
        risk: 'hotspot',
        public: true,
        summary: 'Render, prompt, waiting UX, envio e exibição de turnos.',
    },
    {
        path: 'events/',
        kind: 'directory',
        role: 'event-adapter',
        tier: 'secondary',
        risk: 'hotspot',
        public: false,
        summary: 'Adapters, passthroughs e presenters que traduzem eventos vivos para terminal/SSE.',
    },
    {
        path: 'frontend/',
        kind: 'directory',
        role: 'frontend-surface',
        tier: 'secondary',
        risk: 'hotspot',
        public: true,
        summary: 'Consumer layer canônica do runtime para o terminal.',
    },
    {
        path: 'frontend/projections/',
        kind: 'directory',
        role: 'frontend-surface',
        tier: 'secondary',
        risk: 'stable',
        public: false,
        summary: 'Famílias de projeção: shared, status, live, now, config, metrics, usage, sdk-session.',
    },
    {
        path: 'frontend/gateways/',
        kind: 'directory',
        role: 'frontend-surface',
        tier: 'secondary',
        risk: 'stable',
        public: false,
        summary: 'Gateways de runtime: agent-runtime, sdk-session, dialog, hub.',
    },
    {
        path: 'frontend/gateways/sdk-session.js',
        kind: 'file',
        role: 'sdk-adapter',
        tier: 'secondary',
        risk: 'hotspot',
        public: false,
        summary:
            'Única ponte runtime do terminal para helpers vanilla da sessão SDK e operações expostas por presentation.',
    },
    {
        path: 'frontend/operational-guidance/',
        kind: 'directory',
        role: 'frontend-surface',
        tier: 'secondary',
        risk: 'stable',
        public: false,
        summary: 'Guidance operacional do terminal para /status, /sdk doctor, /fs e recuperação de falhas.',
    },
    {
        path: 'handlers/',
        kind: 'directory',
        role: 'handler-surface',
        tier: 'secondary',
        risk: 'stable',
        public: true,
        summary: 'Handlers HTTP usados pelo servidor terminal/inject.',
    },
    {
        path: 'repl/',
        kind: 'directory',
        role: 'repl',
        tier: 'secondary',
        risk: 'hotspot',
        public: false,
        summary: 'Lifecycle, parsing, routing e elementos visuais do REPL interativo.',
    },
    {
        path: 'state/',
        kind: 'directory',
        role: 'state',
        tier: 'secondary',
        risk: 'hotspot',
        public: false,
        summary: 'Estados locais do terminal: atividade, display, interação SDK, turn trace e limites.',
    },
    {
        path: 'state/boot/',
        kind: 'directory',
        role: 'state',
        tier: 'internal',
        risk: 'stable',
        public: false,
        summary: 'Sub-surface focada do boot: atividade e display preset consumidos pelas fases de inicialização.',
    },
    {
        path: 'state/dialog/',
        kind: 'directory',
        role: 'state',
        tier: 'internal',
        risk: 'stable',
        public: false,
        summary: 'Sub-surface focada do dialog: atividade, prompt policy e tema usados pelo runtime conversacional.',
    },
    {
        path: 'state/events/',
        kind: 'directory',
        role: 'state',
        tier: 'internal',
        risk: 'stable',
        public: false,
        summary: 'Sub-surface focada para adapters de eventos, turn trace e SDK waits do terminal.',
    },
    {
        path: 'state/sdk/',
        kind: 'directory',
        role: 'state',
        tier: 'internal',
        risk: 'stable',
        public: false,
        summary: 'Sub-surface focada das interações SDK do terminal: elicitations, permissões e user_input.',
    },
    {
        path: 'state/projections/',
        kind: 'directory',
        role: 'state',
        tier: 'internal',
        risk: 'stable',
        public: false,
        summary: 'Sub-surface focada das projeções frontend: atividade, display e resumos de interações SDK.',
    },
    {
        path: 'state/repl/',
        kind: 'directory',
        role: 'state',
        tier: 'internal',
        risk: 'stable',
        public: false,
        summary: 'Sub-surface focada do REPL: display state, answer policy, rate-limit reset e tema.',
    },
    {
        path: 'state/repl-runtime/',
        kind: 'directory',
        role: 'state',
        tier: 'internal',
        risk: 'stable',
        public: true,
        summary: 'Sub-surface focada do runtime do REPL: input policy, display preset e resets operacionais.',
    },
    {
        path: 'state/ui/',
        kind: 'directory',
        role: 'state',
        tier: 'internal',
        risk: 'stable',
        public: false,
        summary: 'Sub-surface focada da UX local: display policy, detalhe visual e tema do terminal.',
    },
    {
        path: 'stores/',
        kind: 'directory',
        role: 'store',
        tier: 'secondary',
        risk: 'watch',
        public: true,
        summary: 'Persistências locais pequenas usadas pela experiência interativa.',
    },
    {
        path: 'terminal-phases/',
        kind: 'directory',
        role: 'boot',
        tier: 'secondary',
        risk: 'watch',
        public: false,
        summary: 'Fases explícitas do boot terminal: HTTP, hub, listeners, pinned context e shutdown.',
    },
    {
        path: 'wiring/',
        kind: 'directory',
        role: 'wiring',
        tier: 'secondary',
        risk: 'hotspot',
        public: false,
        summary: 'Wiring operacional entre agent, frontend terminal, watchdog e SSE.',
    },
    {
        path: 'wiring/mailbox/',
        kind: 'directory',
        role: 'wiring',
        tier: 'internal',
        risk: 'stable',
        public: false,
        summary: 'Sub-surface focada da drenagem zero-PR do mailbox, consumida pelo REPL e pelos eventos SDK.',
    },
]);

/**
 * @param {TerminalModuleRole} role
 * @returns {TerminalModuleDescriptor[]}
 */
export function listTerminalModulesByRole(role) {
    return TERMINAL_MODULE_LAYOUT.filter((entry) => entry.role === role);
}

/**
 * @param {TerminalModuleRisk} risk
 * @returns {TerminalModuleDescriptor[]}
 */
export function listTerminalModulesByRisk(risk) {
    return TERMINAL_MODULE_LAYOUT.filter((entry) => entry.risk === risk);
}

/**
 * @param {Record<string, number>} bucket
 * @param {string} key
 * @returns {void}
 */
function increment(bucket, key) {
    bucket[key] = (bucket[key] ?? 0) + 1;
}

/**
 * @param {string} path
 * @returns {TerminalModuleDescriptor | undefined}
 */
export function getTerminalModuleDescriptor(path) {
    return TERMINAL_MODULE_LAYOUT.find((entry) => entry.path === path);
}

/**
 * @param {string} path
 * @returns {TerminalModuleRole | undefined}
 */
export function getTerminalModuleRole(path) {
    return getTerminalModuleDescriptor(path)?.role;
}

/**
 * Scorecard leve de organização física da raiz do terminal.
 *
 * @returns {{
 *     total: number;
 *     byRole: Record<string, number>;
 *     byRisk: Record<string, number>;
 *     hotspots: string[];
 *     watch: string[];
 * }}
 */
export function buildTerminalModuleScorecard() {
    /** @type {Record<string, number>} */
    const byRole = {};
    /** @type {Record<string, number>} */
    const byRisk = {};
    /** @type {string[]} */
    const hotspots = [];
    /** @type {string[]} */
    const watch = [];

    for (const entry of TERMINAL_MODULE_LAYOUT) {
        increment(byRole, entry.role);
        increment(byRisk, entry.risk);
        if (entry.risk === 'hotspot') hotspots.push(entry.path);
        if (entry.risk === 'watch') watch.push(entry.path);
    }

    return {
        total: TERMINAL_MODULE_LAYOUT.length,
        byRole,
        byRisk,
        hotspots: hotspots.sort(),
        watch: watch.sort(),
    };
}
