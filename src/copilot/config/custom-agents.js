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
