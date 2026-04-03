// @ts-check
/**
 * src/copilot/config/system-prompt.js
 *
 * Definições e builders de system prompt para o agente LLM-B Always-Alive.
 *
 * Provê dois modos de construção:
 *
 * 1. `buildAppendSystemMessage(content)` — usa `mode: "append"` do SDK v0.1.32 para adicionar instruções ao system message
 *    gerenciado pelo SDK.
 * 2. `buildReplaceSystemMessage(sections)` — usa `mode: "replace"` para controle total. Substitui inteiramente o system
 *    message; use apenas quando controle completo for necessário.
 *
 * Preparado para migração futura para `mode: "customize"` (=SDK v0.2.0) via constantes `SYSTEM_PROMPT_SECTIONS`.
 *
 * @module copilot/config/system-prompt
 */

/**
 * @typedef {import('@github/copilot-sdk').SystemMessageConfig} SystemMessageConfig
 */
import { SYSTEM_PROMPT_SECTIONS as SDK_SECTIONS } from '@github/copilot-sdk';

// ─────────────────────────────────────────────────────────────────────────────
// Constantes de identidade e instruções do LLM-B
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Metadados das seções do system prompt — re-exportados do SDK v0.2.0. Cada valor é `{ description: string }`; a chave
 * é o nome da seção (ex.: `'guidelines'`).
 *
 * @type {import('@github/copilot-sdk').SystemPromptSection extends infer K
 *     ? K extends string
 *         ? Record<K, { description: string }>
 *         : never
 *     : never}
 */
export const SYSTEM_PROMPT_SECTIONS = /** @type {Record<string, { description: string }>} */ (SDK_SECTIONS);

// C12-03: verificar em runtime se SDK suporta mode:'customize' (v0.2.0+)
const _sdkSupportsCustomize = typeof SDK_SECTIONS === 'object' && SDK_SECTIONS !== null && 'guidelines' in SDK_SECTIONS;

/**
 * Identidade do agente LLM-B.
 *
 * @type {string}
 */
export const AGENT_IDENTITY = `\
Você é LLM-B (Always-Alive Agent), um agente autônomo de desenvolvimento de software operando no repositório \
chatgpt-docker-puppeteer. Você executa missões de longa duração com automação de browser, arquitetura orientada \
a eventos e foco em confiabilidade operacional.

Tecnologias principais: Node.js 24+ ESM, Puppeteer, NERV event bus, Express/Socket.io, PM2, TypeScript via JSDoc.`;

/**
 * Estilo e tom de comunicação do agente.
 *
 * @type {string}
 */
export const AGENT_TONE = `\
Comunique-se em pt-BR. Seja objetivo, técnico e preciso. \
Prefira respostas concisas exceto quando explicação detalhada for necessária. \
Use Markdown para estruturar respostas longas.`;

/**
 * Diretrizes de uso eficiente de tools.
 *
 * @type {string}
 */
export const TOOL_EFFICIENCY = `\
- Execute múltiplas ferramentas independentes em paralelo quando possível.
- Prefira leitura de contexto antes de modificações.
- Use as tools de filesystem (read_file_content, list_directory, search_in_files) para explorar antes de editar.
- Use run_npm_script para validar qualidade antes de commitar.
- Agrupe operações relacionadas em um único turno para minimizar latência.`;

/**
 * Contexto do ambiente de desenvolvimento.
 *
 * @type {string}
 */
export const ENVIRONMENT_CONTEXT = `\
Ambiente: DevContainer Debian 12, Node.js v24.x, VS Code Copilot Chat.
Workspace: /workspaces/chatgpt-docker-puppeteer
Estrutura: src/core/, src/nerv/, src/kernel/, src/orchestrator/, src/agent/, src/driver/, src/infra/, src/server/, src/missions/
Ferramentas CLI disponíveis: rg, fd, bat, delta, gh, jq, yq, sd, dust, xh, shellcheck, hyperfine.
Scripts npm: lint, format:check, test:unit, test:fast, typecheck:node, audit:quick, analyze:deps, diagnose, health:core.`;

/**
 * Regras para mudanças de código.
 *
 * @type {string}
 */
export const CODE_CHANGE_RULES = `\
- Mantenha ESM (import/export). Não use require() sem justificativa excepcional.
- Estilo: 4 espaços, 120 colunas, aspas simples, ponto-e-vírgula.
- JSDoc robusto em toda exportação pública (@param, @returns, @throws).
- Prefira aliases (#core/*, #infra/*, #driver/*) a caminhos relativos profundos.
- Não introduza puppeteer.launch() — use o Chrome externo via DevTools existente.
- Rode npm run lint e npm run typecheck:node antes de qualquer commit.`;

/**
 * Diretrizes gerais do agente.
 *
 * @type {string}
 */
export const AGENT_GUIDELINES = `\
- Siga o Protocolo de Hooks (.github/instructions/hooks-protocol.instructions.md).
- Encerre cada turno com vscode_askQuestions (Template A ou G).
- Use manage_todo_list para planejar e acompanhar tarefas.
- Leia session-briefing.md no início de cada sessão.
- Não encerre SESSION sem Template F + close_key autorizada pelo usuário.`;

/**
 * Instruções de final de turno (alta precedência — executadas por último pelo modelo).
 *
 * @type {string}
 */
export const LAST_INSTRUCTIONS = `\
Antes de encerrar este turno:
1. Confirme que manage_todo_list está atualizado com todos os TODOs completados.
2. Chame vscode_askQuestions com o template apropriado (A para continuação, G para commit/push).
3. NÃO chame task_complete se vscode_askQuestions ainda não foi chamado neste turno.`;

// ─────────────────────────────────────────────────────────────────────────────
// Builders de SystemMessageConfig
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Constrói um `SystemMessageConfig` no modo `"customize"` com appendment na seção `guidelines`.
 *
 * SDK-03: usa a API de sections nomeadas do SDK v0.2.0 para granularidade máxima no contexto de hooks/sessão.
 *
 * @param {string} content - Conteúdo a ser adicionado na seção guidelines
 * @returns {SystemMessageConfig}
 */
export function buildGuidelinesAppendMessage(content) {
    // C12-03: fallback para mode:'append' se SDK não suportar mode:'customize' (v0.2.0+)
    if (!_sdkSupportsCustomize) {
        return /** @type {SystemMessageConfig} */ ({
            mode: 'append',
            content,
        });
    }
    // As chaves de sections são strings (ex.: 'guidelines'), não os objetos { description }
    return /** @type {SystemMessageConfig} */ ({
        mode: 'customize',
        sections: {
            guidelines: { action: 'append', content },
        },
    });
}

/**
 * Constrói um `SystemMessageConfig` no modo `"append"`.
 *
 * Adiciona instruções ao system message gerenciado pelo SDK, sem substituir o comportamento padrão. É o modo mais
 * seguro para adicionar contexto sem perder as guardrails do SDK.
 *
 * @param {string} content - Texto a ser adicionado após as seções gerenciadas pelo SDK
 * @returns {SystemMessageConfig}
 */
export function buildAppendSystemMessage(content) {
    return /** @type {SystemMessageConfig} */ ({
        mode: 'append',
        content,
    });
}

/**
 * Constrói um `SystemMessageConfig` no modo `"replace"`.
 *
 * Substitui inteiramente o system message do SDK. Use apenas quando controle completo for necessário. ⚠️ Remove todas
 * as guardrails de segurança do SDK ao usar este modo.
 *
 * @param {string} content - System message completo
 * @returns {SystemMessageConfig}
 */
export function buildReplaceSystemMessage(content) {
    return /** @type {SystemMessageConfig} */ ({
        mode: 'replace',
        content,
    });
}

/**
 * Constrói o system message completo do LLM-B no modo `"replace"` com todas as seções organizadas.
 *
 * Inclui identidade, tom, diretrizes de tools, contexto do ambiente, regras de código, diretrizes gerais e instruções
 * de final de turno.
 *
 * @param {object} [opts={}] Default is `{}`
 * @param {string} [opts.extraContext=''] - Contexto adicional (ex: hook system briefing). Default is `''`
 * @returns {SystemMessageConfig}
 */
export function buildAlwaysAliveSystemMessage(opts = {}) {
    const { extraContext = '' } = /** @type {{ extraContext?: string }} */ (opts);

    const sections = [
        `# Identidade\n\n${AGENT_IDENTITY}`,
        `# Tom e Comunicação\n\n${AGENT_TONE}`,
        `# Eficiência com Tools\n\n${TOOL_EFFICIENCY}`,
        `# Contexto do Ambiente\n\n${ENVIRONMENT_CONTEXT}`,
        `# Regras para Mudanças de Código\n\n${CODE_CHANGE_RULES}`,
        `# Diretrizes Gerais\n\n${AGENT_GUIDELINES}`,
    ];

    if (extraContext) {
        sections.push(`# Contexto Operacional Atual\n\n${extraContext}`);
    }

    sections.push(`# Instruções Finais do Turno\n\n${LAST_INSTRUCTIONS}`);

    return buildReplaceSystemMessage(sections.join('\n\n---\n\n'));
}

/**
 * Constrói um system message de append com apenas o contexto do hook system.
 *
 * Opção mais segura (preserva guardrails do SDK) para injetar o briefing operacional.
 *
 * @param {string} hookContext - Conteúdo do session-briefing.md + estado de compliance
 * @returns {SystemMessageConfig}
 */
export function buildHookContextAppendMessage(hookContext) {
    if (!hookContext) return buildAppendSystemMessage('');

    // SDK-03: usa sections.guidelines (mode:'customize') para granularidade no SDK v0.2.0
    return buildGuidelinesAppendMessage(
        [
            '---',
            '## Contexto Operacional do Hook System',
            '',
            hookContext,
            '',
            '**Lembre-se**: Encerre este turno com `vscode_askQuestions`. Não chame `task_complete` sem isso.',
        ].join('\n'),
    );
}
