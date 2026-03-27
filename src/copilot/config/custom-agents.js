// @ts-check
/**
 * src/copilot/config/custom-agents.js
 *
 * Factory de agentes customizados pré-configurados. Define perfis de agente com conjuntos de ferramentas e prompts
 * especializados para tarefas específicas.
 *
 * Regras de nomeação: agentes são referenciados pelo modo `@nome` no REPL/terminal.
 *
 * @module copilot/config/custom-agents
 */

/**
 * @typedef {Object} CustomAgentConfig
 * @property {string} name - Nome de referência do agente (ex: 'auditor')
 * @property {string} description - Descrição resumida do propósito do agente
 * @property {string[]} tools - Lista de ferramentas permitidas
 * @property {string} prompt - Prompt de sistema especializado
 * @property {string[]} [mcpServers] - Servidores MCP adicionais (opcional)
 * @property {boolean} [infer] - Se true, o agente pode inferir chamadas de ferramentas automaticamente
 */

/**
 * Mapa de todos os agentes customizados registrados.
 *
 * @type {Map<string, CustomAgentConfig>}
 */
const BUILTIN_AGENTS = new Map([
    [
        'auditor',
        {
            name: 'auditor',
            description: 'Agente de auditoria de código — analisa, busca e reporta sem modificar arquivos',
            tools: ['glob', 'grep', 'view'],
            infer: true,
            prompt: `Você é um auditor de código especializado.
Sua função é analisar código-fonte, identificar problemas de qualidade, segurança e conformidade,
e produzir relatórios estruturados.

Regras operacionais:
- NUNCA modifique arquivos — apenas leia e analise
- Cite sempre o arquivo:linha de cada ocorrência encontrada
- Classifique problemas como: CRÍTICO | ALTO | MÉDIO | BAIXO | INFO
- Finalize com um resumo executivo com contadores por severidade
- Use a ferramenta grep para buscas textuais e glob para descoberta de arquivos`,
        },
    ],
    [
        'docs',
        {
            name: 'docs',
            description: 'Agente de documentação — lê código e gera/atualiza JSDoc, README e comentários',
            tools: ['view', 'glob'],
            infer: true,
            prompt: `Você é um especialista em documentação técnica de software.
Sua função é ler código-fonte e gerar documentação clara, precisa e bem estruturada.

Regras operacionais:
- Produza JSDoc completo: @param, @returns, @throws, @example quando relevante
- Use tipagem explícita em todos os @param e @returns
- Para READMEs: estruture com seções padrão (Visão geral, Instalação, Uso, API, Contribuição)
- Mantenha deutsch técnico preciso mas acessível
- Não invente comportamentos — documente apenas o que o código faz`,
        },
    ],
    [
        'reviewer',
        {
            name: 'reviewer',
            description: 'Agente de revisão de PR — analisa diff e produz comentários de review',
            tools: ['glob', 'grep', 'view'],
            infer: true,
            prompt: `Você é um revisor de código experiente.
Analise alterações de código com foco em:
1. Corretude lógica e edge cases
2. Segurança (OWASP Top 10)
3. Performance e complexidade algorítmica
4. Cobertura de testes
5. Conformidade com convenções do projeto

Formato de saída: use marcadores [BUG], [SEGURANÇA], [PERF], [TESTE], [ESTILO] por comentário.
Finalize com APROVADO / APROVADO COM RESSALVAS / REJEITADO + justificativa.`,
        },
    ],
]);

/**
 * Retorna a configuração de um agente customizado pelo nome.
 *
 * @param {string} name - Nome do agente, com ou sem at-sign no prefixo
 * @returns {CustomAgentConfig | undefined}
 */
export function getCustomAgent(name) {
    const normalized = name.startsWith('@') ? name.slice(1) : name;
    return BUILTIN_AGENTS.get(normalized);
}

/**
 * Retorna todos os agentes customizados registrados.
 *
 * @returns {CustomAgentConfig[]}
 */
export function listCustomAgents() {
    return Array.from(BUILTIN_AGENTS.values());
}

/**
 * Registra ou sobrescreve um agente customizado em runtime. Útil para testes e extensão dinâmica sem reinicialização.
 *
 * @param {CustomAgentConfig} config
 * @returns {void}
 */
export function registerCustomAgent(config) {
    if (!config?.name) throw new Error('CustomAgentConfig.name é obrigatório');
    BUILTIN_AGENTS.set(config.name, config);
}

/**
 * Remove um agente customizado pelo nome. Agentes built-in podem ser removidos (operação destrutiva, não reversível em
 * runtime).
 *
 * @param {string} name - Nome do agente, sem at-sign no prefixo
 * @returns {boolean} true se existia e foi removido
 */
export function removeCustomAgent(name) {
    return BUILTIN_AGENTS.delete(name);
}

// ---------------------------------------------------------------------------
// SDK Integration — CustomAgentConfig para SessionConfig.customAgents
// ---------------------------------------------------------------------------

/**
 * @typedef {import('@github/copilot-sdk').CustomAgentConfig} SdkCustomAgentConfig
 */

/**
 * Sub-agentes no formato aceito pelo SDK (SessionConfig.customAgents).
 *
 * Esses agentes são invocados pela LLM-B via delegação automática. Diferem dos agentes internos (`BUILTIN_AGENTS`) que
 * são usados via REPL/terminal — estes são nativos ao SDK Copilot.
 *
 * @type {SdkCustomAgentConfig[]}
 */
const SDK_AGENTS = [
    {
        name: 'task',
        displayName: 'Task Agent',
        description:
            'Execute development commands like tests, builds, linters. Returns brief summary on success, full output on failure.',
        tools: ['bash', 'write_bash', 'read_bash', 'stop_bash'],
        prompt: `You are a command execution agent that runs development commands and reports results efficiently.

Execute commands: tests (npm run test), builds, linting, dependency installs.

CRITICAL output format:
- SUCCESS: one-line summary (e.g., "All 247 tests passed")
- FAILURE: full error output with stack traces
- Do NOT fix errors or make suggestions — just execute and report
- Do NOT retry on failure`,
        infer: true,
    },
    {
        name: 'explore',
        displayName: 'Explore Agent',
        description: 'Fast codebase exploration. Uses grep, glob, bash. Safe to call in parallel.',
        tools: ['grep', 'glob', 'bash', 'str_replace_editor'],
        prompt: `You are an exploration agent specialized in rapid codebase analysis.

Use grep for text patterns, glob for file discovery, str_replace_editor (view) for file contents,
bash for commands grep/glob can't handle (find, ls, git log, wc).

CRITICAL: Maximize parallel tool calling — always call independent tools simultaneously.
Keep answers under 300 words for simple questions. Cite file paths and line numbers.`,
        infer: true,
    },
    {
        name: 'diagnostic',
        displayName: 'Diagnostic Agent',
        description: 'System diagnostics: PM2, health checks, ports, logs. Read-only.',
        tools: ['bash', 'read_bash', 'grep', 'glob'],
        prompt: `You are a system diagnostic agent for this Node.js project.

Capabilities: PM2 status, health checks (npm run health:core), port inspection (lsof),
log file analysis, queue status, environment validation.

Output format: ✅ OK / ⚠️ WARNING / ❌ ERROR sections with specific values and PIDs.
Highlight critical issues. Suggest fixes but do NOT execute them unless explicitly asked.`,
        infer: true,
    },
    {
        name: 'planner',
        displayName: 'Planner Agent',
        description: 'Estrutura planos detalhados de execução antes de agir. Ideal para tarefas complexas multi-etapa.',
        tools: [
            'session_mode_set',
            'session_plan_read',
            'session_plan_update',
            'get_tasks',
            'add_task',
            'grep',
            'glob',
        ],
        prompt: `Você é um agente de planejamento que estrutura o trabalho antes de executar.

Processo obrigatório:
1. Chame session_mode_set(mode="plan") para entrar no modo de planejamento
2. Leia o plano atual com session_plan_read (se existir)
3. Construa um plano completo em Markdown com: Objetivo, Análise de dependências, Etapas ordenadas, Critérios de sucesso
4. Grave o plano com session_plan_update
5. Retorne o plano para confirmação do usuário ANTES de executar qualquer ação

Formato do plano.md:
# Plano: [Título]
## Objetivo
## Contexto e dependências
## Etapas
- [ ] Etapa 1
- [ ] Etapa 2
## Riscos
## Critérios de sucesso`,
        infer: true,
    },
    {
        name: 'git-ops',
        displayName: 'Git Operations Agent',
        description: 'Operações git: status, diff, commit, branch, push. Sempre verifica antes de confirmar.',
        tools: [
            'git_status',
            'git_diff',
            'git_changed_files',
            'git_log',
            'git_create_branch',
            'git_commit',
            'git_push',
            'report_intent',
        ],
        prompt: `Você é um agente especializado em operações Git para este projeto.

Regras operacionais:
1. SEMPRE chame git_status e git_diff antes de qualquer operação de escrita
2. SEMPRE chame report_intent(risk="medium") antes de git_commit ou git_push
3. Mensagens de commit: formato Conventional Commits (feat|fix|refactor|docs|test|chore)
4. Nunca force-push sem confirmação explícita do usuário
5. Verifique branch ativo antes de operações destrutivas

Formato de relatório: [STATUS] branch | staged/unstaged | última ação`,
        infer: true,
    },
    {
        name: 'shell-ops',
        displayName: 'Shell Operations Agent',
        description:
            'Execução de scripts, npm, node e diagnósticos de sistema. Confirma antes de comandos destrutivos.',
        tools: [
            'exec_command',
            'run_npm_script',
            'run_node_file',
            'lint_check',
            'run_tests',
            'typecheck',
            'get_system_health',
            'report_intent',
        ],
        prompt: `Você é um agente de operações de shell para este projeto Node.js 24+.

Capacidades: executar scripts npm, rodar arquivos Node.js, lint, testes, typecheck, diagnóstico de saúde.

Regras:
1. Chame report_intent(risk="high") antes de exec_command com comandos destrutivos (rm, drop, etc.)
2. Prefira run_npm_script para tarefas definidas no package.json
3. Relate saída completa em erros; apenas resumo em sucesso
4. Não execute loops ou comandos longos sem confirmar timeout intencional`,
        infer: true,
    },
];

/**
 * Nomes dos SDK agents habilitados por padrão.
 *
 * Pode ser sobrescrito via `COPILOT_CUSTOM_AGENTS=task,explore,diagnostic` (CSV).
 *
 * @type {string[]}
 */
const DEFAULT_SDK_AGENTS = (process.env.COPILOT_CUSTOM_AGENTS ?? 'task,explore,diagnostic,planner,git-ops,shell-ops')
    .split(',')
    .filter(Boolean);

/**
 * Constrói o array `customAgents` para injetar em `SessionConfig.customAgents`.
 *
 * @param {string[]} [enabled] - Nomes dos agentes a incluir. Default: DEFAULT_SDK_AGENTS.
 * @returns {SdkCustomAgentConfig[] | undefined} Array de agentes ou undefined se vazio.
 */
export function buildCustomAgentsConfig(enabled = DEFAULT_SDK_AGENTS) {
    if (enabled.length === 0) return undefined;
    const agents = SDK_AGENTS.filter((a) => enabled.includes(a.name));
    return agents.length > 0 ? agents : undefined;
}

/**
 * Lista os nomes dos SDK agents disponíveis para SessionConfig.
 *
 * @returns {string[]}
 */
export function listAvailableSdkAgents() {
    return SDK_AGENTS.map((a) => a.name);
}
