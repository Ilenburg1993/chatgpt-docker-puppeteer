// @ts-check
/**
 * src/copilot/config/operational-profiles.js
 *
 * Perfis operacionais canônicos para `SessionConfig.customAgents`.
 *
 * O contrato continua com prioridade ao SDK: este módulo não cria outro tempo de execução de agentes. Ele apenas
 * resolve quais `customAgents` entram na sessão SDK e quais listas globais de negação/permissão devem ser aplicadas
 * pelas políticas existentes.
 *
 * @module copilot/config/operational-profiles
 */

/**
 * @typedef {object} OperationalProfile
 * @property {string} name
 * @property {string} displayName
 * @property {string} description
 * @property {string[]} customAgents
 * @property {string[]} disabledAgents
 * @property {string[]} globalDenylist
 * @property {string[] | null} globalAllowlist
 */

/**
 * @type {Record<string, OperationalProfile>}
 */
export const OPERATIONAL_PROFILES = Object.freeze({
    production: {
        name: 'production',
        displayName: 'Produção',
        description: 'Suíte completa de agentes customizados SDK com o maestro de acesso total em primeiro lugar.',
        customAgents: ['agent-full', 'explore', 'diagnostic', 'planner', 'task', 'git-ops', 'shell-ops'],
        disabledAgents: [],
        globalDenylist: [],
        globalAllowlist: null,
    },
    terminal_light: {
        name: 'terminal_light',
        displayName: 'Terminal leve',
        description: 'Perfil rápido de terminal que mantém o maestro e o trio mínimo de execução/planejamento.',
        customAgents: ['agent-full', 'task', 'planner', 'diagnostic'],
        disabledAgents: ['explore', 'git-ops', 'shell-ops'],
        globalDenylist: [],
        globalAllowlist: null,
    },
    debug: {
        name: 'debug',
        displayName: 'Debug',
        description: 'Perfil de investigação profunda com todos os agentes customizados SDK embarcados habilitados.',
        customAgents: ['agent-full', 'explore', 'diagnostic', 'planner', 'task', 'git-ops', 'shell-ops'],
        disabledAgents: [],
        globalDenylist: [],
        globalAllowlist: null,
    },
    cicd_safe: {
        name: 'cicd_safe',
        displayName: 'CI/CD seguro',
        description: 'Perfil focado em leitura que evita escritas git e automação irrestrita de shell.',
        customAgents: ['agent-full', 'explore', 'diagnostic', 'planner'],
        disabledAgents: ['git-ops', 'shell-ops'],
        globalDenylist: ['git_commit', 'git_push', 'git_create_branch', 'exec_command'],
        globalAllowlist: null,
    },
});

/**
 * @param {string | null | undefined} profileName
 * @returns {OperationalProfile}
 */
export function loadOperationalProfile(profileName = 'production') {
    const normalized = profileName && profileName.trim() ? profileName.trim() : 'production';
    const profile = OPERATIONAL_PROFILES[normalized];
    if (!profile) {
        const known = Object.keys(OPERATIONAL_PROFILES).join(', ');
        throw new Error(`COPILOT_OPERATIONAL_PROFILE desconhecido "${normalized}". Perfis conhecidos: ${known}`);
    }
    return profile;
}

/**
 * Resolve a seleção efetiva de agentes preservando compatibilidade com env CSV explícito.
 *
 * @param {object} input
 * @param {string | undefined} input.profileName
 * @param {string | undefined} input.customAgentsCsv
 * @param {string | undefined} input.disabledAgentsCsv
 * @returns {{ profile: OperationalProfile; enabled: string[]; disabled: string[] }}
 */
export function resolveOperationalAgentSelection({ profileName, customAgentsCsv, disabledAgentsCsv }) {
    const profile = loadOperationalProfile(profileName || 'production');
    const enabled = csvToList(customAgentsCsv);
    const disabled = csvToList(disabledAgentsCsv);
    return {
        profile,
        enabled: enabled.length > 0 ? enabled : [...profile.customAgents],
        disabled: disabled.length > 0 ? disabled : [...profile.disabledAgents],
    };
}

/**
 * @param {string | undefined} csv
 * @returns {string[]}
 */
function csvToList(csv) {
    return String(csv || '')
        .split(',')
        .map((v) => v.trim())
        .filter(Boolean);
}
