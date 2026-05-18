// @ts-check
import { ConfigError } from '#copilot/core';
import { COPILOT_CUSTOM_AGENTS, COPILOT_DISABLED_AGENTS, COPILOT_OPERATIONAL_PROFILE } from './env.js';
import { resolveOperationalAgentSelection } from './operational-profiles.js';
/**
 * src/copilot/config/custom-agents.js
 *
 * Factory de agentes customizados pré-configurados. Define perfis de agente com conjuntos de ferramentas e prompts
 * especializados para tarefas específicas.
 *
 * Regras de nomeação: agentes são referenciados pelo modo `@nome` no REPL/terminal.
 *
 * @module copilot/config/custom-agents
 * @see EventBus
 * @see module:copilot/lib/agents
 * @see module:copilot/session-initializer
 */

export const MAESTRO_AGENT_NAME = 'agent-full';

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
            tools: ['list_directory', 'search_in_files', 'read_file_content'],
            infer: true,
            prompt: `Você é um auditor de código especializado.
Sua função é analisar código-fonte, identificar problemas de qualidade, segurança e conformidade,
e produzir relatórios estruturados.

Regras operacionais:
- NUNCA modifique arquivos — apenas leia e analise
- Cite sempre o arquivo:linha de cada ocorrência encontrada
- Classifique problemas como: CRÍTICO | ALTO | MÉDIO | BAIXO | INFO
- Finalize com um resumo executivo com contadores por severidade
- Use search_in_files para buscas textuais e list_directory para descoberta de arquivos`,
        },
    ],
    [
        'docs',
        {
            name: 'docs',
            description: 'Agente de documentação — lê código e gera/atualiza JSDoc, README e comentários',
            tools: ['read_file_content', 'list_directory'],
            infer: true,
            prompt: `Você é um especialista em documentação técnica de software.
Sua função é ler código-fonte e gerar documentação clara, precisa e bem estruturada.

Regras operacionais:
- Produza JSDoc completo: @param, @returns, @throws, @example quando relevante
- Use tipagem explícita em todos os @param e @returns
- Para READMEs: estruture com seções padrão (Visão geral, Instalação, Uso, API, Contribuição)
- Mantenha português técnico preciso mas acessível
- Não invente comportamentos — documente apenas o que o código faz`,
        },
    ],
    [
        'reviewer',
        {
            name: 'reviewer',
            description: 'Agente de revisão de PR — analisa diff e produz comentários de revisão',
            tools: ['list_directory', 'search_in_files', 'read_file_content'],
            infer: true,
            prompt: `Você é um revisor de código experiente.
Analise alterações de código com foco em:
1. Corretude lógica e casos limite
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
 * Registra ou sobrescreve um agente customizado em tempo de execução. Útil para testes e extensão dinâmica sem
 * reinicialização.
 *
 * @param {CustomAgentConfig} config
 * @returns {void}
 * @throws {ConfigError} Se config.name, config.description, config.tools ou config.prompt forem inválidos
 */
export function registerCustomAgent(config) {
    if (!config?.name || typeof config.name !== 'string') {
        throw new ConfigError('CustomAgentConfig.name deve ser string não-vazia');
    }
    if (typeof config.description !== 'string' || !config.description) {
        throw new ConfigError('CustomAgentConfig.description deve ser string não-vazia');
    }
    if (!Array.isArray(config.tools) || config.tools.some((t) => typeof t !== 'string')) {
        throw new ConfigError('CustomAgentConfig.tools deve ser string[]');
    }
    if (typeof config.prompt !== 'string') {
        throw new ConfigError('CustomAgentConfig.prompt deve ser string');
    }
    BUILTIN_AGENTS.set(config.name, config);
}

/**
 * Remove um agente customizado pelo nome. Agentes built-in podem ser removidos (operação destrutiva, não reversível em
 * tempo de execução).
 *
 * @param {string} name - Nome do agente, sem at-sign no prefixo
 * @returns {boolean} true se existia e foi removido
 */
export function removeCustomAgent(name) {
    return BUILTIN_AGENTS.delete(name);
}

// ---------------------------------------------------------------------------
// Integração SDK — CustomAgentConfig para SessionConfig.customAgents
// ---------------------------------------------------------------------------

/**
 * Configuração estrutural compatível com `SessionConfig.customAgents` do SDK.
 *
 * `config/` não importa tipos do envoltório interno do tempo de execução; quando o agente montar a sessão, o adaptador
 * SDK valida esse objeto contra o SDK canônico.
 *
 * @typedef {object} SdkCustomAgentConfig
 * @property {string} name
 * @property {string} [displayName]
 * @property {string} [description]
 * @property {string[] | null | undefined} [tools]
 * @property {{ must?: string[]; should?: string[]; optional?: string[] }} [toolTiers]
 * @property {string} prompt
 * @property {Record<string, import('./sdk-config-port.js').MCPServerConfig>} [mcpServers]
 * @property {boolean} [infer]
 * @property {string[]} [skills]
 * @property {'maestro'} [priority]
 */

/**
 * Definições de custom agents no formato aceito pelo SDK (`SessionConfig.customAgents`).
 *
 * Importante: `customAgents` são definições declarativas de sessão. Em tempo de execução, quando o runtime seleciona
 * ou delega para um desses agentes, ele passa a aparecer na telemetria/eventos como `subagent.*`.
 *
 * Em outras palavras:
 * - `custom agent` = configuração anexada à sessão;
 * - `sub-agent` = manifestação runtime de um custom agent selecionado/invocado pelo orchestrator.
 *
 * Eles diferem dos agentes internos (`BUILTIN_AGENTS`) usados pelo REPL/terminal local.
 *
 * @type {SdkCustomAgentConfig[]}
 */
const SDK_AGENTS = [
    {
        name: MAESTRO_AGENT_NAME,
        displayName: 'Maestro (orquestrador com acesso total)',
        description:
            'Agente maestro com acesso total: coordena operações complexas, delega a especialistas e mantém o contexto operacional.',
        tools: null,
        priority: 'maestro',
        prompt: `Você é o maestro de orquestração desta base de código Node.js. Você tem acesso total e irrestrito a todas as ferramentas e capacidades registradas na sessão SDK.

CAPACIDADES SDK SOB SEU COMANDO:
1. Seleção de modelo: você pode solicitar troca de modelo quando a tarefa exigir raciocínio mais profundo ou resposta mais rápida.
2. Esforço de raciocínio: você pode operar com esforço baixo, médio, alto ou xhigh conforme a complexidade.
3. Transmissão incremental: você deve manter feedback incremental e claro durante tarefas longas.
4. Sessões infinitas: seu contexto persiste entre retomadas; preserve continuidade operacional.
5. Habilidades: use skills carregadas em skillDirectories quando elas forem relevantes.
6. Ferramentas customizadas: você tem acesso total a todas as ferramentas registradas, inclusive arquivo, workspace, git, npm, shell, hub, sessão, permissões, escopos e índice.
7. MCP: você pode usar todos os servidores MCP configurados na sessão.
8. Auditoria de permissões: avalie risco de forma explícita e escale decisões incertas.
9. Hooks e interceptadores: respeite a auditoria de pré/pós-ferramenta e reporte decisões de risco.
10. Sistema de arquivos de sessão: use validação normalizada de caminhos e prefira ferramentas canônicas.
11. Delegação: você pode delegar a especialistas, mas permanece sempre no comando.
12. Execução assíncrona: acompanhe processos e tarefas em segundo plano até o fechamento.
13. Modos de sessão: use session_mode_set quando planejamento, revisão ou execução contínua forem necessários.

PAPEL:
- Orquestrar tarefas complexas em etapas verificáveis.
- Delegar a especialistas sem abandonar o controle: explore, task, diagnostic, planner, git-ops e shell-ops são auxiliares.
- Monitorar progresso, integrar resultados e decidir próximos passos.
- Manter contexto entre delegações e sintetizar evidências.
- Escalar riscos de segurança, ambiguidades reais e decisões de produto.
- Auditar operações sensíveis e preservar os fluxos canônicos do projeto.

ÁRVORE DE DELEGAÇÃO:
1. Exploração de código, busca e leitura: delegue a explore.
2. Execução de testes, compilações, lint e comandos: delegue a task ou shell-ops.
3. Git, diff, branch, commit e push: delegue a git-ops.
4. Saúde, logs, PM2, portas e ambiente: delegue a diagnostic.
5. Planejamento complexo: delegue a planner.
6. Síntese, arquitetura, aprovação e integração: resolva diretamente como maestro.

REGRAS:
- O maestro nunca deve sair do comando nem se deselecionar.
- Antes de delegar, valide se a ferramenta necessária existe na sessão.
- Use nomes canônicos de ferramentas; aliases legados são apenas compatibilidade.
- Registre intenção para operações arriscadas sempre que a ferramenta de intenção estiver disponível.
- Reporte o resultado de cada delegação e integre a conclusão ao plano.
- Não crie fluxos paralelos quando já houver fluxo canônico.
- Preserve invariantes: sem operações críticas concorrentes sobre o mesmo estado, sem retorno alternativo silencioso e sem escrita fora do escopo.`,
        infer: true,
    },
    {
        name: 'task',
        displayName: 'Executor de tarefas',
        description: 'Executa testes, compilações, linters e comandos de desenvolvimento com relatório objetivo.',
        tools: ['exec_command', 'run_npm_script', 'run_node_file', 'lint_check', 'run_tests', 'typecheck'],
        toolTiers: {
            must: ['exec_command', 'run_npm_script', 'run_node_file'],
            should: ['lint_check', 'run_tests', 'typecheck'],
        },
        prompt: `Você é um agente executor de comandos de desenvolvimento.

Execute testes, compilações, lint, typecheck, scripts npm e comandos pontuais autorizados.

Formato obrigatório:
- SUCESSO: resumo em uma linha.
- FALHA: saída completa relevante, incluindo rastros de pilha.
- Não corrija erros por conta própria; execute e reporte.
- Não repita comando em falha sem instrução do maestro.`,
        infer: true,
    },
    {
        name: 'explore',
        displayName: 'Explorador de base de código',
        description: 'Exploração rápida de base de código com ferramentas canônicas de arquivo, índice e escopo.',
        tools: [
            'list_directory',
            'read_file_content',
            'search_in_files',
            'workspace_symbol_search',
            'workspace_index_build',
            'workspace_index_search',
            'workspace_index_find_symbol',
            'workspace_scope_context',
            'workspace_scope_find_symbol',
            'workspace_scope_list',
            // compatibilidade legada para ambientes onde os nomes canônicos não estão disponíveis
            'grep',
            'glob',
            'view',
            'str_replace_editor',
            'bash',
        ],
        toolTiers: {
            must: ['list_directory', 'read_file_content', 'search_in_files'],
            should: [
                'workspace_symbol_search',
                'workspace_index_build',
                'workspace_index_search',
                'workspace_index_find_symbol',
                'workspace_scope_context',
                'workspace_scope_find_symbol',
                'workspace_scope_list',
            ],
            optional: ['grep', 'glob', 'view', 'str_replace_editor', 'bash'],
        },
        prompt: `Você é um agente de exploração especializado em análise rápida de base de código.

Use primeiro as ferramentas canônicas: list_directory, read_file_content, search_in_files,
workspace_symbol_search, workspace_index_* e workspace_scope_*.
Use aliases legados somente como compatibilidade.

Regra crítica: maximize chamadas paralelas para leituras independentes.
Responda de forma curta em perguntas simples e cite arquivo:linha sempre que possível.`,
        infer: true,
    },
    {
        name: 'diagnostic',
        displayName: 'Diagnóstico de sistema',
        description: 'Diagnóstico de sistema: PM2, verificações de saúde, portas e logs. Somente leitura.',
        tools: [
            'exec_command',
            'get_system_health',
            'search_in_files',
            'list_directory',
            'workspace_scope_context',
            'grep',
            'glob',
        ],
        toolTiers: {
            must: ['exec_command', 'get_system_health'],
            should: ['search_in_files', 'list_directory', 'workspace_scope_context'],
            optional: ['grep', 'glob'],
        },
        prompt: `Você é um agente de diagnóstico de sistema para este projeto Node.js.

Capacidades: status PM2, verificações de saúde, inspeção de portas, análise de logs, filas e ambiente.

Formato: seções OK / AVISO / ERRO com valores concretos e PIDs quando houver.
Destaque problemas críticos. Sugira correções, mas não as execute sem ordem do maestro.`,
        infer: true,
    },
    {
        name: 'planner',
        displayName: 'Agente planejador',
        description: 'Estrutura planos detalhados de execução antes de agir. Ideal para tarefas complexas multi-etapa.',
        tools: [
            'session_mode_set',
            'session_plan_read',
            'session_plan_update',
            'get_tasks',
            'add_task',
            'list_directory',
            'search_in_files',
            'workspace_scope_context',
            // compatibilidade legada
            'grep',
            'glob',
        ],
        toolTiers: {
            must: ['session_mode_set', 'session_plan_read', 'session_plan_update'],
            should: ['get_tasks', 'add_task', 'list_directory', 'search_in_files', 'workspace_scope_context'],
            optional: ['grep', 'glob'],
        },
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
        displayName: 'Agente de operações Git',
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
        toolTiers: {
            must: ['git_status', 'git_diff', 'git_changed_files', 'git_log'],
            should: ['git_create_branch', 'git_commit', 'git_push', 'report_intent'],
        },
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
        displayName: 'Agente de operações de shell',
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
        toolTiers: {
            must: ['exec_command', 'run_npm_script', 'run_node_file'],
            should: ['lint_check', 'run_tests', 'typecheck', 'get_system_health', 'report_intent'],
        },
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
 * Nomes dos agentes SDK habilitados por padrão.
 *
 * Pode ser sobrescrito via `COPILOT_CUSTOM_AGENTS=task,explore,diagnostic` (CSV).
 *
 * @type {ReturnType<typeof resolveOperationalAgentSelection>}
 */
const DEFAULT_AGENT_SELECTION = resolveOperationalAgentSelection({
    profileName: COPILOT_OPERATIONAL_PROFILE,
    customAgentsCsv: COPILOT_CUSTOM_AGENTS,
    disabledAgentsCsv: COPILOT_DISABLED_AGENTS,
});

const DEFAULT_SDK_AGENTS = enforceMaestroFirst(DEFAULT_AGENT_SELECTION.enabled);

// GAP-Q03 fix: COPILOT_DISABLED_AGENTS permite desabilitar custom agents da sessão sem removê-los de
// COPILOT_CUSTOM_AGENTS. Se um agente desabilitado não entrar em `customAgents`, ele também não poderá aparecer como
// `subagent.*` em tempo de execução.
const DISABLED_AGENTS = new Set(DEFAULT_AGENT_SELECTION.disabled.filter((name) => name !== MAESTRO_AGENT_NAME));

/**
 * Constrói o array `customAgents` para injetar em `SessionConfig.customAgents`.
 *
 * @param {string[]} [enabled] - Nomes dos agentes a incluir. Padrão: DEFAULT_SDK_AGENTS.
 * @returns {SdkCustomAgentConfig[]} Array de agentes; o maestro é sempre preservado.
 */
export function buildCustomAgentsConfig(enabled = DEFAULT_SDK_AGENTS) {
    const enabledSet = new Set(enforceMaestroFirst(enabled));
    const agents = SDK_AGENTS.filter((a) => enabledSet.has(a.name) && !DISABLED_AGENTS.has(a.name));
    return agents;
}

/**
 * Lista os nomes dos agentes SDK disponíveis para SessionConfig.
 *
 * @returns {string[]}
 */
export function listAvailableSdkAgents() {
    return SDK_AGENTS.map((a) => a.name);
}

/**
 * Retorna a seleção efetiva de agentes SDK após perfil operacional e env CSV.
 *
 * @returns {{ profile: string; enabled: string[]; disabled: string[] }}
 */
export function getEffectiveSdkAgentSelection() {
    return {
        profile: DEFAULT_AGENT_SELECTION.profile.name,
        enabled: [...DEFAULT_SDK_AGENTS],
        disabled: [...DISABLED_AGENTS],
    };
}

/**
 * Garante que o maestro esteja sempre presente e sempre na primeira posição.
 *
 * @param {string[]} names
 * @returns {string[]}
 */
function enforceMaestroFirst(names) {
    return [MAESTRO_AGENT_NAME, ...names.filter((name) => name && name !== MAESTRO_AGENT_NAME)];
}
