// @ts-check
/**
 * Canonical model-gateway command inventory.
 *
 * This is documentation-as-data for humans, LLM agents, package scripts, Makefile targets and the terminal cockpit.
 * Commands listed here are intentionally pre-build: they prepare, inspect and validate the gateway before the first
 * full build is promoted as an operator workflow.
 *
 * @module copilot/model-gateway/commands/canonical-commands
 */

export const MODEL_GATEWAY_CANONICAL_COMMAND_TRACK = 'Y';

export const MODEL_GATEWAY_CANONICAL_COMMANDS = Object.freeze([
    {
        id: 'commands.text',
        phase: 'orientation',
        surface: 'package',
        command: 'npm run model-gateway:commands',
        summary: 'List canonical model-gateway commands for humans and LLMs.',
    },
    {
        id: 'commands.json',
        phase: 'orientation',
        surface: 'package',
        command: 'npm run model-gateway:commands:json',
        summary: 'Emit the canonical command inventory as JSON.',
    },
    {
        id: 'lint.scoped',
        phase: 'validate',
        surface: 'package',
        command: 'npm run model-gateway:lint',
        summary: 'Run ESLint on the model-gateway, BYOK terminal command and focused tests.',
    },
    {
        id: 'typecheck.strict',
        phase: 'validate',
        surface: 'package',
        command: 'npm run model-gateway:typecheck',
        summary: 'Run strict typecheck for src/copilot.',
    },
    {
        id: 'test.contracts',
        phase: 'validate',
        surface: 'package',
        command: 'npm run model-gateway:test:contracts',
        summary: 'Run the model-gateway contract unit suite.',
    },
    {
        id: 'test.terminal',
        phase: 'validate',
        surface: 'package',
        command: 'npm run model-gateway:test:terminal',
        summary: 'Run the BYOK terminal command unit suite.',
    },
    {
        id: 'validate.prebuild',
        phase: 'prebuild',
        surface: 'package',
        command: 'npm run model-gateway:validate',
        summary: 'Run the canonical scoped validation set before build preparation.',
    },
    {
        id: 'prebuild.all',
        phase: 'prebuild',
        surface: 'package',
        command: 'npm run model-gateway:prebuild',
        summary: 'Print command inventory and run all scoped pre-build validators.',
    },
    {
        id: 'make.commands',
        phase: 'orientation',
        surface: 'make',
        command: 'make model-gateway-commands',
        summary: 'Makefile alias for the canonical command inventory.',
    },
    {
        id: 'make.validate',
        phase: 'validate',
        surface: 'make',
        command: 'make model-gateway-validate',
        summary: 'Makefile alias for the scoped validation set.',
    },
    {
        id: 'make.prebuild',
        phase: 'prebuild',
        surface: 'make',
        command: 'make model-gateway-prebuild',
        summary: 'Makefile alias for the pre-build command sequence.',
    },
    {
        id: 'terminal.commands',
        phase: 'orientation',
        surface: 'terminal',
        command: '/byok gateway commands',
        summary: 'Show canonical package, Makefile and terminal commands inside the terminal cockpit.',
    },
    {
        id: 'terminal.prebuild-readiness',
        phase: 'prebuild',
        surface: 'terminal',
        command: '/byok gateway prebuild',
        summary: 'Inspect the boolean K+/Y readiness gate before the first full build.',
    },
    {
        id: 'terminal.refresh',
        phase: 'metadata',
        surface: 'terminal',
        command: '/byok gateway catalog refresh',
        summary: 'Commit an incremental, locked, account-overlay-aware catalog refresh.',
    },
    {
        id: 'terminal.diff',
        phase: 'metadata',
        surface: 'terminal',
        command: '/byok gateway catalog diff',
        summary: 'Inspect the latest persisted catalog diff without network.',
    },
    {
        id: 'terminal.freshness',
        phase: 'metadata',
        surface: 'terminal',
        command: '/byok gateway catalog freshness',
        summary: 'Inspect source freshness and TTL state without network.',
    },
    {
        id: 'terminal.provider-traits',
        phase: 'metadata',
        surface: 'terminal',
        command: '/byok gateway provider traits',
        summary: 'Inspect normalized provider/gateway traits derived from specs and endpoint inventory.',
    },
    {
        id: 'terminal.env-requirements',
        phase: 'pre-runtime',
        surface: 'terminal',
        command: '/byok gateway env',
        summary: 'Inspect missing provider env requirements without printing secret values.',
    },
    {
        id: 'terminal.probe-matrix',
        phase: 'pre-runtime',
        surface: 'terminal',
        command: '/byok gateway probes matrix',
        summary: 'Inspect provider/wire-API probe applicability before any runtime execution.',
    },
    {
        id: 'terminal.sqlite',
        phase: 'metadata',
        surface: 'terminal',
        command: '/byok gateway catalog sqlite',
        summary: 'Mirror the JSON catalog snapshot into SQLite explicitly.',
    },
    {
        id: 'terminal.openapi',
        phase: 'metadata',
        surface: 'terminal',
        command: '/byok gateway catalog openai',
        summary: 'Inspect the OpenAI-compatible model projection.',
    },
    {
        id: 'terminal.explain',
        phase: 'pre-runtime',
        surface: 'terminal',
        command: '/byok gateway catalog explain <provider:model>',
        summary: 'Explain projection, routes, overlays and eligibility before runtime.',
    },
    {
        id: 'terminal.routes',
        phase: 'pre-runtime',
        surface: 'terminal',
        command: '/byok gateway routes',
        summary: 'Inspect route options that drive metadata-first selection.',
    },
    {
        id: 'terminal.overlays',
        phase: 'pre-runtime',
        surface: 'terminal',
        command: '/byok gateway overlays',
        summary: 'Inspect account overlays without exposing secrets.',
    },
    {
        id: 'terminal.eligibility',
        phase: 'pre-runtime',
        surface: 'terminal',
        command: '/byok gateway eligibility refresh persist',
        summary: 'Evaluate and optionally persist pre-runtime eligibility decisions.',
    },
    {
        id: 'terminal.route',
        phase: 'selection',
        surface: 'terminal',
        command: '/byok models route repo_agent --show-rejected',
        summary: 'Preview metadata-aware route selection before runtime probes.',
    },
]);

/**
 * @param {object} [options]
 * @param {string} [options.surface]
 * @param {string} [options.phase]
 * @returns {Array<(typeof MODEL_GATEWAY_CANONICAL_COMMANDS)[number]>}
 */
export function listModelGatewayCanonicalCommands(options = {}) {
    const surface = typeof options.surface === 'string' && options.surface ? options.surface : null;
    const phase = typeof options.phase === 'string' && options.phase ? options.phase : null;
    return MODEL_GATEWAY_CANONICAL_COMMANDS.filter((entry) => (!surface || entry.surface === surface) && (!phase || entry.phase === phase));
}

/**
 * @param {object} [options]
 * @param {string} [options.surface]
 * @param {string} [options.phase]
 * @returns {string[]}
 */
export function renderModelGatewayCanonicalCommandLines(options = {}) {
    const commands = listModelGatewayCanonicalCommands(options);
    if (commands.length === 0) return ['No canonical model-gateway commands matched the requested filters.'];
    return commands.map((entry) => `${entry.surface.padEnd(8)} ${entry.phase.padEnd(11)} ${entry.command} :: ${entry.summary}`);
}
