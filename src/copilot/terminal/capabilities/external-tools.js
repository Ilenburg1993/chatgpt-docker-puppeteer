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
 *     executionPolicy: string;
 *     exampleCommands: readonly string[];
 * }} TerminalExternalToolDefinition
 */

/**
 * @typedef {{
 *     id: string;
 *     label: string;
 *     commands: readonly string[];
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
 *     executionPolicy: string;
 *     exampleCommands: readonly string[];
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
        executionPolicy: 'somente com comando explícito, TTY exclusivo e fallback textual',
        exampleCommands: Object.freeze(['/menu picker --interactive']),
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
        executionPolicy: 'seleção explícita; preview embutido bloqueado até adapter sem shell livre',
        exampleCommands: Object.freeze(['/menu picker --interactive']),
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
        executionPolicy: 'preview read-only explícito; nunca pager automático',
        exampleCommands: Object.freeze(['/fs preview src/copilot/terminal/commands/terminal.js', '/fs read README.md --preview --plain']),
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
        executionPolicy: 'Markdown explícito por stdin; sem pager/TUI automática',
        exampleCommands: Object.freeze(['/fs preview README.md --markdown', '/fs read src/copilot/docs/terminal/TERMINAL_AUXILIARY_LIBS_DECISION_GUIDE_2026-06-04.md --preview --markdown --plain']),
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
        executionPolicy: 'diff explícito por stdin; diff bruto permanece canônico',
        exampleCommands: Object.freeze(['/git diff --plain', '/gh pr diff 123 --plain']),
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
        executionPolicy: 'adiado; não ler histórico externo, não instalar hooks e não sincronizar',
        exampleCommands: Object.freeze(['/terminal libs detail']),
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
        executionPolicy: 'adiado; não alterar cwd canônico nem consultar ranking pessoal por default',
        exampleCommands: Object.freeze(['/terminal libs detail']),
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
        executionPolicy: 'diagnóstico por stdin; parser JS continua fonte canônica',
        exampleCommands: Object.freeze(['/fs preview package.json --json', "/fs preview package.json --json --query '.scripts'"]),
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
        executionPolicy: 'preview/query por stdin com env/file ops bloqueadas; sem edição in-place automática',
        exampleCommands: Object.freeze(['/fs preview .github/workflows/ci.yml --yaml', "/fs preview .github/workflows/ci.yml --yaml --query '.jobs'"]),
    }),
]);

/** @type {TerminalExternalToolCapability[] | null} */
let cachedCapabilities = null;

const ESC = String.fromCharCode(27);
const BEL = String.fromCharCode(7);
const ANSI_ESCAPE_PATTERN = new RegExp(
    `${ESC}(?:\\[[0-?]*[ -/]*[@-~]|\\][^${BEL}]*(?:${BEL}|${ESC}\\\\)|[@-Z\\\\-_])`,
    'gu',
);
const MAX_DIAGNOSTIC_TEXT = 240;

/**
 * Normaliza saída externa para contratos JSON/log estáveis.
 *
 * Renderers visuais podem produzir ANSI para o TTY vivo, mas registry/smoke/diagnósticos nunca devem carregar
 * sequências de controle vindas de processos externos.
 *
 * @param {unknown} value
 * @param {{ max?: number }} [options]
 * @returns {string | null}
 */
export function sanitizeTerminalExternalToolDiagnostic(value, options = {}) {
    if (value === null || value === undefined) return null;
    const max = Math.max(16, Math.min(4_000, Math.trunc(options.max ?? MAX_DIAGNOSTIC_TEXT)));
    const clean = sanitizeTerminalExternalToolText(value, { max: Math.max(max * 4, max) })
        .split(/\r?\n/u)
        .map((line) => line.trim())
        .filter(Boolean)
        .join(' · ')
        .replace(/\s+/gu, ' ')
        .trim();
    if (!clean) return null;
    return clean.length <= max ? clean : `${clean.slice(0, max - 1)}…`;
}

/**
 * Remove ANSI e controles sem destruir quebras de linha significativas.
 *
 * @param {unknown} value
 * @param {{ max?: number }} [options]
 * @returns {string}
 */
export function sanitizeTerminalExternalToolText(value, options = {}) {
    const max = Math.max(16, Math.min(500_000, Math.trunc(options.max ?? 64_000)));
    const clean = String(value ?? '')
        .replace(ANSI_ESCAPE_PATTERN, '')
        .replace(/\r(?!\n)/gu, '\n')
        .split('')
        .filter((char) => {
            const code = char.charCodeAt(0);
            return !((code >= 0 && code <= 8) || code === 11 || code === 12 || (code >= 14 && code <= 31) || code === 127);
        })
        .join('');
    return clean.length <= max ? clean : `${clean.slice(0, max - 1)}…`;
}

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
    return sanitizeTerminalExternalToolDiagnostic(`${result.stdout ?? ''}${result.stderr ?? ''}`);
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
