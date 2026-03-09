#!/usr/bin/env node
// @ts-check
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { collectArchitectureFindings } from './collectors/architecture.mjs';
import { collectPerformanceFindings } from './collectors/performance.mjs';
import { collectQualityFindings } from './collectors/quality.mjs';
import { collectRuntimeFindings } from './collectors/runtime.mjs';
import { collectSecurityFindings } from './collectors/security.mjs';
import { collectStaticFindings } from './collectors/static.mjs';
import { collectTestFindings } from './collectors/tests.mjs';
import { evaluateChaosContracts } from './contracts/evaluate_chaos.mjs';
import { buildEvidenceGraph } from './contracts/evidence_graph.mjs';
import { getLegacyStaticContracts } from './contracts/legacy_adapter.mjs';
import { loadContractRegistry } from './contracts/load_registry.mjs';
import { createEtaEstimator } from './lib/eta_estimator.mjs';
import { AUDIT_EVENT_TYPES, AUDIT_PHASES } from './lib/event_types.mjs';
import { parseJsonFromMixedOutput, runCommand } from './lib/exec.mjs';
import { getChangedFiles } from './lib/git.mjs';
import { createAuditLogger } from './lib/logger.mjs';
import { buildPhasePlan, flattenPlannedStepKeys } from './lib/phase_plan.mjs';
import { createProgressTracker } from './lib/progress_tracker.mjs';
import { pruneAuditRuns } from './lib/retention.mjs';
import { createRunStateStore } from './lib/run_state_store.mjs';
import { SCHEMA_VERSION, validateAuditRun } from './lib/schema.mjs';
import { normalizeFindings } from './normalize/findings.mjs';
import { publishJson } from './publish_json.mjs';
import { publishMasterMarkdown } from './publish_md.mjs';
import { publishSnapshot } from './publish_snapshot.mjs';
import { printFinalReport, printProgress } from './reporters/console_reporter.mjs';
import { renderContractCoverage } from './reporters/contract_coverage_reporter.mjs';
import { triageFindings } from './triage_llm.mjs';

/** @typedef {'quick' | 'deep' | 'nightly'} Profile */
/** @typedef {'bug-first' | 'all'} FocusMode */
/** @typedef {'smart' | 'force' | 'skip'} RefreshContextMode */
/** @typedef {'legacy' | 'hybrid' | 'strict'} ContractsMode */
/** @typedef {'off' | 'warn' | 'p1' | 'p0'} EnforceLevel */
/** @typedef {'off' | 'basic' | 'standard' | 'deep'} ProposalDepth */
/** @typedef {'off' | 'light' | 'full'} ChaosProfile */
/** @typedef {'off' | 'on'} CloudFallbackMode */
/** @typedef {'smart' | 'full' | 'changed' | 'off'} QualityMode */
/** @typedef {'success' | 'partial' | 'aborted' | 'fatal'} RunOutcome */
/** @typedef {'signal' | 'uncaught_exception' | 'unhandled_rejection' | 'manual' | 'none'} AbortReason */
/** @typedef {'observability'
    | 'reactive_bug'
    | 'exploratory_bug'
    | 'contracts'
    | 'security'
    | 'performance'
    | 'architecture'} AuditMode */

const MASTER_PATH = 'DOCUMENTAÇÃO/AUDITORIAS/BUGS/BUG_AUDIT_MASTER.md';
const SNAPSHOTS_DIR = 'DOCUMENTAÇÃO/AUDITORIAS/BUGS/rodadas';
const OUTPUT_DIR = 'artifacts/audit';

/** @type {import('node:util').ParseArgsConfig['options']} */
const cliOptions = {
    profile: { type: 'string', default: 'quick' },
    'audit-mode': { type: 'string', default: 'auto' },
    scope: { type: 'string', default: 'repo' },
    'changed-only': { type: 'boolean', default: false },
    json: { type: 'boolean', default: false },
    'publish-master': { type: 'string', default: 'auto' },
    'publish-snapshot': { type: 'string', default: 'auto' },
    'output-dir': { type: 'string', default: OUTPUT_DIR },
    triage: { type: 'string', default: 'true' },
    'refresh-context': { type: 'string', default: 'smart' },
    focus: { type: 'string', default: 'bug-first' },
    progress: { type: 'string', default: 'true' },
    eta: { type: 'string', default: 'true' },
    'heartbeat-ms': { type: 'string', default: '5000' },
    'propose-diffs': { type: 'string', default: 'false' },
    'max-findings': { type: 'string', default: '0' },
    'max-stdout-bytes': { type: 'string', default: '1048576' },
    'max-stderr-bytes': { type: 'string', default: '1048576' },
    'triage-timeout-ms': { type: 'string', default: '0' },
    'resume-run': { type: 'string', default: '' },
    'retention-max-runs': { type: 'string', default: '30' },
    'log-level': { type: 'string', default: 'info' },
    'log-format': { type: 'string', default: 'console' },
    'contracts-mode': { type: 'string', default: 'hybrid' },
    'contracts-domains': { type: 'string', default: '' },
    'enforce-level': { type: 'string', default: 'warn' },
    'proposal-depth': { type: 'string', default: 'standard' },
    'chaos-profile': { type: 'string', default: 'off' },
    'cloud-fallback': { type: 'string', default: 'off' },
    'contract-coverage-report': { type: 'string', default: 'true' },
    'shadow-gate': { type: 'string', default: 'true' },
    'quality-mode': { type: 'string', default: 'smart' },
    'quality-jsdoc': { type: 'string', default: 'true' },
    'quality-prettier': { type: 'string', default: 'true' },
    'quality-jsdoc-full-threshold-pct': { type: 'string', default: '80' },
    'quality-cache': { type: 'string', default: 'true' },
    'quality-cache-dir': { type: 'string', default: 'artifacts/audit/cache/quality' },
    'quality-parallelism': { type: 'string', default: 'auto' },
};

/** @type {any} */
let values = {};
/** @type {Error | null} */
let cliParseError = null;
try {
    ({ values } = parseArgs({ options: cliOptions }));
} catch (error) {
    cliParseError = error instanceof Error ? error : new Error(String(error));
    ({ values } = parseArgs({ options: cliOptions, strict: false }));
}

/**
 * @param {string | boolean | undefined} value
 * @param {boolean} fallback
 */
function parseSwitch(value, fallback) {
    if (typeof value === 'boolean') {
        return value;
    }

    if (typeof value === 'string') {
        const normalized = value.trim().toLowerCase();
        if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
        if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
    }

    return fallback;
}

/**
 * @param {string} text
 */
function sanitize(text) {
    return String(text || '')
        .replace(/\x1B\[[0-9;]*[A-Za-z]/g, '')
        .trim();
}

/**
 * @param {string} value
 * @returns {RefreshContextMode}
 */
function parseRefreshMode(value) {
    const normalized = String(value || '')
        .trim()
        .toLowerCase();
    if (normalized === 'force') return 'force';
    if (normalized === 'skip') return 'skip';
    return 'smart';
}

/**
 * @param {string} value
 * @returns {FocusMode}
 */
function parseFocusMode(value) {
    return String(value || '')
        .trim()
        .toLowerCase() === 'all'
        ? 'all'
        : 'bug-first';
}

/**
 * @param {string} value
 * @returns {ContractsMode}
 */
function parseContractsMode(value) {
    const normalized = String(value || '')
        .trim()
        .toLowerCase();
    if (normalized === 'legacy') return 'legacy';
    if (normalized === 'strict') return 'strict';
    return 'hybrid';
}

/**
 * @param {string} value
 * @returns {EnforceLevel}
 */
function parseEnforceLevel(value) {
    const normalized = String(value || '')
        .trim()
        .toLowerCase();
    if (normalized === 'off') return 'off';
    if (normalized === 'p1') return 'p1';
    if (normalized === 'p0') return 'p0';
    return 'warn';
}

/**
 * @param {string} value
 * @returns {ProposalDepth}
 */
function parseProposalDepth(value) {
    const normalized = String(value || '')
        .trim()
        .toLowerCase();
    if (normalized === 'off') return 'off';
    if (normalized === 'basic') return 'basic';
    if (normalized === 'deep') return 'deep';
    return 'standard';
}

/**
 * @param {string} value
 * @param {Profile} profile
 * @returns {AuditMode}
 */
function parseAuditMode(value, profile) {
    const normalized = String(value || '')
        .trim()
        .toLowerCase();

    if (normalized === 'observability') return 'observability';
    if (normalized === 'reactive_bug') return 'reactive_bug';
    if (normalized === 'exploratory_bug') return 'exploratory_bug';
    if (normalized === 'contracts') return 'contracts';
    if (normalized === 'security') return 'security';
    if (normalized === 'performance') return 'performance';
    if (normalized === 'architecture') return 'architecture';

    return profile === 'nightly' ? 'exploratory_bug' : 'reactive_bug';
}

/**
 * @param {string} value
 * @returns {ChaosProfile}
 */
function parseChaosProfile(value) {
    const normalized = String(value || '')
        .trim()
        .toLowerCase();
    if (normalized === 'light') return 'light';
    if (normalized === 'full') return 'full';
    return 'off';
}

/**
 * @param {string} value
 * @returns {CloudFallbackMode}
 */
function parseCloudFallback(value) {
    return String(value || '')
        .trim()
        .toLowerCase() === 'on'
        ? 'on'
        : 'off';
}

/**
 * @param {string} value
 * @returns {QualityMode}
 */
function parseQualityMode(value) {
    const normalized = String(value || '')
        .trim()
        .toLowerCase();
    if (normalized === 'full') return 'full';
    if (normalized === 'changed') return 'changed';
    if (normalized === 'off') return 'off';
    return 'smart';
}

/**
 * @param {string} value
 * @returns {string[]}
 */
function parseDomains(value) {
    return String(value || '')
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
}

/**
 * @param {string} value
 */
function sanitizeStepToken(value) {
    return String(value || 'step').replace(/[^a-zA-Z0-9._-]/g, '_');
}

/**
 * @param {Profile} profile
 * @param {boolean} changedOnly
 */
async function resolveChangedFiles(profile, changedOnly) {
    if (profile !== 'quick' && !changedOnly) {
        return [];
    }

    return await getChangedFiles();
}

async function main() {
    // Test-only escape hatch to validate fatal-fallback schema/artifacts without running the full audit pipeline.
    if (process.env.AUDIT_RUNNER_TEST_FORCE_FATAL_FALLBACK === '1') {
        throw new Error('forced fatal fallback for audit runner test');
    }

    const profile = /** @type {Profile} */ (
        ['quick', 'deep', 'nightly'].includes(values.profile) ? values.profile : 'quick'
    );
    const auditMode = parseAuditMode(String(values['audit-mode'] || 'auto'), profile);
    const scope = String(values.scope || 'repo');
    const changedOnly = values['changed-only'] || profile === 'quick';
    const focusMode = parseFocusMode(String(values.focus || 'bug-first'));
    const refreshContextMode = parseRefreshMode(String(values['refresh-context'] || 'smart'));
    const contractsMode = parseContractsMode(String(values['contracts-mode'] || 'hybrid'));
    const enforceLevel = parseEnforceLevel(String(values['enforce-level'] || 'warn'));
    const proposalDepth = parseProposalDepth(String(values['proposal-depth'] || 'standard'));
    const chaosProfile = parseChaosProfile(String(values['chaos-profile'] || 'off'));
    const cloudFallback = parseCloudFallback(String(values['cloud-fallback'] || 'off'));
    const qualityMode = parseQualityMode(String(values['quality-mode'] || (profile === 'quick' ? 'smart' : 'full')));
    const qualityJsdoc = parseSwitch(values['quality-jsdoc'], true);
    const qualityPrettier = parseSwitch(values['quality-prettier'], true);
    const qualityJsdocFullThresholdPct = Math.max(
        0,
        Math.min(100, Number(values['quality-jsdoc-full-threshold-pct'] || 80)),
    );
    const qualityCache = parseSwitch(values['quality-cache'], true);
    const qualityCacheDir = String(values['quality-cache-dir'] || 'artifacts/audit/cache/quality');
    const qualityParallelism =
        String(values['quality-parallelism'] || 'auto')
            .trim()
            .toLowerCase() === 'serial'
            ? 'serial'
            : 'auto';
    const selectedDomains = parseDomains(String(values['contracts-domains'] || ''));

    const publishMaster = parseSwitch(values['publish-master'], profile !== 'quick');
    const shouldPublishSnapshot = parseSwitch(values['publish-snapshot'], profile !== 'quick');
    const showProgress = values.json ? false : parseSwitch(values.progress, true);
    const showEta = values.json ? false : parseSwitch(values.eta, true);
    const proposeDiffs = parseSwitch(values['propose-diffs'], false);
    const contractCoverageReport = parseSwitch(values['contract-coverage-report'], true);
    const shadowGateEnabled = parseSwitch(values['shadow-gate'], true);
    const triageEnabled = parseSwitch(values.triage, true);

    const heartbeatMs = Math.max(1000, Number(values['heartbeat-ms'] || 5000));
    const maxFindings = Math.max(0, Number(values['max-findings'] || 0));
    const maxStdoutBytes = Math.max(65536, Number(values['max-stdout-bytes'] || 1048576));
    const maxStderrBytes = Math.max(65536, Number(values['max-stderr-bytes'] || 1048576));
    const triageTimeoutCli = Math.max(0, Number(values['triage-timeout-ms'] || 0));
    const triageTimeoutMs =
        triageTimeoutCli > 0 ? triageTimeoutCli : profile === 'nightly' ? 600000 : profile === 'deep' ? 300000 : 120000;
    const retentionMaxRuns = Math.max(1, Number(values['retention-max-runs'] || 30));

    const startedAtDate = new Date();
    const resumeRun = String(values['resume-run'] || '').trim();
    const runId =
        resumeRun || `WAVE_AUDIT_${profile.toUpperCase()}_${startedAtDate.toISOString().replace(/[:.]/g, '-')}`;
    const resumeEnabled = Boolean(resumeRun);

    const outputRoot = String(values['output-dir'] || OUTPUT_DIR);
    const runDir = path.join(outputRoot, 'runs', runId);
    const runsRoot = path.join(outputRoot, 'runs');
    let cleanupSignalHandlers = () => {};
    const stateStore = /** @type {any} */ (createRunStateStore({ runDir }));

    const logger = /** @type {any} */ (
        createAuditLogger({
            runId,
            runDir,
            logLevel: String(values['log-level'] || 'info') === 'debug' ? 'debug' : 'info',
            logFormat: String(values['log-format'] || 'console') === 'jsonl' ? 'jsonl' : 'console',
            enableConsole: !values.json,
        })
    );
    registerLifecycleGuards();

    const phasePlan = /** @type {any} */ (buildPhasePlan({ profile, refreshContextMode, auditMode }));
    const plannedStepKeys = /** @type {any} */ (flattenPlannedStepKeys(phasePlan));
    const phasePlanMap = new Map(phasePlan.map((/** @type {any} */ phase) => [phase.id, phase]));

    const progress = /** @type {any} */ (
        createProgressTracker({ stepsTotal: plannedStepKeys.length, startedAt: Date.now() })
    );
    const etaEstimator = /** @type {any} */ (
        createEtaEstimator({
            historyPath: path.join(outputRoot, 'step_metrics.json'),
            scopeKey: `${auditMode}:${profile}`,
            ewmaAlpha: 0.35,
        })
    );

    /** @type {Set<string>} */
    const completedStepKeys = new Set();
    /** @type {import('./lib/schema.mjs').PhaseStatusEntry[]} */
    const phaseStatus = phasePlan.map((/** @type {any} */ phase) => ({
        phase: phase.id,
        status: 'pending',
        started_at: null,
        finished_at: null,
        elapsed_ms: 0,
    }));

    /** @type {{ source: string; message: string }[]} */
    const errors = [];
    /** @type {{ source: string; message: string }[]} */
    const warnings = [];
    if (cliParseError) {
        warnings.push({
            source: 'cli',
            message: `unknown/invalid CLI options were ignored: ${cliParseError.message}`,
        });
    }
    /** @type {import('./normalize/findings.mjs').RawFinding[]} */
    let rawFindings = [];
    /** @type {ReturnType<typeof loadContractRegistry> | null} */
    let contractRegistry = null;
    /** @type {import('./contracts/load_registry.mjs').ContractDefinitionV1[]} */
    let activeContracts = [];
    let semanticPreflight = {
        ok: false,
        components: {
            pm2: { ok: false, details: 'not-executed' },
            mcp: { ok: false, details: 'not-executed' },
            rag: { ok: false, details: 'not-executed' },
            lsp: { ok: false, details: 'not-executed' },
        },
        issues: ['semantic preflight not executed'],
    };
    let contractParity = {
        enabled: false,
        dsl_findings: 0,
        legacy_findings: 0,
        mismatches: [],
    };
    /** @type {RunOutcome} */
    let runOutcome = 'success';
    /** @type {AbortReason} */
    let abortReason = 'none';
    let abortRequested = false;
    let abortMessage = '';
    let fatalMessage = '';
    /** @type {any} */
    let securityResult = {
        findings: [],
        errors: [],
        warnings: [],
        telemetry: { contracts_scanned: 0, files_scanned: 0, checks: [], findings_by_kind: {} },
    };
    /** @type {any} */
    let performanceResult = { findings: [], errors: [], warnings: [], telemetry: { score: null, categories: {} } };
    /** @type {any} */
    let architectureResult = { findings: [], errors: [], warnings: [], telemetry: { findings_by_kind: {} } };
    const plannedStartEta = etaEstimator.estimateRemaining(plannedStepKeys);
    /** @type {{
    stdout_bytes_total: number;
    stderr_bytes_total: number;
    stdout_truncated_steps: string[];
    stderr_truncated_steps: string[];
    steps_with_overflow: number;
    max_stdout_bytes: number;
    max_stderr_bytes: number;
}} */
    const logStats = {
        stdout_bytes_total: 0,
        stderr_bytes_total: 0,
        stdout_truncated_steps: [],
        stderr_truncated_steps: [],
        steps_with_overflow: 0,
        max_stdout_bytes: maxStdoutBytes,
        max_stderr_bytes: maxStderrBytes,
    };

    /** @type {ReturnType<typeof setInterval> | null} */
    let heartbeat = null;

    /**
     * @param {(typeof AUDIT_PHASES)[keyof typeof AUDIT_PHASES]} phase
     * @returns {boolean}
     */
    function shouldRunPhase(phase) {
        return (phasePlanMap.get(phase)?.planned_steps?.length || 0) > 0;
    }

    /**
     * @param {AbortReason} reason
     * @param {string} message
     * @param {'aborted' | 'fatal'} outcome
     */
    function markRunInterrupted(reason, message, outcome) {
        abortReason = reason;
        abortRequested = true;
        abortMessage = message || abortMessage;
        runOutcome = outcome;
    }

    function registerLifecycleGuards() {
        /** @param {NodeJS.Signals} signal */
        const onSignal = (signal) => {
            markRunInterrupted('signal', `signal:${signal}`, 'aborted');
            warnings.push({ source: 'lifecycle', message: `Signal captured during run: ${signal}` });
            logger.emit({
                level: 'warn',
                event_type: AUDIT_EVENT_TYPES.RUN_ABORTED,
                status: 'aborted',
                message: `Run marked as aborted due to signal ${signal}`,
            });
        };

        /** @param {unknown} error */
        const onUnhandledRejection = (error) => {
            const message = `unhandledRejection: ${error instanceof Error ? error.message : String(error)}`;
            markRunInterrupted('unhandled_rejection', message, 'fatal');
            fatalMessage = message;
            errors.push({ source: 'lifecycle', message });
            logger.emit({
                level: 'error',
                event_type: AUDIT_EVENT_TYPES.RUN_FATAL,
                status: 'fatal',
                message,
            });
        };

        /** @param {Error} error */
        const onUncaughtException = (error) => {
            const message = `uncaughtException: ${error?.message || String(error)}`;
            markRunInterrupted('uncaught_exception', message, 'fatal');
            fatalMessage = message;
            errors.push({ source: 'lifecycle', message });
            logger.emit({
                level: 'error',
                event_type: AUDIT_EVENT_TYPES.RUN_FATAL,
                status: 'fatal',
                message,
            });
        };

        process.on('SIGINT', onSignal);
        process.on('SIGTERM', onSignal);
        process.on('unhandledRejection', onUnhandledRejection);
        process.on('uncaughtException', onUncaughtException);

        cleanupSignalHandlers = () => {
            process.off('SIGINT', onSignal);
            process.off('SIGTERM', onSignal);
            process.off('unhandledRejection', onUnhandledRejection);
            process.off('uncaughtException', onUncaughtException);
        };
    }

    function getRemainingStepKeys() {
        return plannedStepKeys.filter((/** @type {any} */ key) => !completedStepKeys.has(key));
    }

    /**
     * @param {number} etaMs
     */
    function persistProgressSnapshot(etaMs) {
        const remainingKeys = getRemainingStepKeys();
        const snap = progress.snapshot(etaMs);
        snap.remaining_step_keys = remainingKeys.slice(0, 10);
        stateStore.writeProgress(snap);
        return { snap, remainingKeys };
    }

    /**
     * @param {string} phase
     */
    function startPhase(phase) {
        progress.setPhase(phase);
        const entry = phaseStatus.find((item) => item.phase === phase);
        if (entry) {
            entry.status = 'running';
            entry.started_at = new Date().toISOString();
            entry.finished_at = null;
            entry.elapsed_ms = 0;
        }
        stateStore.setPhaseTimeline(phaseStatus);
        logger.emit({
            level: 'info',
            event_type: AUDIT_EVENT_TYPES.PHASE_STARTED,
            phase,
            status: 'running',
            message: `Phase started: ${phase}`,
        });
        const remainingKeys = getRemainingStepKeys();
        const eta = etaEstimator.estimateRemaining(remainingKeys);
        logger.emit({
            level: 'debug',
            event_type: AUDIT_EVENT_TYPES.STEP_PROGRESS,
            phase,
            step_id: `${phase}.boundary.start`,
            status: 'running',
            progress_pct: progress.snapshot(eta.eta_ms).progress_pct,
            eta_ms: eta.eta_ms,
            remaining_step_keys: remainingKeys.slice(0, 8),
            message: `Phase boundary start: ${phase}`,
        });
    }

    /**
     * @param {string} phase
     * @param {'completed' | 'failed' | 'skipped'} status
     */
    function finishPhase(phase, status) {
        const entry = phaseStatus.find((item) => item.phase === phase);
        if (entry) {
            entry.status = status;
            entry.finished_at = new Date().toISOString();
            if (entry.started_at) {
                entry.elapsed_ms = Date.now() - new Date(entry.started_at).getTime();
            }
        }
        stateStore.setPhaseTimeline(phaseStatus);
        logger.emit({
            level: status === 'failed' ? 'error' : 'info',
            event_type: AUDIT_EVENT_TYPES.PHASE_FINISHED,
            phase,
            status,
            message: `Phase finished: ${phase} (${status})`,
        });
        const remainingKeys = getRemainingStepKeys();
        const eta = etaEstimator.estimateRemaining(remainingKeys);
        logger.emit({
            level: status === 'failed' ? 'warn' : 'debug',
            event_type: AUDIT_EVENT_TYPES.STEP_PROGRESS,
            phase,
            step_id: `${phase}.boundary.finish`,
            status,
            progress_pct: progress.snapshot(eta.eta_ms).progress_pct,
            eta_ms: eta.eta_ms,
            remaining_step_keys: remainingKeys.slice(0, 8),
            message: `Phase boundary finish: ${phase}`,
        });
    }

    /**
     * @param {string} phase
     * @param {string} stepId
     * @param {string} reason
     */
    function markStepSkipped(phase, stepId, reason) {
        if (completedStepKeys.has(stepId)) {
            return;
        }

        progress.stepStarted(stepId);
        completedStepKeys.add(stepId);
        progress.stepFinished(stepId);
        const eta = etaEstimator.estimateRemaining(getRemainingStepKeys());
        const { snap, remainingKeys } = persistProgressSnapshot(eta.eta_ms);

        logger.emit({
            level: 'info',
            event_type: AUDIT_EVENT_TYPES.STEP_FINISHED,
            phase,
            step_id: stepId,
            status: 'skipped',
            progress_pct: snap.progress_pct,
            eta_ms: eta.eta_ms,
            message: reason || `Step skipped: ${stepId}`,
        });
        logger.emit({
            level: 'debug',
            event_type: AUDIT_EVENT_TYPES.STEP_PROGRESS,
            phase,
            step_id: stepId,
            status: 'skipped',
            progress_pct: snap.progress_pct,
            eta_ms: eta.eta_ms,
            remaining_step_keys: remainingKeys.slice(0, 8),
            message: `Progress after skip ${stepId}: ${snap.steps_done}/${snap.steps_total}`,
        });
    }

    /**
     * @template T
     * @param {string} phase
     * @param {string} stepId
     * @param {string} message
     * @param {() => Promise<T>} action
     * @param {{ timeoutMs?: number }} [options]
     * @returns {Promise<T>}
     */
    async function runInternalStep(phase, stepId, message, action, options = {}) {
        if (abortRequested) {
            markStepSkipped(phase, stepId, abortMessage || `Step skipped due to lifecycle abort: ${stepId}`);
            throw new Error(`Audit aborted before internal step ${stepId}: ${abortMessage || 'abort requested'}`);
        }

        etaEstimator.beginStep(stepId);
        progress.stepStarted(stepId);
        const remainingKeysBefore = getRemainingStepKeys();
        const etaBefore = etaEstimator.estimateRemaining(remainingKeysBefore);

        logger.emit({
            level: 'info',
            event_type: AUDIT_EVENT_TYPES.STEP_STARTED,
            phase,
            step_id: stepId,
            status: 'running',
            command: 'internal',
            message,
            progress_pct: progress.snapshot(etaBefore.eta_ms).progress_pct,
            eta_ms: etaBefore.eta_ms,
        });

        const timeoutMs = Math.max(0, Number(options.timeoutMs || 0));
        const started = Date.now();
        let timedOut = false;

        /** @type {T} */
        let payload;
        try {
            if (timeoutMs > 0) {
                let timeoutId = null;
                payload = await Promise.race([
                    action(),
                    new Promise((_, reject) => {
                        timeoutId = setTimeout(() => {
                            timedOut = true;
                            reject(new Error(`Internal step timeout (${timeoutMs}ms): ${stepId}`));
                        }, timeoutMs);
                    }),
                ]);
                if (timeoutId) {
                    clearTimeout(timeoutId);
                }
            } else {
                payload = await action();
            }
        } catch (error) {
            etaEstimator.endStep(stepId);
            completedStepKeys.add(stepId);
            progress.stepFinished(stepId);

            const etaAfterFail = etaEstimator.estimateRemaining(getRemainingStepKeys());
            const { snap: failSnap, remainingKeys: failRemaining } = persistProgressSnapshot(etaAfterFail.eta_ms);

            logger.emit({
                level: 'error',
                event_type: AUDIT_EVENT_TYPES.STEP_FINISHED,
                phase,
                step_id: stepId,
                status: 'failed',
                command: 'internal',
                duration_ms: Date.now() - started,
                progress_pct: failSnap.progress_pct,
                eta_ms: etaAfterFail.eta_ms,
                message: timedOut ? `Internal step timed out: ${stepId}` : `Internal step failed: ${stepId}`,
            });
            logger.emit({
                level: 'debug',
                event_type: AUDIT_EVENT_TYPES.STEP_PROGRESS,
                phase,
                step_id: stepId,
                status: 'failed',
                progress_pct: failSnap.progress_pct,
                eta_ms: etaAfterFail.eta_ms,
                remaining_step_keys: failRemaining.slice(0, 8),
                message: `Progress after ${stepId}: ${failSnap.steps_done}/${failSnap.steps_total}`,
            });
            throw error;
        }

        etaEstimator.endStep(stepId);
        completedStepKeys.add(stepId);
        progress.stepFinished(stepId);

        const etaAfter = etaEstimator.estimateRemaining(getRemainingStepKeys());
        const { snap, remainingKeys } = persistProgressSnapshot(etaAfter.eta_ms);

        logger.emit({
            level: 'info',
            event_type: AUDIT_EVENT_TYPES.STEP_FINISHED,
            phase,
            step_id: stepId,
            status: 'completed',
            command: 'internal',
            duration_ms: Date.now() - started,
            progress_pct: snap.progress_pct,
            eta_ms: etaAfter.eta_ms,
            message: `Step completed: ${stepId}`,
        });
        logger.emit({
            level: 'debug',
            event_type: AUDIT_EVENT_TYPES.STEP_PROGRESS,
            phase,
            step_id: stepId,
            status: 'completed',
            progress_pct: snap.progress_pct,
            eta_ms: etaAfter.eta_ms,
            remaining_step_keys: remainingKeys.slice(0, 8),
            message: `Progress after ${stepId}: ${snap.steps_done}/${snap.steps_total}`,
        });

        return payload;
    }

    /**
     * @param {string} phase
     * @param {string} stepId
     * @param {string} command
     * @param {string[]} args
     * @param {object} [runOptions]
     */
    async function execStep(phase, stepId, command, args, runOptions = {}) {
        if (abortRequested) {
            return {
                ok: false,
                exitCode: null,
                stdout: '',
                stderr: abortMessage || fatalMessage || 'run aborted by lifecycle guard',
                durationMs: 0,
                timedOut: false,
                command: `${command} ${args.join(' ')}`.trim(),
                stdoutBytes: 0,
                stderrBytes: 0,
                stdoutTruncated: false,
                stderrTruncated: false,
            };
        }
        if (resumeEnabled) {
            const safeStep = sanitizeStepToken(stepId);
            const stepDir = path.join(logger.stepsDir, safeStep);
            const commandPath = path.join(stepDir, 'command.json');
            const stdoutPath = path.join(stepDir, 'stdout.log');
            const stderrPath = path.join(stepDir, 'stderr.log');

            if (fs.existsSync(commandPath)) {
                try {
                    const cached = JSON.parse(fs.readFileSync(commandPath, 'utf8'));
                    if (cached?.ok === true) {
                        progress.stepStarted(stepId);
                        completedStepKeys.add(stepId);
                        progress.stepFinished(stepId);

                        const remainingKeysAfterCache = getRemainingStepKeys();
                        const etaAfterCache = etaEstimator.estimateRemaining(remainingKeysAfterCache);
                        const { snap: snapAfterCache } = persistProgressSnapshot(etaAfterCache.eta_ms);

                        logger.emit({
                            level: 'info',
                            event_type: AUDIT_EVENT_TYPES.STEP_FINISHED,
                            phase,
                            step_id: stepId,
                            status: 'skipped',
                            command,
                            message: `Step reused from resume cache: ${stepId}`,
                            progress_pct: snapAfterCache.progress_pct,
                            eta_ms: etaAfterCache.eta_ms,
                            stdout_path: stdoutPath,
                            stderr_path: stderrPath,
                        });

                        return {
                            ok: true,
                            exitCode: Number.isInteger(cached.exit_code) ? cached.exit_code : 0,
                            stdout: fs.existsSync(stdoutPath) ? fs.readFileSync(stdoutPath, 'utf8') : '',
                            stderr: fs.existsSync(stderrPath) ? fs.readFileSync(stderrPath, 'utf8') : '',
                            durationMs: 0,
                            timedOut: false,
                            command: `${command} ${args.join(' ')}`.trim(),
                            stdoutBytes: Number(cached.stdout_bytes || 0),
                            stderrBytes: Number(cached.stderr_bytes || 0),
                            stdoutTruncated: Boolean(cached.stdout_truncated),
                            stderrTruncated: Boolean(cached.stderr_truncated),
                        };
                    }
                } catch {
                    // ignore cache parsing failures and execute normally
                }
            }
        }

        etaEstimator.beginStep(stepId);
        progress.stepStarted(stepId);

        const remainingKeysBefore = getRemainingStepKeys();
        const etaBefore = etaEstimator.estimateRemaining(remainingKeysBefore);

        logger.emit({
            level: 'info',
            event_type: AUDIT_EVENT_TYPES.STEP_STARTED,
            phase,
            step_id: stepId,
            status: 'running',
            command,
            message: `Running ${command} ${args.join(' ')}`,
            progress_pct: progress.snapshot(etaBefore.eta_ms).progress_pct,
            eta_ms: etaBefore.eta_ms,
        });

        const result = await runCommand(
            command,
            args,
            /** @type {any} */ ({
                ...runOptions,
                maxStdoutBytes,
                maxStderrBytes,
            }),
        );
        etaEstimator.endStep(stepId);
        completedStepKeys.add(stepId);

        const stepArtifacts = logger.writeStepArtifacts({
            phase,
            stepId,
            command,
            args,
            stdout: result.stdout,
            stderr: result.stderr,
            result,
        });

        progress.stepFinished(stepId);
        logStats.stdout_bytes_total += Number(result.stdoutBytes || 0);
        logStats.stderr_bytes_total += Number(result.stderrBytes || 0);
        if (result.stdoutTruncated) {
            logStats.stdout_truncated_steps.push(stepId);
            logger.emit({
                level: 'warn',
                event_type: AUDIT_EVENT_TYPES.STEP_OUTPUT_TRUNCATED,
                phase,
                step_id: stepId,
                status: 'completed',
                message: `stdout truncated for ${stepId}`,
                stdout_bytes: result.stdoutBytes,
            });
        }
        if (result.stderrTruncated) {
            logStats.stderr_truncated_steps.push(stepId);
            logger.emit({
                level: 'warn',
                event_type: AUDIT_EVENT_TYPES.STEP_OUTPUT_TRUNCATED,
                phase,
                step_id: stepId,
                status: 'completed',
                message: `stderr truncated for ${stepId}`,
                stderr_bytes: result.stderrBytes,
            });
        }
        if (result.stdoutTruncated || result.stderrTruncated) {
            logStats.steps_with_overflow += 1;
        }

        const remainingKeysAfter = getRemainingStepKeys();
        const etaAfter = etaEstimator.estimateRemaining(remainingKeysAfter);
        const { snap } = persistProgressSnapshot(etaAfter.eta_ms);

        logger.emit({
            level: result.ok ? 'info' : 'error',
            event_type: AUDIT_EVENT_TYPES.STEP_FINISHED,
            phase,
            step_id: stepId,
            status: result.ok ? 'completed' : 'failed',
            command,
            exit_code: result.exitCode,
            duration_ms: result.durationMs,
            progress_pct: snap.progress_pct,
            eta_ms: etaAfter.eta_ms,
            stdout_path: stepArtifacts.stdoutPath,
            stderr_path: stepArtifacts.stderrPath,
            message: result.ok ? `Step completed: ${stepId}` : `Step failed: ${stepId}`,
        });
        logger.emit({
            level: 'debug',
            event_type: AUDIT_EVENT_TYPES.STEP_PROGRESS,
            phase,
            step_id: stepId,
            status: result.ok ? 'completed' : 'failed',
            progress_pct: snap.progress_pct,
            eta_ms: etaAfter.eta_ms,
            remaining_step_keys: remainingKeysAfter.slice(0, 8),
            message: `Progress after ${stepId}: ${snap.steps_done}/${snap.steps_total}`,
        });

        return result;
    }

    const manifest = {
        schema_version: SCHEMA_VERSION,
        run_id: runId,
        profile,
        audit_mode: auditMode,
        scope,
        focus_mode: focusMode,
        contracts_mode: contractsMode,
        enforce_level: enforceLevel,
        proposal_depth: proposalDepth,
        chaos_profile: chaosProfile,
        cloud_fallback: cloudFallback,
        started_at: startedAtDate.toISOString(),
        output_root: outputRoot,
        run_dir: runDir,
        options: {
            changed_only: changedOnly,
            refresh_context: refreshContextMode,
            publish_master: publishMaster,
            publish_snapshot: shouldPublishSnapshot,
            propose_diffs: proposeDiffs,
            heartbeat_ms: heartbeatMs,
            max_findings: maxFindings,
            triage_timeout_ms: triageTimeoutMs,
            max_stdout_bytes: maxStdoutBytes,
            max_stderr_bytes: maxStderrBytes,
            retention_max_runs: retentionMaxRuns,
            contracts_domains: selectedDomains,
            contract_coverage_report: contractCoverageReport,
            shadow_gate: shadowGateEnabled,
            quality_mode: qualityMode,
            quality_jsdoc: qualityJsdoc,
            quality_prettier: qualityPrettier,
            quality_jsdoc_full_threshold_pct: qualityJsdocFullThresholdPct,
            quality_cache: qualityCache,
            quality_cache_dir: qualityCacheDir,
            quality_parallelism: qualityParallelism,
        },
    };

    stateStore.writeManifest(manifest);

    startPhase('preflight');
    const [nodeV, npmV, gitV] = await Promise.all([
        execStep('preflight', 'preflight.node_version', 'node', ['--version']),
        execStep('preflight', 'preflight.npm_version', 'npm', ['--version']),
        execStep('preflight', 'preflight.git_version', 'git', ['--version']),
    ]);

    const toolVersions = {
        node: sanitize(nodeV.stdout || nodeV.stderr),
        npm: sanitize(npmV.stdout || npmV.stderr),
        git: sanitize(gitV.stdout || gitV.stderr),
    };

    logger.emit({
        level: 'info',
        event_type: AUDIT_EVENT_TYPES.RUN_STARTED,
        status: 'running',
        message: `Audit run started (${runId})`,
        profile,
        audit_mode: auditMode,
        scope,
        focus_mode: focusMode,
        contracts_mode: contractsMode,
        enforce_level: enforceLevel,
        proposal_depth: proposalDepth,
    });

    heartbeat = setInterval(() => {
        const remainingKeys = getRemainingStepKeys();
        const eta = etaEstimator.estimateRemaining(remainingKeys);
        const snap = progress.snapshot(eta.eta_ms);
        snap.remaining_step_keys = remainingKeys.slice(0, 10);

        stateStore.writeProgress(snap);
        logger.emit({
            level: 'debug',
            event_type: AUDIT_EVENT_TYPES.HEARTBEAT,
            phase: snap.phase,
            status: 'running',
            progress_pct: snap.progress_pct,
            eta_ms: eta.eta_ms,
            elapsed_ms: snap.elapsed_ms,
            remaining_step_keys: remainingKeys.slice(0, 8),
            message: `Heartbeat: ${snap.progress_pct}% (${snap.steps_done}/${snap.steps_total})`,
        });

        if (showProgress || showEta) {
            printProgress({
                runId,
                profile,
                progress: snap,
                eta,
                phase: snap.phase,
                message: 'heartbeat',
            });
        }
    }, heartbeatMs);

    const semanticPreflightStep = await execStep(
        'preflight',
        'preflight.semantic_preflight',
        'node',
        ['scripts/audit/preflight_semantic.mjs', '--json', '--no-fail'],
        { timeoutMs: 240000 },
    );
    const semanticPreflightJson = /** @type {any} */ (
        parseJsonFromMixedOutput(semanticPreflightStep.stdout) ||
            parseJsonFromMixedOutput(`${semanticPreflightStep.stdout}\n${semanticPreflightStep.stderr}`)
    );
    if (semanticPreflightJson && typeof semanticPreflightJson === 'object') {
        semanticPreflight = {
            ok: Boolean(semanticPreflightJson.ok),
            components: semanticPreflightJson.components || semanticPreflight.components,
            issues: Array.isArray(semanticPreflightJson.issues) ? semanticPreflightJson.issues : [],
        };
    } else {
        warnings.push({
            source: 'semantic-preflight',
            message: 'semantic preflight returned non-JSON output; fallback state applied',
        });
    }
    stateStore.writeSemanticPreflight(semanticPreflight);

    await execStep('preflight', 'preflight.contract_registry', 'node', [
        '-e',
        'process.stdout.write("contract-registry-ok")',
    ]);

    contractRegistry = loadContractRegistry({
        domainsFilter: selectedDomains.length > 0 ? selectedDomains : undefined,
    });
    stateStore.writeContractRegistrySnapshot({
        registry_path: contractRegistry.registryPath,
        loaded_at: new Date().toISOString(),
        contracts_total: contractRegistry.contracts.length,
        errors: contractRegistry.errors,
        warnings: contractRegistry.warnings,
    });

    if (contractRegistry.errors.length > 0) {
        const message = contractRegistry.errors.join('; ');
        if (contractsMode === 'strict') {
            errors.push({ source: 'contract-registry', message });
        } else {
            warnings.push({ source: 'contract-registry', message });
        }
    }
    if (contractRegistry.warnings.length > 0) {
        warnings.push(...contractRegistry.warnings.map((message) => ({ source: 'contract-registry', message })));
    }

    const dslContracts = contractRegistry.contracts.filter((item) => item.status === 'active');
    const legacyContracts = getLegacyStaticContracts();
    if (contractsMode === 'legacy') {
        activeContracts = legacyContracts;
    } else if (contractsMode === 'strict') {
        activeContracts = dslContracts;
    } else {
        const merged = [...dslContracts];
        const seen = new Set(merged.map((item) => item.id));
        for (const legacy of legacyContracts) {
            if (!seen.has(legacy.id)) {
                merged.push(legacy);
                seen.add(legacy.id);
            }
        }
        activeContracts = merged;
    }

    logger.emit({
        level: 'info',
        event_type: AUDIT_EVENT_TYPES.CONTRACT_LOADED,
        phase: 'preflight',
        status: 'completed',
        message: `Contracts loaded: ${activeContracts.length} (mode=${contractsMode})`,
    });

    if (contractsMode === 'hybrid') {
        const parityStep = await execStep(
            'preflight',
            'preflight.contract_parity',
            'node',
            ['scripts/check_forbidden_patterns.js', '--json', '--contracts-mode', 'hybrid', '--parity-mode'],
            { timeoutMs: 180000, acceptExitCodes: [0, 2] },
        );
        const parityPayload = /** @type {any} */ (
            parseJsonFromMixedOutput(parityStep.stdout) ||
                parseJsonFromMixedOutput(`${parityStep.stdout}\n${parityStep.stderr}`)
        );
        if (parityPayload?.parity) {
            contractParity = parityPayload.parity;
        } else {
            logger.emit({
                level: 'info',
                event_type: AUDIT_EVENT_TYPES.WARNING,
                phase: 'preflight',
                status: 'completed',
                message: 'contract parity payload unavailable in hybrid mode (non-fatal)',
            });
        }
    } else {
        await execStep('preflight', 'preflight.contract_parity', 'node', [
            '-e',
            'process.stdout.write("parity-skipped-non-hybrid")',
        ]);
    }
    stateStore.writeContractParity(contractParity);

    const changedFiles = await resolveChangedFiles(profile, changedOnly);
    finishPhase('preflight', 'completed');

    // context refresh
    if (refreshContextMode !== 'skip') {
        const shouldRefresh = refreshContextMode === 'force' || profile === 'nightly';
        if (shouldRefresh) {
            startPhase('context-refresh');
            const ragHealth = await execStep(
                'context-refresh',
                'context.rag_health',
                'npm',
                ['run', 'rag:health', '--', '--json'],
                { timeoutMs: 180000 },
            );
            const ragJson = /** @type {any} */ (parseJsonFromMixedOutput(`${ragHealth.stdout}\n${ragHealth.stderr}`));

            if (refreshContextMode === 'force' || !ragHealth.ok || !ragJson?.ok || !ragJson?.available) {
                const rebuild = await execStep(
                    'context-refresh',
                    'context.rag_index_core',
                    'npm',
                    ['run', 'rag:index', '--', '--profile', 'core', '--docs-mode', 'exclude'],
                    { timeoutMs: 900000 },
                );
                if (!rebuild.ok) {
                    warnings.push({
                        source: 'context-refresh',
                        message: 'Failed to refresh RAG index in nightly preflight',
                    });
                }
            }

            if (profile === 'nightly') {
                const docsPass = await execStep(
                    'context-refresh',
                    'context.rag_index_docs',
                    'npm',
                    ['run', 'rag:index', '--', '--profile', 'full', '--docs-mode', 'only'],
                    { timeoutMs: 900000 },
                );
                if (!docsPass.ok) {
                    warnings.push({ source: 'context-refresh', message: 'Docs-only nightly index pass failed' });
                }
            }

            finishPhase('context-refresh', 'completed');
        }
    } else {
        startPhase('context-refresh');
        for (const stepId of ['context.rag_health', 'context.rag_index_core', 'context.rag_index_docs']) {
            markStepSkipped('context-refresh', stepId, `Step skipped by --refresh-context=${refreshContextMode}`);
        }
        finishPhase('context-refresh', 'skipped');
    }

    // quality (smart hybrid)
    startPhase(AUDIT_PHASES.COLLECT_QUALITY);
    await runInternalStep(
        AUDIT_PHASES.COLLECT_QUALITY,
        'quality.plan_resolution',
        'Resolving smart-hybrid quality execution plan',
        async () => ({ ok: true }),
    );
    const qualityResult = /** @type {any} */ (
        await collectQualityFindings({
            profile,
            changedFiles,
            qualityMode,
            qualityJsdoc,
            qualityPrettier,
            qualityJsdocFullThresholdPct,
            qualityCache,
            qualityCacheDir,
            qualityParallelism,
            exec: (stepId, command, args, opts) => execStep(AUDIT_PHASES.COLLECT_QUALITY, stepId, command, args, opts),
        })
    );
    rawFindings = rawFindings.concat(qualityResult.findings);
    errors.push(...qualityResult.errors);
    warnings.push(...qualityResult.warnings);
    if ((qualityResult.telemetry?.fallbacks || []).length > 0) {
        await runInternalStep(
            AUDIT_PHASES.COLLECT_QUALITY,
            'quality.fallback_resolution',
            'Recording quality smart-hybrid fallbacks',
            async () => ({ ok: true, fallbacks: qualityResult.telemetry.fallbacks }),
        );
    } else {
        markStepSkipped(
            AUDIT_PHASES.COLLECT_QUALITY,
            'quality.fallback_resolution',
            'Sem fallback de quality nesta execução',
        );
    }
    for (const skipped of qualityResult.telemetry?.steps_skipped || []) {
        markStepSkipped(AUDIT_PHASES.COLLECT_QUALITY, skipped.step, skipped.reason);
    }
    finishPhase(AUDIT_PHASES.COLLECT_QUALITY, qualityResult.errors.length > 0 ? 'failed' : 'completed');

    // static
    const qualityCollectorActive = qualityMode !== 'off';
    const staticResult = /** @type {any} */ ({ findings: [], errors: [], warnings: [], telemetry: {} });
    if (!shouldRunPhase(AUDIT_PHASES.COLLECT_STATIC)) {
        startPhase(AUDIT_PHASES.COLLECT_STATIC);
        for (const stepId of [
            'static.syntax',
            'static.forbidden',
            'static.lint',
            'static.typecheck',
            'static.madge',
            'static.depcruise',
            'static.jscpd',
            'static.semgrep',
        ]) {
            markStepSkipped(AUDIT_PHASES.COLLECT_STATIC, stepId, `Step skipped by audit_mode=${auditMode}`);
        }
        finishPhase(AUDIT_PHASES.COLLECT_STATIC, 'skipped');
    } else {
        startPhase(AUDIT_PHASES.COLLECT_STATIC);
        Object.assign(
            staticResult,
            await collectStaticFindings(
                /** @type {any} */ ({
                    profile,
                    changedFiles,
                    artifactsDir: runDir,
                    contractsMode,
                    skipQuickSyntax: qualityCollectorActive,
                    skipLintTypecheck: qualityCollectorActive,
                    exec: (
                        /** @type {any} */ stepId,
                        /** @type {any} */ command,
                        /** @type {any} */ args,
                        /** @type {any} */ opts,
                    ) => execStep(AUDIT_PHASES.COLLECT_STATIC, stepId, command, args, opts),
                }),
            ),
        );
        rawFindings = rawFindings.concat(staticResult.findings);
        errors.push(...staticResult.errors);
        warnings.push(...staticResult.warnings);
        if (profile === 'quick' && qualityCollectorActive) {
            markStepSkipped(
                AUDIT_PHASES.COLLECT_STATIC,
                'static.syntax',
                'Step moved to collect-quality (quality.node_check)',
            );
        } else if (profile !== 'quick' && qualityCollectorActive) {
            markStepSkipped(AUDIT_PHASES.COLLECT_STATIC, 'static.lint', 'Step moved to collect-quality (quality.lint)');
            markStepSkipped(
                AUDIT_PHASES.COLLECT_STATIC,
                'static.typecheck',
                'Step moved to collect-quality (quality.typecheck_*)',
            );
        }
        if (
            staticResult.warnings.some(
                (/** @type {any} */ item) =>
                    item.source === 'dependency-cruiser' && /not installed/i.test(String(item.message || '')),
            )
        ) {
            markStepSkipped(
                AUDIT_PHASES.COLLECT_STATIC,
                'static.depcruise',
                'Step skipped: dependency-cruiser não instalado',
            );
        }
        if (
            staticResult.warnings.some(
                (/** @type {any} */ item) =>
                    item.source === 'semgrep' && /not installed/i.test(String(item.message || '')),
            )
        ) {
            markStepSkipped(AUDIT_PHASES.COLLECT_STATIC, 'static.semgrep', 'Step skipped: semgrep não instalado');
        }
        const staticFailed = staticResult.errors.length > 0;
        finishPhase(AUDIT_PHASES.COLLECT_STATIC, staticFailed ? 'failed' : 'completed');
    }

    // runtime
    const runtimeResult = {
        findings: [],
        errors: [],
        warnings: [],
        telemetry: {
            mcp: { ok: false, details: 'skipped' },
            rag: { ok: false, available: false, degraded: true },
            lsp: { ok: false, details: 'skipped' },
        },
    };
    if (!shouldRunPhase(AUDIT_PHASES.COLLECT_RUNTIME)) {
        startPhase(AUDIT_PHASES.COLLECT_RUNTIME);
        for (const stepId of ['runtime.mcp_diagnose', 'runtime.rag_health', 'runtime.lsp_health', 'runtime.smoke']) {
            markStepSkipped(AUDIT_PHASES.COLLECT_RUNTIME, stepId, `Step skipped by audit_mode=${auditMode}`);
        }
        finishPhase(AUDIT_PHASES.COLLECT_RUNTIME, 'skipped');
    } else {
        startPhase(AUDIT_PHASES.COLLECT_RUNTIME);
        Object.assign(
            runtimeResult,
            await collectRuntimeFindings({
                profile,
                contracts: activeContracts,
                exec: (stepId, command, args, opts) =>
                    execStep(AUDIT_PHASES.COLLECT_RUNTIME, stepId, command, args, opts),
            }),
        );
        rawFindings = rawFindings.concat(runtimeResult.findings);
        errors.push(...runtimeResult.errors);
        warnings.push(...runtimeResult.warnings);
        finishPhase(AUDIT_PHASES.COLLECT_RUNTIME, runtimeResult.errors.length > 0 ? 'failed' : 'completed');
    }

    // tests
    const testsResult = { findings: [], errors: [], warnings: [], telemetry: {} };
    if (!shouldRunPhase(AUDIT_PHASES.COLLECT_TESTS)) {
        startPhase(AUDIT_PHASES.COLLECT_TESTS);
        for (const stepId of ['tests.smoke', 'tests.unit', 'tests.integration', 'tests.regression']) {
            markStepSkipped(AUDIT_PHASES.COLLECT_TESTS, stepId, `Step skipped by audit_mode=${auditMode}`);
        }
        finishPhase(AUDIT_PHASES.COLLECT_TESTS, 'skipped');
    } else {
        startPhase(AUDIT_PHASES.COLLECT_TESTS);
        Object.assign(
            testsResult,
            await collectTestFindings({
                profile,
                exec: (stepId, command, args, opts) =>
                    execStep(AUDIT_PHASES.COLLECT_TESTS, stepId, command, args, opts),
            }),
        );
        rawFindings = rawFindings.concat(testsResult.findings);
        errors.push(...testsResult.errors);
        warnings.push(...testsResult.warnings);
        finishPhase(AUDIT_PHASES.COLLECT_TESTS, testsResult.errors.length > 0 ? 'failed' : 'completed');
    }

    // chaos
    const chaosResult = {
        findings: [],
        errors: [],
        warnings: [],
        summary: {
            enabled: false,
            profile: 'off',
            scenarios_executed: 0,
            violations: 0,
        },
        eventsPath: path.join(runDir, 'chaos_events.jsonl'),
    };
    if (!shouldRunPhase(AUDIT_PHASES.COLLECT_CHAOS)) {
        startPhase(AUDIT_PHASES.COLLECT_CHAOS);
        markStepSkipped(
            AUDIT_PHASES.COLLECT_CHAOS,
            'chaos.contract_nightly',
            `Step skipped by audit_mode=${auditMode} or profile=${profile}`,
        );
        finishPhase(AUDIT_PHASES.COLLECT_CHAOS, 'skipped');
    } else {
        startPhase(AUDIT_PHASES.COLLECT_CHAOS);
        Object.assign(
            chaosResult,
            await evaluateChaosContracts({
                profile,
                chaosProfile,
                contracts: activeContracts,
                runDir,
                exec: (stepId, command, args, opts) =>
                    execStep(AUDIT_PHASES.COLLECT_CHAOS, stepId, command, args, opts),
            }),
        );
        rawFindings = rawFindings.concat(
            /** @type {import('./normalize/findings.mjs').RawFinding[]} */ (chaosResult.findings),
        );
        errors.push(...chaosResult.errors);
        warnings.push(...chaosResult.warnings);
        finishPhase(AUDIT_PHASES.COLLECT_CHAOS, chaosResult.errors.length > 0 ? 'failed' : 'completed');
    }

    // security
    if (!shouldRunPhase(AUDIT_PHASES.COLLECT_SECURITY)) {
        startPhase(AUDIT_PHASES.COLLECT_SECURITY);
        for (const stepId of ['security.contracts', 'security.http_surface', 'security.headers']) {
            markStepSkipped(AUDIT_PHASES.COLLECT_SECURITY, stepId, `Step skipped by audit_mode=${auditMode}`);
        }
        finishPhase(AUDIT_PHASES.COLLECT_SECURITY, 'skipped');
    } else {
        startPhase(AUDIT_PHASES.COLLECT_SECURITY);
        securityResult = await runInternalStep(
            AUDIT_PHASES.COLLECT_SECURITY,
            'security.contracts',
            'Running security collector',
            async () =>
                collectSecurityFindings({
                    rootDir: process.cwd(),
                    contracts: activeContracts,
                }),
        );
        rawFindings = rawFindings.concat(
            /** @type {import('./normalize/findings.mjs').RawFinding[]} */ (securityResult.findings),
        );
        errors.push(...securityResult.errors);
        warnings.push(...securityResult.warnings);
        markStepSkipped(AUDIT_PHASES.COLLECT_SECURITY, 'security.http_surface', 'Covered by collectSecurityFindings');
        markStepSkipped(AUDIT_PHASES.COLLECT_SECURITY, 'security.headers', 'Covered by collectSecurityFindings');
        if (
            securityResult.findings.length > 0 ||
            securityResult.warnings.length > 0 ||
            securityResult.errors.length > 0
        ) {
            logger.emit({
                level: 'info',
                event_type: AUDIT_EVENT_TYPES.SECURITY_ANALYSIS_COMPLETED,
                phase: AUDIT_PHASES.COLLECT_SECURITY,
                message: `Security analysis completed with ${securityResult.findings.length} issues found`,
                domain: 'security',
                findings_count: securityResult.findings.length,
                warnings_count: securityResult.warnings.length,
                errors_count: securityResult.errors.length,
            });
        }
        finishPhase(AUDIT_PHASES.COLLECT_SECURITY, securityResult.errors.length > 0 ? 'failed' : 'completed');
    }

    // performance
    if (!shouldRunPhase(AUDIT_PHASES.COLLECT_PERFORMANCE)) {
        startPhase(AUDIT_PHASES.COLLECT_PERFORMANCE);
        markStepSkipped(
            AUDIT_PHASES.COLLECT_PERFORMANCE,
            'performance.analysis',
            `Step skipped by audit_mode=${auditMode}`,
        );
        finishPhase(AUDIT_PHASES.COLLECT_PERFORMANCE, 'skipped');
    } else {
        startPhase(AUDIT_PHASES.COLLECT_PERFORMANCE);
        performanceResult = await collectPerformanceFindings(process.cwd());
        rawFindings = rawFindings.concat(performanceResult.findings);
        errors.push(...performanceResult.errors);
        warnings.push(...performanceResult.warnings);
        if (performanceResult.findings.length > 0) {
            logger.emit({
                level: 'info',
                event_type: AUDIT_EVENT_TYPES.PERFORMANCE_ANALYSIS_COMPLETED,
                phase: AUDIT_PHASES.COLLECT_PERFORMANCE,
                message: `Performance analysis completed with ${performanceResult.findings.length} issues found`,
                domain: 'performance',
                findings_count: performanceResult.findings.length,
                warnings_count: performanceResult.warnings.length,
                errors_count: performanceResult.errors.length,
            });
        }
        finishPhase(AUDIT_PHASES.COLLECT_PERFORMANCE, performanceResult.errors.length > 0 ? 'failed' : 'completed');
    }

    // architecture
    if (!shouldRunPhase(AUDIT_PHASES.COLLECT_ARCHITECTURE)) {
        startPhase(AUDIT_PHASES.COLLECT_ARCHITECTURE);
        markStepSkipped(
            AUDIT_PHASES.COLLECT_ARCHITECTURE,
            'architecture.analysis',
            `Step skipped by audit_mode=${auditMode}`,
        );
        finishPhase(AUDIT_PHASES.COLLECT_ARCHITECTURE, 'skipped');
    } else {
        startPhase(AUDIT_PHASES.COLLECT_ARCHITECTURE);
        architectureResult = await collectArchitectureFindings(process.cwd());
        rawFindings = rawFindings.concat(architectureResult.findings);
        errors.push(...architectureResult.errors);
        warnings.push(...architectureResult.warnings);
        if (architectureResult.findings.length > 0) {
            logger.emit({
                level: 'info',
                event_type: AUDIT_EVENT_TYPES.ARCHITECTURE_ANALYSIS_COMPLETED,
                phase: AUDIT_PHASES.COLLECT_ARCHITECTURE,
                message: `Architecture analysis completed with ${architectureResult.findings.length} issues found`,
                domain: 'architecture',
                findings_count: architectureResult.findings.length,
                warnings_count: architectureResult.warnings.length,
                errors_count: architectureResult.errors.length,
            });
        }
        finishPhase(AUDIT_PHASES.COLLECT_ARCHITECTURE, architectureResult.errors.length > 0 ? 'failed' : 'completed');
    }

    stateStore.writeFindingsRaw(rawFindings);

    /** @type {import('./lib/schema.mjs').AuditFindingV3[]} */
    let findings = [];

    // normalize
    startPhase(AUDIT_PHASES.NORMALIZE_CORRELATE);
    findings = await runInternalStep(
        AUDIT_PHASES.NORMALIZE_CORRELATE,
        'normalize.findings',
        'Normalizing findings',
        async () =>
            normalizeFindings(rawFindings, {
                masterPath: MASTER_PATH,
                now: startedAtDate,
            }),
    );
    const evidencePack = /** @type {any} */ (
        await runInternalStep(
            AUDIT_PHASES.NORMALIZE_CORRELATE,
            'normalize.evidence_graph',
            'Building evidence graph',
            async () => buildEvidenceGraph(findings),
        )
    );
    findings = evidencePack.findings;
    stateStore.writeEvidenceGraph(evidencePack.graph);
    logger.emit({
        level: 'info',
        event_type: AUDIT_EVENT_TYPES.CONTRACT_CORRELATED,
        phase: AUDIT_PHASES.NORMALIZE_CORRELATE,
        status: 'completed',
        message: `Evidence graph built with ${evidencePack.graph.nodes.length} nodes`,
    });
    finishPhase(AUDIT_PHASES.NORMALIZE_CORRELATE, 'completed');

    // triage
    const triageBudget = profile === 'quick' ? 40 : profile === 'deep' ? 120 : 200;
    const effectiveProposalDepth = proposalDepth === 'off' ? 'basic' : proposalDepth;
    let lastTriageProgressTs = 0;
    if (!shouldRunPhase(AUDIT_PHASES.TRIAGE_INTELLIGENCE)) {
        startPhase(AUDIT_PHASES.TRIAGE_INTELLIGENCE);
        markStepSkipped(AUDIT_PHASES.TRIAGE_INTELLIGENCE, 'triage.enrich', `Step skipped by audit_mode=${auditMode}`);
        finishPhase(AUDIT_PHASES.TRIAGE_INTELLIGENCE, 'skipped');
    } else {
        startPhase(AUDIT_PHASES.TRIAGE_INTELLIGENCE);
        let triage;
        try {
            triage = await runInternalStep(
                AUDIT_PHASES.TRIAGE_INTELLIGENCE,
                'triage.enrich',
                `Running triage intelligence (budget=${triageBudget}, timeout=${triageTimeoutMs}ms)`,
                async () =>
                    triageFindings(
                        findings,
                        /** @type {any} */ ({
                            enabled: triageEnabled && proposalDepth !== 'off',
                            maxMcpFindings: triageBudget,
                            proposeDiffs,
                            focusMode,
                            proposalDepth: effectiveProposalDepth,
                            cloudFallback,
                            masterPath: MASTER_PATH,
                            maxDurationMs: triageTimeoutMs,
                            onProgress: (/** @type {any} */ payload) => {
                                const now = Date.now();
                                const shouldEmit =
                                    payload.processed <= 2 ||
                                    payload.processed === payload.total ||
                                    payload.processed % 20 === 0 ||
                                    now - lastTriageProgressTs >= 5000;
                                if (!shouldEmit) {
                                    return;
                                }
                                lastTriageProgressTs = now;
                                const triageRemaining = getRemainingStepKeys();
                                const triageEta = etaEstimator.estimateRemaining(triageRemaining);
                                const triageSnap = progress.snapshot(triageEta.eta_ms);
                                logger.emit({
                                    level: 'debug',
                                    event_type: AUDIT_EVENT_TYPES.STEP_PROGRESS,
                                    phase: AUDIT_PHASES.TRIAGE_INTELLIGENCE,
                                    step_id: 'triage.enrich',
                                    status: 'running',
                                    progress_pct: triageSnap.progress_pct,
                                    eta_ms: triageSnap.eta_ms,
                                    message: `triage progress ${payload.processed}/${payload.total} (${payload.percent}%) mode=${payload.mode}`,
                                });
                            },
                        }),
                    ),
                { timeoutMs: triageTimeoutMs + 15000 },
            );
        } catch (error) {
            warnings.push({
                source: 'triage_llm',
                message: `triage internal step failed; deterministic fallback used (${error instanceof Error ? error.message : String(error)})`,
            });
            triage = await triageFindings(
                findings,
                /** @type {any} */ ({
                    enabled: false,
                    focusMode,
                    proposalDepth: effectiveProposalDepth,
                    cloudFallback,
                    masterPath: MASTER_PATH,
                }),
            );
        }
        findings = triage.findings;
        warnings.push(...triage.warnings.map((message) => ({ source: 'triage_llm', message })));
        logger.emit({
            level: 'info',
            event_type: AUDIT_EVENT_TYPES.PROPOSAL_GENERATED,
            phase: AUDIT_PHASES.TRIAGE_INTELLIGENCE,
            status: 'completed',
            message: `Proposals generated for ${findings.length} findings`,
        });
        finishPhase(AUDIT_PHASES.TRIAGE_INTELLIGENCE, 'completed');
    }

    if (maxFindings > 0) {
        findings = findings.slice(0, maxFindings);
    }

    const primaryFindings =
        focusMode === 'bug-first' ? findings.filter((f) => f.finding_channel === 'primary') : findings;
    const backlogFindings = focusMode === 'bug-first' ? findings.filter((f) => f.finding_channel === 'backlog') : [];

    stateStore.writeFindingsNormalized(findings);
    stateStore.writeProposals(
        findings.map((finding) => ({
            id: finding.id,
            severity: finding.severity,
            type: finding.type,
            confidence_score: finding.confidence_score,
            blast_radius: finding.blast_radius,
            proposal: finding.proposal,
        })),
    );

    /** @type {Record<string, number>} */
    const bySeverity = { P0: 0, P1: 0, P2: 0, P3: 0 };
    /** @type {Record<string, number>} */
    const byStatus = {};

    for (const finding of findings) {
        bySeverity[finding.severity] = (bySeverity[finding.severity] || 0) + 1;
        byStatus[finding.status] = (byStatus[finding.status] || 0) + 1;
        if (finding.contract_id) {
            logger.emit({
                level: 'debug',
                event_type: AUDIT_EVENT_TYPES.CONTRACT_VIOLATED,
                phase: 'normalize-correlate',
                status: 'completed',
                message: `${finding.contract_id} violated by ${finding.id}`,
            });
        }
    }

    /**
     * @param {import('./contracts/load_registry.mjs').ContractDefinitionV1} contract
     */
    function isContractEligibleByProfile(contract) {
        const kind = String(contract.kind || '');
        if (kind === 'chaos') {
            return profile === 'nightly' && chaosProfile !== 'off';
        }
        if (profile === 'quick') {
            return kind !== 'chaos';
        }
        if (profile === 'deep') {
            return kind !== 'chaos';
        }
        return true;
    }

    /**
     * @param {import('./contracts/load_registry.mjs').ContractDefinitionV1} contract
     */
    function isContractCoveredByTests(contract) {
        const kind = String(contract.kind || '');
        if (profile === 'nightly') {
            return kind !== 'chaos';
        }
        if (profile === 'deep') {
            const recipe = (contract.test_recipe || []).join(' ');
            return recipe.includes('test:unit') || recipe.includes('tests/unit/');
        }
        if (profile === 'quick') {
            return contract.id === 'CONTRACT-PROTOCOL-RUNTIME-SMOKE';
        }
        return false;
    }

    /** @type {Record<
    string,
    { total: number; violated: number; covered: number; covered_by_run: number; covered_by_tests: number }
>} */
    const contractCoverage = {};
    const violatedContracts = new Set(findings.map((item) => item.contract_id).filter(Boolean));
    /** @type {Set<string>} */
    const eligibleContracts = new Set();
    for (const contract of activeContracts) {
        const domain = contract.domain || 'unknown';
        if (!contractCoverage[domain]) {
            contractCoverage[domain] = { total: 0, violated: 0, covered: 0, covered_by_run: 0, covered_by_tests: 0 };
        }
        contractCoverage[domain].total += 1;
        const coveredByRun = isContractEligibleByProfile(contract);
        const coveredByTests = isContractCoveredByTests(contract);
        if (coveredByRun) {
            contractCoverage[domain].covered += 1;
            contractCoverage[domain].covered_by_run += 1;
            eligibleContracts.add(contract.id);
        }
        if (coveredByTests) {
            contractCoverage[domain].covered_by_tests += 1;
        }
        if (violatedContracts.has(contract.id)) {
            contractCoverage[domain].violated += 1;
        }
    }

    const staleContracts = activeContracts
        .filter((contract) => contract.status === 'active' && !eligibleContracts.has(contract.id))
        .map((contract) => contract.id);
    const unownedCritical = activeContracts
        .filter(
            (contract) =>
                (contract.severity_default === 'P0' || contract.severity_default === 'P1') &&
                (!contract.owner || contract.owner === 'legacy-adapter' || contract.owner === 'unknown'),
        )
        .map((contract) => contract.id);
    const testsWithoutContract = findings
        .filter((item) => item.source_tool.includes('test') && !item.contract_id)
        .map((item) => item.id);

    const contractDrift = {
        stale_contracts: staleContracts,
        unowned_critical: unownedCritical,
        tests_without_contract: testsWithoutContract,
    };

    const blockingFindings = findings.filter((item) => {
        if (enforceLevel === 'off' || enforceLevel === 'warn') {
            return false;
        }
        if (enforceLevel === 'p1') {
            return (
                (item.severity === 'P0' || item.severity === 'P1') &&
                (item.enforcement_state === 'p1' || item.enforcement_state === 'p0')
            );
        }
        return item.severity === 'P0' && item.enforcement_state === 'p0';
    });
    const gateDecision = {
        enforce_level: enforceLevel,
        blocking: blockingFindings.length > 0,
        blocking_findings: blockingFindings.map((item) => item.id),
    };
    const shadowBlockingFindings = findings.filter(
        (item) =>
            (item.severity === 'P0' || item.severity === 'P1') &&
            (item.type === 'bug' || item.type === 'gap' || item.type === 'falha de contrato') &&
            (item.enforcement_state === 'p1' || item.enforcement_state === 'p0'),
    );
    const shadowGate = {
        enabled: shadowGateEnabled,
        would_block: shadowGateEnabled && shadowBlockingFindings.length > 0,
        blocking_findings: shadowBlockingFindings.map((item) => item.id),
        reason: shadowGateEnabled
            ? shadowBlockingFindings.length > 0
                ? 'P0/P1 elegíveis para bloqueio detectados (shadow mode).'
                : 'Nenhum P0/P1 elegível para bloqueio em shadow mode.'
            : 'Shadow gate desabilitado por configuração.',
    };

    const noiseWarnings = warnings.filter((item) => String(item?.message || '').includes('NO_COLOR'));
    const normalizedWarnings = warnings.filter((item) => !String(item?.message || '').includes('NO_COLOR'));
    const telemetryNoise = {
        ignored_warning_lines: noiseWarnings.length,
        normalized_warnings: normalizedWarnings.length,
    };

    stateStore.writeContractCoverage(contractCoverage);
    stateStore.writeContractDrift(contractDrift);
    stateStore.writeGateDecisions(gateDecision);
    stateStore.writeLogStats(logStats);
    logger.emit({
        level: gateDecision.blocking || shadowGate.would_block ? 'warn' : 'info',
        event_type: AUDIT_EVENT_TYPES.GATE_DECISION_MADE,
        phase: 'publish',
        status: gateDecision.blocking ? 'failed' : 'completed',
        message: `Gate decision: blocking=${gateDecision.blocking} shadow_would_block=${shadowGate.would_block} level=${enforceLevel}`,
    });

    const schemaToken = String(SCHEMA_VERSION).replace(/\./g, '_');
    if (abortRequested) {
        runOutcome = 'aborted';
    }
    const hasFailedPhase = () => phaseStatus.some((item) => item.status === 'failed');
    const hasExecutionErrors = () =>
        errors.length > 0 || findings.some((item) => item.partial === true) || hasFailedPhase();

    /**
     * @param {{
     *     finishedAtIso: string;
     *     durationMsTotal: number;
     *     remainingStepKeys: string[];
     *     progressSnapshot: ReturnType<typeof progress.snapshot>;
     *     eta: {
     *         eta_ms: number;
     *         eta_confidence: number;
     *         model: string;
     *         eta_error_ms: number;
     *         confidence_reason: string | null;
     *     };
     * }} metrics
     */
    function buildAuditReport(metrics) {
        const summaryPartial = runOutcome === 'aborted' || runOutcome === 'fatal' || hasExecutionErrors();
        if (runOutcome !== 'aborted' && runOutcome !== 'fatal') {
            runOutcome = summaryPartial ? 'partial' : 'success';
        }
        const activePhases = phasePlan
            .filter((/** @type {any} */ item) => (item.planned_steps || []).length > 0)
            .map((/** @type {any} */ item) => item.id);
        const skippedPhases = phasePlan
            .filter((/** @type {any} */ item) => (item.planned_steps || []).length === 0)
            .map((/** @type {any} */ item) => item.id);
        return /** @type {import('./lib/schema.mjs').AuditRunV3 & { errors_count: number; warnings_count: number }} */ ({
            schema_version: SCHEMA_VERSION,
            run_id: runId,
            profile,
            audit_mode: auditMode,
            scope,
            focus_mode: focusMode,
            focus_area: auditMode,
            contracts_mode: contractsMode,
            enforce_level: enforceLevel,
            proposal_depth: proposalDepth,
            started_at: startedAtDate.toISOString(),
            finished_at: metrics.finishedAtIso,
            run_outcome: runOutcome,
            abort_reason: abortReason,
            duration_ms_total: metrics.durationMsTotal,
            remaining_step_keys: metrics.remainingStepKeys,
            tool_versions: toolVersions,
            summary: {
                total_findings: findings.length,
                total_primary: primaryFindings.length,
                total_backlog: backlogFindings.length,
                by_severity: bySeverity,
                by_status: byStatus,
                partial: summaryPartial,
            },
            progress: {
                steps_done: metrics.progressSnapshot.steps_done,
                steps_total: metrics.progressSnapshot.steps_total,
                progress_pct: metrics.progressSnapshot.progress_pct,
                remaining_steps: metrics.progressSnapshot.remaining_steps,
            },
            collector_plan: {
                active_phases: activePhases,
                skipped_phases: skippedPhases,
            },
            eta: metrics.eta,
            phase_status: phaseStatus,
            findings,
            primary_findings: primaryFindings,
            backlog_findings: backlogFindings,
            errors,
            warnings: normalizedWarnings,
            errors_count: errors.length,
            warnings_count: normalizedWarnings.length,
            telemetry: runtimeResult.telemetry,
            semantic_preflight: semanticPreflight,
            shadow_gate: shadowGate,
            telemetry_noise: telemetryNoise,
            log_stats: logStats,
            degradation: {
                mcp_degraded: !runtimeResult.telemetry.mcp.ok,
                rag_degraded: !runtimeResult.telemetry.rag.ok || runtimeResult.telemetry.rag.degraded === true,
                lsp_degraded: !runtimeResult.telemetry.lsp.ok,
                tooling_degraded:
                    qualityResult.errors.length > 0 || staticResult.errors.length > 0 || testsResult.errors.length > 0,
            },
            quality_gates: {
                forbidden_ok: staticResult.telemetry?.gates?.forbidden_ok ?? null,
                typecheck_ok: staticResult.telemetry?.gates?.typecheck_ok ?? null,
                node_check_ok: qualityResult.telemetry?.gates?.node_check_ok ?? null,
                entrypoint_import_smoke_ok: qualityResult.telemetry?.gates?.entrypoint_import_smoke_ok ?? null,
                lint_ok: qualityResult.telemetry?.gates?.lint_ok ?? null,
                typecheck_node_ok: qualityResult.telemetry?.gates?.typecheck_node_ok ?? null,
                typecheck_browser_ok: qualityResult.telemetry?.gates?.typecheck_browser_ok ?? null,
                prettier_ok: qualityResult.telemetry?.gates?.prettier_ok ?? null,
                jsdoc_delta_ok: qualityResult.telemetry?.gates?.jsdoc_delta_ok ?? null,
                jsdoc_full_ok: qualityResult.telemetry?.gates?.jsdoc_full_ok ?? null,
                ts_ignore_ok: qualityResult.telemetry?.gates?.ts_ignore_ok ?? null,
                runtime_smoke_ok:
                    profile === 'quick'
                        ? null
                        : runtimeResult.findings.every(
                              (/** @type {any} */ item) => item.source_tool !== 'runtime-smoke',
                          ),
                tests_ok: testsResult.errors.length === 0,
            },
            quality_execution: {
                strategy: qualityResult.telemetry?.strategy ?? null,
                risk: qualityResult.telemetry?.risk ?? null,
                changed_files_count: qualityResult.telemetry?.changed_files_count ?? 0,
                decision_reasons: Array.isArray(qualityResult.telemetry?.reasons)
                    ? qualityResult.telemetry.reasons
                    : [],
                fallbacks: Array.isArray(qualityResult.telemetry?.fallbacks) ? qualityResult.telemetry.fallbacks : [],
                steps_executed: Array.isArray(qualityResult.telemetry?.steps_executed)
                    ? qualityResult.telemetry.steps_executed
                    : [],
                steps_skipped: Array.isArray(qualityResult.telemetry?.steps_skipped)
                    ? qualityResult.telemetry.steps_skipped
                    : [],
                duration_ms_by_step:
                    qualityResult.telemetry && typeof qualityResult.telemetry.duration_ms_by_step === 'object'
                        ? qualityResult.telemetry.duration_ms_by_step
                        : {},
                impact:
                    qualityResult.telemetry && typeof qualityResult.telemetry.impact === 'object'
                        ? qualityResult.telemetry.impact
                        : {},
                jsdoc:
                    qualityResult.telemetry && typeof qualityResult.telemetry.jsdoc === 'object'
                        ? qualityResult.telemetry.jsdoc
                        : {},
                cache:
                    qualityResult.telemetry && typeof qualityResult.telemetry.cache === 'object'
                        ? qualityResult.telemetry.cache
                        : {},
                parallelism:
                    qualityResult.telemetry && typeof qualityResult.telemetry.parallelism === 'object'
                        ? qualityResult.telemetry.parallelism
                        : {},
                dedup:
                    qualityResult.telemetry && typeof qualityResult.telemetry.dedup === 'object'
                        ? qualityResult.telemetry.dedup
                        : {},
            },
            security_execution: {
                enabled: shouldRunPhase(AUDIT_PHASES.COLLECT_SECURITY),
                checks: Array.isArray(securityResult.telemetry?.checks) ? securityResult.telemetry.checks : [],
                findings: securityResult.findings.length,
                warnings: securityResult.warnings.length,
                errors: securityResult.errors.length,
            },
            performance_execution: {
                enabled: shouldRunPhase(AUDIT_PHASES.COLLECT_PERFORMANCE),
                score: performanceResult.telemetry?.score ?? null,
                categories:
                    performanceResult.telemetry && typeof performanceResult.telemetry.categories === 'object'
                        ? performanceResult.telemetry.categories
                        : {},
                findings: performanceResult.findings.length,
                warnings: performanceResult.warnings.length,
                errors: performanceResult.errors.length,
            },
            contract_coverage: contractCoverage,
            contract_drift: contractDrift,
            contract_parity: contractParity,
            gate_decision: gateDecision,
            chaos_summary: chaosResult.summary,
            artifacts: {
                run_dir: runDir,
                events_jsonl: logger.eventsPath,
                progress_json: stateStore.paths.progressPath,
                phase_timeline_json: stateStore.paths.phaseTimelinePath,
                findings_raw_json: stateStore.paths.findingsRawPath,
                findings_normalized_json: stateStore.paths.findingsNormalizedPath,
                proposals_json: stateStore.paths.proposalsPath,
                audit_report_json: path.join(runDir, `audit_report_v${schemaToken}.json`),
                summary_md: stateStore.paths.summaryPath,
                contract_registry_snapshot_json: stateStore.paths.contractRegistrySnapshotPath,
                semantic_preflight_json: stateStore.paths.semanticPreflightPath,
                log_stats_json: stateStore.paths.logStatsPath,
                contract_coverage_json: stateStore.paths.contractCoveragePath,
                contract_drift_json: stateStore.paths.contractDriftPath,
                contract_parity_json: stateStore.paths.contractParityPath,
                evidence_graph_json: stateStore.paths.evidenceGraphPath,
                gate_decisions_json: stateStore.paths.gateDecisionsPath,
                chaos_events_jsonl: chaosResult.eventsPath,
            },
        });
    }

    const prePublishDurationMs = Date.now() - startedAtDate.getTime();
    const prePublishRemainingStepKeys = getRemainingStepKeys();
    const prePublishEta = {
        eta_ms: Math.max(0, Math.round(etaEstimator.estimateRemaining(prePublishRemainingStepKeys).eta_ms || 0)),
        eta_confidence: 0.98,
        model: 'history+online',
        eta_error_ms: Math.abs(Number(plannedStartEta.eta_ms || 0) - prePublishDurationMs),
        confidence_reason: plannedStartEta.confidence_reason || null,
    };
    const prePublishProgressSnapshot = progress.snapshot(prePublishEta.eta_ms);
    prePublishProgressSnapshot.remaining_step_keys = prePublishRemainingStepKeys.slice(0, 10);

    let report = buildAuditReport({
        finishedAtIso: new Date().toISOString(),
        durationMsTotal: prePublishDurationMs,
        remainingStepKeys: prePublishRemainingStepKeys,
        progressSnapshot: prePublishProgressSnapshot,
        eta: prePublishEta,
    });

    startPhase('publish');
    const publishedJson = await runInternalStep(
        'publish',
        'publish.json',
        'Publishing JSON report artifacts',
        async () => publishJson(report, { outputDir: outputRoot, runDir }),
    );
    /** @type {any} */
    /** @type {any} */
    const outputs = {
        json: publishedJson.path,
        run_json: publishedJson.runReportPath,
        master: null,
        snapshot: null,
    };

    if (publishMaster) {
        const masterPublished = await runInternalStep(
            'publish',
            'publish.master',
            'Publishing BUG_AUDIT_MASTER.md',
            async () => publishMasterMarkdown(report, { masterPath: MASTER_PATH }),
        );
        outputs.master = masterPublished.path;
    } else {
        markStepSkipped('publish', 'publish.master', 'Step skipped: publish-master desabilitado');
    }

    if (shouldPublishSnapshot && outputs.master) {
        const snapshotPublished = await runInternalStep(
            'publish',
            'publish.snapshot',
            'Publishing immutable snapshot',
            async () =>
                publishSnapshot(/** @type {any} */ ({ masterPath: MASTER_PATH, snapshotsDir: SNAPSHOTS_DIR, report })),
        );
        outputs.snapshot = snapshotPublished.path;
    } else {
        markStepSkipped('publish', 'publish.snapshot', 'Step skipped: snapshot desabilitado ou master indisponível');
    }

    if (contractCoverageReport) {
        await runInternalStep(
            'publish',
            'publish.contract_reports',
            'Rendering contract coverage report summary',
            async () => renderContractCoverage(contractCoverage, /** @type {any} */ (contractDrift)),
        );
    } else {
        markStepSkipped('publish', 'publish.contract_reports', 'Step skipped: contract coverage report desabilitado');
    }

    finishPhase('publish', 'completed');

    const finalDurationMs = Date.now() - startedAtDate.getTime();
    const finalRemainingStepKeys = getRemainingStepKeys();
    const finalEta = {
        eta_ms: 0,
        eta_confidence: 0.98,
        model: 'history+online',
        eta_error_ms: Math.abs(Number(plannedStartEta.eta_ms || 0) - finalDurationMs),
        confidence_reason: plannedStartEta.confidence_reason || null,
    };
    const finalProgressSnapshot = progress.snapshot(finalEta.eta_ms);
    finalProgressSnapshot.remaining_step_keys = finalRemainingStepKeys.slice(0, 10);
    stateStore.writeProgress(finalProgressSnapshot);

    report = buildAuditReport({
        finishedAtIso: new Date().toISOString(),
        durationMsTotal: finalDurationMs,
        remainingStepKeys: finalRemainingStepKeys,
        progressSnapshot: finalProgressSnapshot,
        eta: finalEta,
    });

    const validation = validateAuditRun(report);
    if (!validation.ok) {
        errors.push({ source: 'schema', message: validation.errors.join('; ') });
        report = buildAuditReport({
            finishedAtIso: new Date().toISOString(),
            durationMsTotal: Date.now() - startedAtDate.getTime(),
            remainingStepKeys: getRemainingStepKeys(),
            progressSnapshot: progress.snapshot(0),
            eta: {
                eta_ms: 0,
                eta_confidence: 0.98,
                model: 'history+online',
                eta_error_ms: Math.abs(Number(plannedStartEta.eta_ms || 0) - (Date.now() - startedAtDate.getTime())),
                confidence_reason: plannedStartEta.confidence_reason || null,
            },
        });
    }

    const refreshedJson = publishJson(report, { outputDir: outputRoot, runDir });
    outputs.json = refreshedJson.path;
    outputs.run_json = refreshedJson.runReportPath;
    if (outputs.master) {
        publishMasterMarkdown(report, { masterPath: MASTER_PATH });
    }
    if (outputs.snapshot && fs.existsSync(MASTER_PATH)) {
        const masterContent = fs.readFileSync(MASTER_PATH, 'utf8');
        const nowIso = new Date().toISOString();
        const snapshotHeader = [
            '<!-- SNAPSHOT_METADATA_START -->',
            `- schema_version: ${report.schema_version}`,
            `- run_id: ${report.run_id}`,
            `- focus_mode: ${report.focus_mode}`,
            `- partial: ${report.summary.partial}`,
            `- eta_final_ms: ${report.eta.eta_ms}`,
            `- generated_at: ${nowIso}`,
            '<!-- SNAPSHOT_METADATA_END -->',
            '',
        ].join('\n');
        fs.writeFileSync(outputs.snapshot, `${snapshotHeader}${masterContent}`, 'utf8');
    }

    stateStore.writeSummary(
        [
            `# Audit v3.2 Summary`,
            ``,
            `- run_id: ${report.run_id}`,
            `- profile: ${report.profile}`,
            `- audit_mode: ${report.audit_mode}`,
            `- focus_mode: ${report.focus_mode}`,
            `- focus_area: ${report.focus_area}`,
            `- contracts_mode: ${report.contracts_mode}`,
            `- enforce_level: ${report.enforce_level}`,
            `- proposal_depth: ${report.proposal_depth}`,
            `- run_outcome: ${report.run_outcome}`,
            `- abort_reason: ${report.abort_reason}`,
            `- partial: ${report.summary.partial}`,
            `- duration_ms_total: ${report.duration_ms_total}`,
            `- total_findings: ${report.summary.total_findings}`,
            `- total_primary: ${report.summary.total_primary}`,
            `- total_backlog: ${report.summary.total_backlog}`,
            `- progress_pct: ${report.progress.progress_pct}`,
            `- eta_ms: ${report.eta.eta_ms}`,
            `- eta_error_ms: ${report.eta.eta_error_ms ?? 'n/a'}`,
            `- mcp_ok: ${report.telemetry.mcp.ok}`,
            `- rag_ok: ${report.telemetry.rag.ok}`,
            `- lsp_ok: ${report.telemetry.lsp.ok}`,
            `- semantic_preflight_ok: ${report.semantic_preflight.ok}`,
            `- shadow_would_block: ${report.shadow_gate.would_block}`,
            `- telemetry_noise_ignored: ${report.telemetry_noise.ignored_warning_lines}`,
            `- remaining_step_keys: ${(report.remaining_step_keys || []).slice(0, 8).join(', ') || 'none'}`,
            `- log_overflow_steps: ${report.log_stats.steps_with_overflow}`,
            `- gate_blocking: ${report.gate_decision.blocking}`,
            `- quality_strategy: ${report.quality_execution?.strategy || 'n/a'}`,
            `- quality_risk: ${report.quality_execution?.risk || 'n/a'}`,
            `- quality_lint_ok: ${report.quality_gates.lint_ok}`,
            `- quality_typecheck_node_ok: ${report.quality_gates.typecheck_node_ok}`,
            `- quality_typecheck_browser_ok: ${report.quality_gates.typecheck_browser_ok}`,
            `- quality_prettier_ok: ${report.quality_gates.prettier_ok}`,
            `- quality_ts_ignore_ok: ${report.quality_gates.ts_ignore_ok}`,
            `- security_enabled: ${report.security_execution?.enabled === true}`,
            `- security_findings: ${report.security_execution?.findings || 0}`,
            `- performance_enabled: ${report.performance_execution?.enabled === true}`,
            `- performance_score: ${report.performance_execution?.score ?? 'n/a'}`,
            `- chaos_enabled: ${report.chaos_summary.enabled}`,
            `- chaos_violations: ${report.chaos_summary.violations}`,
            ``,
            contractCoverageReport
                ? renderContractCoverage(contractCoverage, /** @type {any} */ (contractDrift))
                : null,
            ``,
            `## Artifacts`,
            `- report_json: ${outputs.json}`,
            `- run_report_json: ${outputs.run_json}`,
            `- semantic_preflight_json: ${report.artifacts.semantic_preflight_json}`,
            `- log_stats_json: ${report.artifacts.log_stats_json}`,
            `- contract_parity_json: ${report.artifacts.contract_parity_json}`,
            outputs.master ? `- master_md: ${outputs.master}` : null,
            outputs.snapshot ? `- snapshot_md: ${outputs.snapshot}` : null,
        ]
            .filter(Boolean)
            .join('\n') + '\n',
    );

    etaEstimator.persist();
    const retentionResult = /** @type {any} */ (
        pruneAuditRuns({
            runsRoot,
            maxRuns: retentionMaxRuns,
            keepRunId: runId,
        })
    );
    if (retentionResult.pruned.length > 0) {
        logger.emit({
            level: 'info',
            event_type: AUDIT_EVENT_TYPES.RETENTION_PRUNED,
            status: 'completed',
            message: `Retention pruned ${retentionResult.pruned.length} run(s)`,
            pruned_run_ids: retentionResult.pruned,
        });
    }

    if (heartbeat) {
        clearInterval(heartbeat);
    }
    cleanupSignalHandlers();

    logger.emit({
        level: String(runOutcome) === 'fatal' ? 'error' : report.summary.partial ? 'warn' : 'info',
        event_type: AUDIT_EVENT_TYPES.RUN_FINISHED,
        status: report.run_outcome,
        progress_pct: report.progress.progress_pct,
        eta_ms: report.eta.eta_ms,
        message: `Audit run finished (${report.run_id})`,
    });

    if (values.json) {
        console.log(JSON.stringify({ report, outputs }, null, 2));
    } else {
        printFinalReport(report, {
            jsonPath: outputs.json,
            masterPath: outputs.master,
            snapshotPath: outputs.snapshot,
        });
    }

    process.exit(0);
}

/**
 * Builds a minimal but schema-compatible fatal report when the runner crashes before the regular publish flow can
 * complete.
 *
 * @param {unknown} error
 */
function writeFatalFallbackReport(error) {
    const outputRoot = String(values['output-dir'] || OUTPUT_DIR);
    const now = new Date();
    const runId = `WAVE_AUDIT_FATAL_${now.toISOString().replace(/[:.]/g, '-')}`;
    const runDir = path.join(outputRoot, 'runs', runId);
    const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    const stateStore = /** @type {any} */ (createRunStateStore({ runDir }));
    const logger = /** @type {any} */ (
        createAuditLogger({
            runId,
            runDir,
            logLevel: 'info',
            logFormat: 'jsonl',
            enableConsole: false,
        })
    );
    const startedAtIso = now.toISOString();
    const finishedAtIso = new Date().toISOString();

    logger.emit({
        level: 'info',
        event_type: AUDIT_EVENT_TYPES.RUN_STARTED,
        status: 'running',
        message: `Audit run started (${runId}) [fatal-fallback]`,
        audit_mode: 'reactive_bug',
    });
    logger.emit({
        level: 'error',
        event_type: AUDIT_EVENT_TYPES.RUN_FATAL,
        status: 'fatal',
        message,
    });
    logger.emit({
        level: 'error',
        event_type: AUDIT_EVENT_TYPES.RUN_FINISHED,
        status: 'fatal',
        progress_pct: 0,
        eta_ms: 0,
        message: `Audit run finished (${runId}) [fatal-fallback]`,
    });

    stateStore.writeManifest({
        schema_version: SCHEMA_VERSION,
        run_id: runId,
        profile: 'quick',
        audit_mode: 'reactive_bug',
        scope: 'repo',
        started_at: startedAtIso,
        output_root: outputRoot,
        run_dir: runDir,
        options: {
            fatal_fallback: true,
        },
    });
    stateStore.writeProgress({
        phase: 'bootstrap',
        steps_done: 0,
        steps_total: 0,
        progress_pct: 0,
        remaining_steps: 0,
        elapsed_ms: 0,
        eta_ms: 0,
        remaining_step_keys: [],
    });
    stateStore.setPhaseTimeline([
        {
            phase: 'bootstrap',
            status: 'failed',
            started_at: startedAtIso,
            finished_at: finishedAtIso,
            elapsed_ms: 0,
        },
    ]);
    stateStore.writeFindingsRaw([]);
    stateStore.writeFindingsNormalized([]);
    stateStore.writeProposals([]);
    stateStore.writeContractCoverage({});
    stateStore.writeContractDrift({
        stale_contracts: [],
        unowned_critical: [],
        tests_without_contract: [],
    });
    stateStore.writeContractParity({
        enabled: false,
        dsl_findings: 0,
        legacy_findings: 0,
        mismatches: [],
    });
    stateStore.writeSemanticPreflight({
        ok: false,
        components: {
            pm2: { ok: false, details: 'fatal-fallback' },
            mcp: { ok: false, details: 'fatal-fallback' },
            rag: { ok: false, details: 'fatal-fallback' },
            lsp: { ok: false, details: 'fatal-fallback' },
        },
        issues: [message],
    });
    stateStore.writeLogStats({
        stdout_bytes_total: 0,
        stderr_bytes_total: 0,
        stdout_truncated_steps: [],
        stderr_truncated_steps: [],
        steps_with_overflow: 0,
        max_stdout_bytes: 0,
        max_stderr_bytes: 0,
    });
    stateStore.writeEvidenceGraph({ nodes: [], edges: [] });
    stateStore.writeGateDecisions({
        enforce_level: 'warn',
        blocking: false,
        blocking_findings: [],
    });

    const schemaToken = String(SCHEMA_VERSION).replace(/\./g, '_');
    const report = /** @type {import('./lib/schema.mjs').AuditRunV3} */ ({
        schema_version: SCHEMA_VERSION,
        run_id: runId,
        profile: /** @type {'quick'} */ ('quick'),
        audit_mode: /** @type {'reactive_bug'} */ ('reactive_bug'),
        scope: 'repo',
        focus_mode: 'bug-first',
        focus_area: 'fatal-fallback',
        contracts_mode: 'hybrid',
        enforce_level: 'warn',
        proposal_depth: 'standard',
        started_at: startedAtIso,
        finished_at: finishedAtIso,
        run_outcome: 'fatal',
        abort_reason: 'uncaught_exception',
        duration_ms_total: 0,
        remaining_step_keys: [],
        tool_versions: {},
        summary: {
            total_findings: 0,
            total_primary: 0,
            total_backlog: 0,
            by_severity: { P0: 0, P1: 0, P2: 0, P3: 0 },
            by_status: {},
            partial: true,
        },
        progress: {
            steps_done: 0,
            steps_total: 0,
            progress_pct: 0,
            remaining_steps: 0,
        },
        collector_plan: {
            active_phases: [],
            skipped_phases: [],
        },
        eta: {
            eta_ms: 0,
            eta_confidence: 0,
            model: 'fallback',
            eta_error_ms: null,
            confidence_reason: 'fatal-fallback-no-baseline',
        },
        phase_status: [
            {
                phase: 'bootstrap',
                status: 'failed',
                started_at: startedAtIso,
                finished_at: finishedAtIso,
                elapsed_ms: 0,
            },
        ],
        findings: [],
        primary_findings: [],
        backlog_findings: [],
        errors: [{ source: 'fatal', message }],
        warnings: [],
        telemetry: {
            mcp: { ok: false, details: 'fatal-fallback' },
            rag: { ok: false, available: false, degraded: true },
            lsp: { ok: false, details: 'fatal-fallback' },
        },
        semantic_preflight: {
            ok: false,
            components: {
                pm2: { ok: false, details: 'fatal-fallback' },
                mcp: { ok: false, details: 'fatal-fallback' },
                rag: { ok: false, details: 'fatal-fallback' },
                lsp: { ok: false, details: 'fatal-fallback' },
            },
            issues: [message],
        },
        shadow_gate: {
            enabled: true,
            would_block: false,
            blocking_findings: [],
            reason: 'fatal-fallback: triage pipeline not reached',
        },
        telemetry_noise: {
            ignored_warning_lines: 0,
            normalized_warnings: 0,
        },
        log_stats: {
            stdout_bytes_total: 0,
            stderr_bytes_total: 0,
            stdout_truncated_steps: [],
            stderr_truncated_steps: [],
            steps_with_overflow: 0,
            max_stdout_bytes: 0,
            max_stderr_bytes: 0,
        },
        degradation: {
            mcp_degraded: true,
            rag_degraded: true,
            lsp_degraded: true,
            tooling_degraded: true,
        },
        quality_gates: {
            forbidden_ok: null,
            typecheck_ok: null,
            node_check_ok: null,
            entrypoint_import_smoke_ok: null,
            lint_ok: null,
            typecheck_node_ok: null,
            typecheck_browser_ok: null,
            prettier_ok: null,
            jsdoc_delta_ok: null,
            jsdoc_full_ok: null,
            ts_ignore_ok: null,
            runtime_smoke_ok: null,
            tests_ok: null,
        },
        quality_execution: {
            strategy: 'fatal-fallback',
            risk: 'high',
            changed_files_count: 0,
            decision_reasons: ['fatal-fallback'],
            fallbacks: [],
            steps_executed: [],
            steps_skipped: [],
            duration_ms_by_step: {},
            impact: {},
            jsdoc: {},
            cache: {},
            parallelism: {},
            dedup: {},
        },
        security_execution: {
            enabled: false,
            checks: [],
            findings: 0,
            warnings: 0,
            errors: 0,
        },
        performance_execution: {
            enabled: false,
            score: null,
            categories: {},
            findings: 0,
            warnings: 0,
            errors: 0,
        },
        contract_coverage: {},
        contract_drift: {
            stale_contracts: [],
            unowned_critical: [],
            tests_without_contract: [],
        },
        contract_parity: {
            enabled: false,
            dsl_findings: 0,
            legacy_findings: 0,
            mismatches: [],
        },
        gate_decision: {
            enforce_level: 'warn',
            blocking: false,
            blocking_findings: [],
        },
        chaos_summary: {
            enabled: false,
            profile: 'off',
            scenarios_executed: 0,
            violations: 0,
        },
        artifacts: {
            run_dir: runDir,
            events_jsonl: logger.eventsPath,
            progress_json: stateStore.paths.progressPath,
            phase_timeline_json: stateStore.paths.phaseTimelinePath,
            findings_raw_json: stateStore.paths.findingsRawPath,
            findings_normalized_json: stateStore.paths.findingsNormalizedPath,
            proposals_json: stateStore.paths.proposalsPath,
            audit_report_json: path.join(runDir, `audit_report_v${schemaToken}.json`),
            summary_md: stateStore.paths.summaryPath,
            contract_registry_snapshot_json: stateStore.paths.contractRegistrySnapshotPath,
            semantic_preflight_json: stateStore.paths.semanticPreflightPath,
            log_stats_json: stateStore.paths.logStatsPath,
            contract_coverage_json: stateStore.paths.contractCoveragePath,
            contract_drift_json: stateStore.paths.contractDriftPath,
            contract_parity_json: stateStore.paths.contractParityPath,
            evidence_graph_json: stateStore.paths.evidenceGraphPath,
            gate_decisions_json: stateStore.paths.gateDecisionsPath,
            chaos_events_jsonl: path.join(runDir, 'chaos_events.jsonl'),
        },
    });

    stateStore.writeSummary(
        [
            '# Audit v3.2 Summary (Fatal Fallback)',
            '',
            `- run_id: ${runId}`,
            `- audit_mode: reactive_bug`,
            `- run_outcome: fatal`,
            `- abort_reason: uncaught_exception`,
            `- message: ${message}`,
            `- events_jsonl: ${logger.eventsPath}`,
        ].join('\n') + '\n',
    );

    const outputs = publishJson(report, { outputDir: outputRoot, runDir });
    return { report, outputs };
}

main().catch((error) => {
    const fallback = writeFatalFallbackReport(error);
    console.error('[audit-runner] fatal:', error?.message || String(error));
    console.error(`[audit-runner] fatal report: ${fallback.outputs.path}`);
    process.exit(0);
});
