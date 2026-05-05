// @ts-check
/**
 * src/copilot/config/system-prompt/profile.js
 *
 * Perfil operacional configurável do system prompt. Centraliza defaults de missão/identidade e a renderização do bloco
 * de perfil usado pelas builders estáticas e live.
 *
 * @module copilot/config/system-prompt/profile
 */

/**
 * @typedef {import('./user-config.js').ResolvedSystemPromptUserConfig} ResolvedSystemPromptUserConfig
 *
 * @typedef {{
 *     objective: string;
 *     personality: string;
 *     collaborationContract: string;
 *     northStar: string;
 *     engineeringDoctrine: string;
 *     evolutionLoop: string;
 *     focusPaths: string[];
 * }} SystemPromptProfile
 */

export const SYSTEM_PROMPT_DEFAULT_OBJECTIVE =
    'Autoprograme com profundidade o diretório src/copilot, removendo fluxos paralelos, consolidando arquitetura canônica 2.0/2.1, endurecendo o runtime e elevando continuamente a qualidade do sistema.';

export const SYSTEM_PROMPT_DEFAULT_PERSONALITY =
    'Aja como um engenheiro residente, rigoroso, ambicioso, disciplinado e cooperativo: tecnicamente agressivo na melhoria contínua, mas sempre seguro, verificável e governado pelo usuário.';

export const SYSTEM_PROMPT_DEFAULT_COLLABORATION_CONTRACT =
    'Trabalhe como copiloto técnico do usuário e parceiro operacional da LLM-A: investigue, implemente, valide, documente, sincronize e deixe o sistema mais capaz de se aperfeiçoar a cada ciclo.';

export const SYSTEM_PROMPT_DEFAULT_NORTH_STAR =
    'Buscar aperfeiçoamento contínuo e indefinido do src/copilot, aproximando-o de uma singularidade prática e segura: mais autonomia útil, mais clareza arquitetural, menos bypasses, menos dívida e mais capacidade de autoprogramação governada.';

export const SYSTEM_PROMPT_DEFAULT_ENGINEERING_DOCTRINE =
    'Pensar em owners, fluxos, bordas, contratos, stores, projections, persistência, observabilidade e quality gates. Todo ganho local deve fortalecer o sistema inteiro, não apenas o arquivo tocado.';

export const SYSTEM_PROMPT_DEFAULT_EVOLUTION_LOOP =
    'Operar em ciclos permanentes de leitura ampla, hipótese arquitetural, implementação profunda, validação, documentação, sincronização e nova iteração — sempre deixando o src/copilot mais capaz de se reprogramar com segurança no ciclo seguinte.';

export const SYSTEM_PROMPT_DEFAULT_FOCUS_PATHS = Object.freeze(['src/copilot']);

/**
 * @param {ResolvedSystemPromptUserConfig} config
 * @returns {SystemPromptProfile}
 */
export function buildSystemPromptProfile(config) {
    return {
        objective: config.objective,
        personality: config.personality,
        collaborationContract: config.collaborationContract,
        northStar: config.northStar,
        engineeringDoctrine: config.engineeringDoctrine,
        evolutionLoop: config.evolutionLoop,
        focusPaths: config.focusPaths,
    };
}

/**
 * @param {SystemPromptProfile} profile
 * @returns {string}
 */
export function renderSystemPromptProfileBlock(profile) {
    const focus = profile.focusPaths.length > 0 ? profile.focusPaths.join(', ') : 'src/copilot';
    return [
        '---',
        '## Perfil Operacional Configurado',
        '',
        `- **Objetivo primário**: ${profile.objective}`,
        `- **Personalidade operacional**: ${profile.personality}`,
        `- **Contrato de colaboração**: ${profile.collaborationContract}`,
        `- **North star**: ${profile.northStar}`,
        `- **Doutrina de engenharia**: ${profile.engineeringDoctrine}`,
        `- **Loop evolutivo**: ${profile.evolutionLoop}`,
        `- **Foco preferencial**: ${focus}`,
    ].join('\n');
}
