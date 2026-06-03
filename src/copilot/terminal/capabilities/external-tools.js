// @ts-check
/**
 * Registry read-only de ferramentas externas que podem enriquecer a UX do terminal.
 *
 * A camada detecta disponibilidade e versão sem tornar nenhuma ferramenta obrigatória. Adapters futuros devem consumir
 * este registry antes de abrir preview, picker, pager ou formatter externo.
 *
 * @module copilot/terminal/capabilities/external-tools
 */

import { accessSync, constants } from 'node:fs';
import { delimiter, extname, join } from 'node:path';
import { spawnSync } from 'node:child_process';

/** @typedef {'accepted' | 'accepted_guarded' | 'deferred'} TerminalExternalToolDecision */
/** @typedef {'picker' | 'preview' | 'markdown' | 'diff' | 'structured' | 'history' | 'navigation'} TerminalExternalToolUse */

/**
 * @typedef {{
 *     id: string;
 *     label: string;
 *     commands: readonly string[];
 *     decision: TerminalExternalToolDecision;
 *     defaultEnabled: boolean;
 *     uses: readonly TerminalExternalToolUse[];
 *     recommendedFor: string;
 *     fallback: string;
 *     risk: string;
 *     officialDocs: string;
 * }} TerminalExternalToolDefinition
 */

/**
 * @typedef {{
 *     id: string;
 *     label: string;
 *     command: string | null;
 *     path: string | null;
 *     available: boolean;
 *     version: string | null;
 *     decision: TerminalExternalToolDecision;
 *     defaultEnabled: boolean;
 *     uses: readonly TerminalExternalToolUse[];
 *     recommendedFor: string;
 *     fallback: string;
 *     risk: string;
 *     officialDocs: string;
 * }} TerminalExternalToolCapability
 */

/** @type {readonly TerminalExternalToolDefinition[]} */
export const TERMINAL_EXTERNAL_TOOL_DEFINITIONS = Object.freeze([
    Object.freeze({
        id: 'gum',
        label: 'Gum',
        commands: Object.freeze(['gum']),
        decision: 'accepted_guarded',
        defaultEnabled: false,
        uses: Object.freeze(/** @type {TerminalExternalToolUse[]} */ (['picker'])),
        recommendedFor: 'menus, confirmações e inputs explícitos quando o operador pedir uma TUI',
        fallback: 'menus textuais e chips atuais do terminal',
        risk: 'pode tomar o TTY e competir com prompt vivo se usado automaticamente',
        officialDocs: 'https://github.com/charmbracelet/gum',
    }),
    Object.freeze({
        id: 'fzf',
        label: 'fzf',
        commands: Object.freeze(['fzf']),
        decision: 'accepted',
        defaultEnabled: false,
        uses: Object.freeze(/** @type {TerminalExternalToolUse[]} */ (['picker'])),
        recommendedFor: 'seleção explícita de arquivos, contexto, sessões, modelos e resultados',
        fallback: 'listas numeradas e comandos atuais',
        risk: 'TUI interativa deve ser bloqueada durante streaming ou pergunta humana pendente',
        officialDocs: 'https://junegunn.github.io/fzf/',
    }),
    Object.freeze({
        id: 'bat',
        label: 'bat',
        commands: Object.freeze(['bat', 'batcat']),
        decision: 'accepted',
        defaultEnabled: false,
        uses: Object.freeze(/** @type {TerminalExternalToolUse[]} */ (['preview'])),
        recommendedFor: 'preview read-only com syntax highlighting e line numbers',
        fallback: 'preview textual JS com truncamento seguro',
        risk: 'arquivos grandes/binários precisam de limite e detecção antes de renderizar',
        officialDocs: 'https://github.com/sharkdp/bat',
    }),
    Object.freeze({
        id: 'glow',
        label: 'Glow',
        commands: Object.freeze(['glow']),
        decision: 'accepted',
        defaultEnabled: false,
        uses: Object.freeze(/** @type {TerminalExternalToolUse[]} */ (['markdown'])),
        recommendedFor: 'Markdown explícito em help, docs, planos e auditorias',
        fallback: 'Markdown em texto plano com seções compactas',
        risk: 'modo TUI/pager deve ser opt-in para não ocupar o prompt vivo',
        officialDocs: 'https://github.com/charmbracelet/glow',
    }),
    Object.freeze({
        id: 'delta',
        label: 'delta',
        commands: Object.freeze(['delta']),
        decision: 'accepted',
        defaultEnabled: false,
        uses: Object.freeze(/** @type {TerminalExternalToolUse[]} */ (['diff'])),
        recommendedFor: 'preview explícito de diffs Git, PRs e patches',
        fallback: 'diff bruto atual e resumo humano',
        risk: 'ANSI e paginação devem ficar fora de logs default',
        officialDocs: 'https://dandavison.github.io/delta/',
    }),
    Object.freeze({
        id: 'atuin',
        label: 'Atuin',
        commands: Object.freeze(['atuin']),
        decision: 'deferred',
        defaultEnabled: false,
        uses: Object.freeze(/** @type {TerminalExternalToolUse[]} */ (['history'])),
        recommendedFor: 'histórico pessoal do operador fora do produto',
        fallback: 'histórico próprio do terminal e ConversationHub',
        risk: 'altera histórico de shell, pode envolver sync e estado sensível do operador',
        officialDocs: 'https://docs.atuin.sh/',
    }),
    Object.freeze({
        id: 'zoxide',
        label: 'zoxide',
        commands: Object.freeze(['zoxide']),
        decision: 'deferred',
        defaultEnabled: false,
        uses: Object.freeze(/** @type {TerminalExternalToolUse[]} */ (['navigation'])),
        recommendedFor: 'navegação pessoal do operador fora do cwd canônico',
        fallback: 'workspace fixo e comandos explícitos do terminal',
        risk: 'depende de hooks de shell e pode conflitar com escopo/cwd controlado',
        officialDocs: 'https://github.com/ajeetdsouza/zoxide',
    }),
    Object.freeze({
        id: 'jq',
        label: 'jq',
        commands: Object.freeze(['jq']),
        decision: 'accepted',
        defaultEnabled: false,
        uses: Object.freeze(/** @type {TerminalExternalToolUse[]} */ (['structured'])),
        recommendedFor: 'filtros e pretty print JSON diagnósticos',
        fallback: 'JSON.stringify e parsers JS canônicos',
        risk: 'não deve virar fonte canônica paralela aos contratos JS',
        officialDocs: 'https://jqlang.org/',
    }),
    Object.freeze({
        id: 'yq',
        label: 'yq',
        commands: Object.freeze(['yq']),
        decision: 'accepted',
        defaultEnabled: false,
        uses: Object.freeze(/** @type {TerminalExternalToolUse[]} */ (['structured'])),
        recommendedFor: 'inspeção YAML/JSON/TOML/INI/XML/CSV em comandos explícitos',
        fallback: 'parsers JS/Node canônicos por formato',
        risk: 'edição mutável exige preview e confirmação explícitos',
        officialDocs: 'https://github.com/mikefarah/yq',
    }),
]);

/** @type {TerminalExternalToolCapability[] | null} */
let cachedCapabilities = null;

/**
 * @param {string} filePath
 * @returns {boolean}
 */
function isExecutable(filePath) {
    try {
        accessSync(filePath, constants.X_OK);
        return true;
    } catch {
        return false;
    }
}

/**
 * @param {string} command
 * @param {NodeJS.ProcessEnv} env
 * @returns {string | null}
 */
function findExecutablePath(command, env) {
    const pathValue = env['PATH'] ?? '';
    const pathExt = process.platform === 'win32' ? (env['PATHEXT'] ?? '.EXE;.CMD;.BAT;.COM') : '';
    const extensions =
        process.platform === 'win32' && !extname(command)
            ? pathExt
                  .split(';')
                  .map((ext) => ext.trim())
                  .filter(Boolean)
            : [''];
    for (const dir of pathValue.split(delimiter)) {
        if (!dir) continue;
        for (const ext of extensions) {
            const candidate = join(dir, `${command}${ext}`);
            if (isExecutable(candidate)) return candidate;
        }
    }
    return null;
}

/**
 * @param {string} command
 * @param {NodeJS.ProcessEnv} env
 * @returns {string | null}
 */
function readToolVersion(command, env) {
    const result = spawnSync(command, ['--version'], {
        encoding: 'utf8',
        env,
        maxBuffer: 256 * 1024,
        timeout: 1_500,
        windowsHide: true,
    });
    const output = `${result.stdout ?? ''}${result.stderr ?? ''}`
        .split(/\r?\n/u)
        .map((line) => line.trim())
        .find(Boolean);
    return output ?? null;
}

/**
 * @param {TerminalExternalToolDefinition} definition
 * @param {NodeJS.ProcessEnv} env
 * @returns {TerminalExternalToolCapability}
 */
function detectExternalTool(definition, env) {
    for (const command of definition.commands) {
        const path = findExecutablePath(command, env);
        if (!path) continue;
        return {
            ...definition,
            command,
            path,
            available: true,
            version: readToolVersion(command, env),
        };
    }
    return {
        ...definition,
        command: null,
        path: null,
        available: false,
        version: null,
    };
}

/**
 * @param {{ env?: NodeJS.ProcessEnv; refresh?: boolean }} [options]
 * @returns {TerminalExternalToolCapability[]}
 */
export function readTerminalExternalToolCapabilities(options = {}) {
    if (!options.refresh && options.env === undefined && cachedCapabilities !== null) return cachedCapabilities;
    const env = options.env ?? process.env;
    const capabilities = TERMINAL_EXTERNAL_TOOL_DEFINITIONS.map((definition) => detectExternalTool(definition, env));
    if (options.env === undefined) cachedCapabilities = capabilities;
    return capabilities;
}

/**
 * @param {{ env?: NodeJS.ProcessEnv; refresh?: boolean }} [options]
 * @returns {{
 *     total: number;
 *     available: number;
 *     acceptedAvailable: number;
 *     guardedAvailable: number;
 *     deferredAvailable: number;
 *     tools: TerminalExternalToolCapability[];
 * }}
 */
export function readTerminalExternalToolCapabilitySummary(options = {}) {
    const tools = readTerminalExternalToolCapabilities(options);
    return {
        total: tools.length,
        available: tools.filter((tool) => tool.available).length,
        acceptedAvailable: tools.filter((tool) => tool.available && tool.decision === 'accepted').length,
        guardedAvailable: tools.filter((tool) => tool.available && tool.decision === 'accepted_guarded').length,
        deferredAvailable: tools.filter((tool) => tool.available && tool.decision === 'deferred').length,
        tools,
    };
}

/**
 * @returns {void}
 */
export function clearTerminalExternalToolCapabilityCache() {
    cachedCapabilities = null;
}
