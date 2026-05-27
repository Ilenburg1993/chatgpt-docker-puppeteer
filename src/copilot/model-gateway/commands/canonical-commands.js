// @ts-check
/**
 * Canonical model-gateway command inventory.
 *
 * This is documentation-as-data for humans, LLM agents, package scripts, Makefile targets and the terminal cockpit.
 * Commands listed here prepare, inspect, validate and materialize the model metadata database. They do not refer to the
 * application/dist build unless a command explicitly says so.
 *
 * @module copilot/model-gateway/commands/canonical-commands
 */

export const MODEL_GATEWAY_CANONICAL_COMMAND_TRACK = 'Y';

export const MODEL_GATEWAY_CANONICAL_COMMAND_PHASES = Object.freeze([
    'orientation',
    'metadata',
    'pre-runtime',
    'selection',
    'live-readiness',
    'validate',
    'prebuild',
]);

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
        id: 'refresh.incremental',
        phase: 'metadata',
        surface: 'package',
        command: 'npm run model-gateway:refresh',
        summary: 'Commit an incremental metadata refresh with live JSONL progress logs.',
    },
    {
        id: 'refresh.provider',
        phase: 'metadata',
        surface: 'package',
        command: 'npm run model-gateway:refresh -- --provider=openrouter --force',
        summary: 'Refresh one provider/source family without a full catalog rebuild.',
    },
    {
        id: 'refresh.preview',
        phase: 'metadata',
        surface: 'package',
        command: 'npm run model-gateway:refresh:preview -- --provider=openrouter',
        summary: 'Preview a provider refresh and write the full progress log without committing the snapshot.',
    },
    {
        id: 'refresh.log',
        phase: 'metadata',
        surface: 'package',
        command: 'npm run model-gateway:refresh:log -- --json',
        summary: 'Summarize the latest refresh JSONL log without touching the catalog.',
    },
    {
        id: 'refresh.log-sqlite',
        phase: 'metadata',
        surface: 'package',
        command: 'npm run model-gateway:refresh:log:sqlite -- --json',
        summary: 'Mirror refresh JSONL operational events into SQLite without mutating catalog metadata.',
    },
    {
        id: 'refresh.plan',
        phase: 'metadata',
        surface: 'package',
        command: 'npm run model-gateway:refresh:plan -- --provider=openrouter --force',
        summary: 'Plan selected/skipped sources before fetching providers or writing the catalog.',
    },
    {
        id: 'sqlite.diagnostics',
        phase: 'metadata',
        surface: 'package',
        command: 'npm run model-gateway:sqlite:diagnostics',
        summary: 'Inspect SQLite table counts and operational layers without mirroring or fetching providers.',
    },
    {
        id: 'runtime-health.mirror',
        phase: 'pre-runtime',
        surface: 'package',
        command: 'npm run model-gateway:runtime-health:mirror',
        summary: 'Mirror already-observed BYOK health into SQLite runtime tables without provider calls or catalog mutation.',
    },
    {
        id: 'sqlite.retention',
        phase: 'metadata',
        surface: 'package',
        command: 'npm run model-gateway:sqlite:retention -- --json',
        summary:
            'Preview SQLite operational retention for account/key history, route decisions, refresh logs and runtime health.',
    },
    {
        id: 'sqlite.retention-apply',
        phase: 'metadata',
        surface: 'package',
        command: 'npm run model-gateway:sqlite:retention:apply -- --json',
        summary: 'Apply SQLite operational retention for account/key, route, refresh and runtime health tables.',
    },
    {
        id: 'prebuild.all',
        phase: 'prebuild',
        surface: 'package',
        command: 'npm run model-gateway:prebuild',
        summary: 'Print command inventory and run all scoped pre-build validators.',
    },
    {
        id: 'prebuild.first-build',
        phase: 'prebuild',
        surface: 'package',
        command: 'npm run model-gateway:build',
        summary: 'Run prebuild and then build/materialize the model metadata database.',
    },
    {
        id: 'metadata-build.plan',
        phase: 'metadata',
        surface: 'package',
        command: 'npm run model-gateway:metadata:build:plan',
        summary: 'Plan the full metadata database build without fetching providers or writing stores.',
    },
    {
        id: 'metadata-build.preview',
        phase: 'metadata',
        surface: 'package',
        command: 'npm run model-gateway:metadata:build:preview',
        summary: 'Run the full metadata build in preview mode without committing JSON or SQLite.',
    },
    {
        id: 'metadata-build.commit',
        phase: 'metadata',
        surface: 'package',
        command: 'npm run model-gateway:metadata:build',
        summary: 'Commit the full metadata catalog build, mirror it to SQLite and apply operational retention.',
    },
    {
        id: 'catalog.integrity',
        phase: 'metadata',
        surface: 'package',
        command: 'npm run model-gateway:catalog:integrity',
        summary: 'Audit the persisted JSON catalog for duplicate keys and redacted identities without refresh.',
    },
    {
        id: 'redaction.audit',
        phase: 'prebuild',
        surface: 'package',
        command: 'npm run model-gateway:redaction:audit -- --fail',
        summary: 'Audit JSON and SQLite model-gateway payload surfaces for unredacted secret-looking strings.',
    },
    {
        id: 'selection.audit',
        phase: 'selection',
        surface: 'package',
        command: 'npm run model-gateway:selection:audit',
        summary: 'Audit metadata-first route selection from the persisted catalog without runtime probes.',
    },
    {
        id: 'selection.audit.local-strict',
        phase: 'selection',
        surface: 'package',
        command: 'npm run model-gateway:selection:audit -- --profile=local_private_strict --fail-on-unselected',
        summary: 'Hard-block remote candidates for the explicit local/private strict profile without runtime probes.',
    },
    {
        id: 'selection.effective',
        phase: 'selection',
        surface: 'package',
        command: 'npm run model-gateway:selection:effective',
        summary: 'Evaluate effective no-runtime selection with observed account/runtime health overlays.',
    },
    {
        id: 'selection.effective.supply-gate',
        phase: 'selection',
        surface: 'package',
        command: 'npm run model-gateway:selection:effective -- --profile local_private --fail --fail-on-supply-warning',
        summary: 'Fail effective no-runtime selection when the local/private profile has zero local/privacy supply.',
    },
    {
        id: 'selection.effective.runtime-proof',
        phase: 'selection',
        surface: 'package',
        command: 'npm run model-gateway:selection:effective -- --require-runtime-proof',
        summary: 'Inspect post-runtime selection while requiring already-observed runtime proof for selected routes.',
    },
    {
        id: 'live.readiness',
        phase: 'live-readiness',
        surface: 'package',
        command: 'npm run model-gateway:live:readiness',
        summary: 'Check catalog integrity, SQLite parity and pre-runtime selection before terminal llm-b live tests.',
    },
    {
        id: 'live.plan',
        phase: 'live-readiness',
        surface: 'package',
        command: 'npm run model-gateway:live:plan',
        summary: 'Materialize the no-runtime terminal llm-b live-test plan from readiness.',
    },
    {
        id: 'live.plan.local-strict',
        phase: 'live-readiness',
        surface: 'package',
        command: 'npm run model-gateway:live:plan -- --local-private-strict',
        summary: 'Materialize the live-test plan with an opt-in hard local/private prerequisite.',
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
        id: 'make.refresh',
        phase: 'metadata',
        surface: 'make',
        command: 'make model-gateway-refresh',
        summary: 'Makefile alias for incremental refresh with live logs.',
    },
    {
        id: 'make.refresh-provider',
        phase: 'metadata',
        surface: 'make',
        command: 'make model-gateway-refresh-provider PROVIDER=openrouter ARGS=--force',
        summary: 'Makefile provider-scoped refresh path for adding or updating one provider without full rebuild.',
    },
    {
        id: 'make.refresh-log',
        phase: 'metadata',
        surface: 'make',
        command: 'make model-gateway-refresh-log',
        summary: 'Makefile alias for latest refresh log analysis.',
    },
    {
        id: 'make.refresh-log-sqlite',
        phase: 'metadata',
        surface: 'make',
        command: 'make model-gateway-refresh-log-sqlite',
        summary: 'Makefile alias for SQLite refresh-log replay.',
    },
    {
        id: 'make.refresh-plan',
        phase: 'metadata',
        surface: 'make',
        command: 'make model-gateway-refresh-plan',
        summary: 'Makefile alias for no-network refresh planning.',
    },
    {
        id: 'make.sqlite-retention',
        phase: 'metadata',
        surface: 'make',
        command: 'make model-gateway-sqlite-retention',
        summary: 'Makefile dry-run for SQLite operational retention.',
    },
    {
        id: 'make.sqlite-retention-apply',
        phase: 'metadata',
        surface: 'make',
        command: 'make model-gateway-sqlite-retention-apply',
        summary: 'Makefile apply path for SQLite operational retention.',
    },
    {
        id: 'make.sqlite-diagnostics',
        phase: 'metadata',
        surface: 'make',
        command: 'make model-gateway-sqlite-diagnostics',
        summary: 'Makefile alias for no-mirror SQLite diagnostics.',
    },
    {
        id: 'make.runtime-health-mirror',
        phase: 'pre-runtime',
        surface: 'make',
        command: 'make model-gateway-runtime-health-mirror',
        summary: 'Makefile alias for mirroring already-observed BYOK runtime health into SQLite.',
    },
    {
        id: 'make.prebuild',
        phase: 'prebuild',
        surface: 'make',
        command: 'make model-gateway-prebuild',
        summary: 'Makefile alias for the pre-build command sequence.',
    },
    {
        id: 'make.first-build',
        phase: 'prebuild',
        surface: 'make',
        command: 'make model-gateway-build',
        summary: 'Makefile alias for prebuild plus metadata database build.',
    },
    {
        id: 'make.metadata-build-plan',
        phase: 'metadata',
        surface: 'make',
        command: 'make model-gateway-metadata-build-plan',
        summary: 'Makefile plan for the metadata database build.',
    },
    {
        id: 'make.metadata-build-preview',
        phase: 'metadata',
        surface: 'make',
        command: 'make model-gateway-metadata-build-preview',
        summary: 'Makefile preview for the metadata database build.',
    },
    {
        id: 'make.metadata-build',
        phase: 'metadata',
        surface: 'make',
        command: 'make model-gateway-metadata-build',
        summary: 'Makefile commit path for the metadata database build.',
    },
    {
        id: 'make.catalog-integrity',
        phase: 'metadata',
        surface: 'make',
        command: 'make model-gateway-catalog-integrity',
        summary: 'Makefile alias for catalog integrity audit without refresh.',
    },
    {
        id: 'make.redaction-audit',
        phase: 'prebuild',
        surface: 'make',
        command: 'make model-gateway-redaction-audit',
        summary: 'Makefile alias for the JSON/SQLite persisted redaction audit.',
    },
    {
        id: 'make.selection-audit',
        phase: 'selection',
        surface: 'make',
        command: 'make model-gateway-selection-audit',
        summary: 'Makefile alias for pre-runtime selection audit.',
    },
    {
        id: 'make.effective-selection',
        phase: 'selection',
        surface: 'make',
        command: 'make model-gateway-effective-selection',
        summary: 'Makefile alias for effective no-runtime selection.',
    },
    {
        id: 'make.live-readiness',
        phase: 'live-readiness',
        surface: 'make',
        command: 'make model-gateway-live-readiness',
        summary: 'Makefile alias for the no-runtime live readiness gate.',
    },
    {
        id: 'make.live-plan',
        phase: 'live-readiness',
        surface: 'make',
        command: 'make model-gateway-live-plan',
        summary: 'Makefile alias for the no-runtime terminal live-test plan.',
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
        summary: 'Inspect the boolean K+/Y readiness gate before the metadata database build.',
    },
    {
        id: 'terminal.refresh',
        phase: 'metadata',
        surface: 'terminal',
        command: '/byok gateway catalog refresh',
        summary: 'Commit an incremental, locked, account-overlay-aware catalog refresh.',
    },
    {
        id: 'terminal.refresh-log',
        phase: 'metadata',
        surface: 'terminal',
        command: '/byok gateway catalog refresh-log',
        summary: 'Summarize the latest refresh JSONL log from the terminal cockpit.',
    },
    {
        id: 'terminal.refresh-plan',
        phase: 'metadata',
        surface: 'terminal',
        command: '/byok gateway catalog refresh-plan openrouter',
        summary: 'Plan selected/skipped importers before network or catalog writes.',
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
        id: 'terminal.integrity',
        phase: 'metadata',
        surface: 'terminal',
        command: '/byok gateway catalog integrity',
        summary: 'Audit duplicate catalog keys and redacted identities from the terminal cockpit.',
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
        id: 'terminal.importers-audit',
        phase: 'metadata',
        surface: 'terminal',
        command: '/byok gateway importers',
        summary: 'Audit configured catalog importers, hooks and endpoint coverage without fetching providers.',
    },
    {
        id: 'terminal.probe-matrix',
        phase: 'pre-runtime',
        surface: 'terminal',
        command: '/byok gateway probes matrix',
        summary: 'Inspect provider/wire-API probe applicability before any runtime execution.',
    },
    {
        id: 'terminal.probe-backoff',
        phase: 'pre-runtime',
        surface: 'terminal',
        command: '/byok gateway probes backoff',
        summary: 'Plan probe deferrals from known account/key and runtime rate-limit windows.',
    },
    {
        id: 'terminal.runtime-health-sqlite',
        phase: 'pre-runtime',
        surface: 'terminal',
        command: '/byok gateway health sqlite',
        summary: 'Mirror current BYOK provider/model health into SQLite runtime tables without provider calls.',
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
        id: 'terminal.accounts',
        phase: 'pre-runtime',
        surface: 'terminal',
        command: '/byok gateway accounts',
        summary: 'Inspect account/key limit status from overlays before runtime.',
    },
    {
        id: 'terminal.eligibility',
        phase: 'pre-runtime',
        surface: 'terminal',
        command: '/byok gateway eligibility refresh persist',
        summary: 'Evaluate and optionally persist pre-runtime eligibility decisions.',
    },
    {
        id: 'terminal.selection-audit',
        phase: 'selection',
        surface: 'terminal',
        command: '/byok gateway selection audit effective',
        summary: 'Audit effective route selection with observed health, without executing new runtime probes.',
    },
    {
        id: 'terminal.selection-runtime-proof',
        phase: 'selection',
        surface: 'terminal',
        command: '/byok gateway selection audit runtime-proof',
        summary: 'Compare pre-runtime and post-runtime selection while requiring already-observed runtime proof.',
    },
    {
        id: 'terminal.selection-local-strict',
        phase: 'selection',
        surface: 'terminal',
        command: '/byok gateway selection audit strict local_private_strict',
        summary: 'Inspect hard-blocking local/private selection from the terminal without runtime probes.',
    },
    {
        id: 'terminal.route',
        phase: 'selection',
        surface: 'terminal',
        command: '/byok models route repo_agent active --show-rejected provider:<provider>',
        summary: 'Preview focused metadata-aware route selection for the active provider before runtime probes.',
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
