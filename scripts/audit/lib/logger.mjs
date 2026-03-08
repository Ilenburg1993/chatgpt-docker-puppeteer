// @ts-check
import fs from 'node:fs';
import path from 'node:path';
import { AUDIT_EVENT_TYPES } from './event_types.mjs';

/**
 * @param {string} value
 */
function sanitizePathToken(value) {
    return String(value || 'step').replace(/[^a-zA-Z0-9._-]/g, '_');
}

/**
 * @typedef {object} CreateAuditLoggerOptions
 * @property {string} runId
 * @property {string} runDir
 * @property {'info' | 'debug'} logLevel
 * @property {'jsonl' | 'console'} logFormat
 * @property {boolean} enableConsole
 */
/**
 * @param {CreateAuditLoggerOptions} options
 * @returns {object}
 */
export function createAuditLogger(options) {
    const runDir = options.runDir;
    const runId = options.runId;
    const logLevel = options.logLevel || 'info';
    const logFormat = options.logFormat || 'jsonl';
    const enableConsole = options.enableConsole !== false;

    const logsDir = path.join(runDir, 'logs');
    const stepsDir = path.join(runDir, 'steps');
    const eventsPath = path.join(runDir, 'events.jsonl');
    const eventSchemaVersion = '1.1';
    let seq = 0;

    fs.mkdirSync(logsDir, { recursive: true });
    fs.mkdirSync(stepsDir, { recursive: true });

    /**
     * @param {Record<string, any>} event
     */
    function emit(event) {
        const validationErrors = validateEvent(event);
        const payload = /** @type {Record<string, unknown>} */ ({
            seq: ++seq,
            ts: new Date().toISOString(),
            run_id: runId,
            event_schema_version: eventSchemaVersion,
            ...event,
        });
        if (validationErrors.length > 0) {
            payload.level = payload.level === 'error' ? 'error' : 'warn';
            payload.validation_errors = validationErrors;
            if (!payload.message) {
                payload.message = `Invalid audit event payload: ${validationErrors.join('; ')}`;
            }
        }

        fs.appendFileSync(eventsPath, `${JSON.stringify(payload)}\n`, 'utf8');

        if (!enableConsole) {
            return;
        }

        if (logFormat === 'console') {
            const level = payload.level || 'info';
            const phase = payload.phase ? `[${payload.phase}]` : '';
            const step = payload.step_id ? `(${payload.step_id})` : '';
            const message = payload.message || payload.event_type || 'event';
            if (level === 'error') {
                console.error(`[audit][${level}]${phase}${step} ${message}`);
            } else {
                console.log(`[audit][${level}]${phase}${step} ${message}`);
            }
            return;
        }

        if (logLevel === 'debug' || payload.level !== 'debug') {
            console.log(JSON.stringify(payload));
        }
    }

    /**
     * @param {{
     *     phase: string;
     *     stepId: string;
     *     command: string;
     *     args: string[];
     *     stdout: string;
     *     stderr: string;
     *     result: any;
     * }} input
     */
    function writeStepArtifacts(input) {
        const safeStep = sanitizePathToken(input.stepId);
        const stepDir = path.join(stepsDir, safeStep);
        fs.mkdirSync(stepDir, { recursive: true });

        const stdoutPath = path.join(stepDir, 'stdout.log');
        const stderrPath = path.join(stepDir, 'stderr.log');
        const commandPath = path.join(stepDir, 'command.json');

        fs.writeFileSync(stdoutPath, input.stdout || '', 'utf8');
        fs.writeFileSync(stderrPath, input.stderr || '', 'utf8');
        fs.writeFileSync(
            commandPath,
            `${JSON.stringify(
                {
                    phase: input.phase,
                    step_id: input.stepId,
                    command: input.command,
                    args: input.args,
                    ok: input.result?.ok,
                    exit_code: input.result?.exitCode,
                    timed_out: input.result?.timedOut,
                    duration_ms: input.result?.durationMs,
                    stdout_bytes: input.result?.stdoutBytes ?? null,
                    stderr_bytes: input.result?.stderrBytes ?? null,
                    stdout_truncated: input.result?.stdoutTruncated ?? false,
                    stderr_truncated: input.result?.stderrTruncated ?? false,
                    at: new Date().toISOString(),
                },
                null,
                2,
            )}\n`,
            'utf8',
        );

        return {
            stdoutPath,
            stderrPath,
            commandPath,
            stepDir,
        };
    }

    return {
        runId,
        runDir,
        logsDir,
        stepsDir,
        eventsPath,
        eventSchemaVersion,
        emit,
        writeStepArtifacts,
        getEventCount() {
            return seq;
        },
    };
}

/**
 * @param {Record<string, any>} event
 * @returns {string[]}
 */
function validateEvent(event) {
    /** @type {string[]} */
    const errors = [];
    if (!event || typeof event !== 'object') {
        return ['event payload must be an object'];
    }
    if (!event.event_type) {
        errors.push('event_type is required');
        return errors;
    }

    const requiresPhase = new Set([
        AUDIT_EVENT_TYPES.PHASE_STARTED,
        AUDIT_EVENT_TYPES.PHASE_FINISHED,
        AUDIT_EVENT_TYPES.STEP_STARTED,
        AUDIT_EVENT_TYPES.STEP_FINISHED,
        AUDIT_EVENT_TYPES.STEP_PROGRESS,
        AUDIT_EVENT_TYPES.STEP_OUTPUT_TRUNCATED,
        AUDIT_EVENT_TYPES.HEARTBEAT,
    ]);
    const requiresStep = new Set([
        AUDIT_EVENT_TYPES.STEP_STARTED,
        AUDIT_EVENT_TYPES.STEP_FINISHED,
        AUDIT_EVENT_TYPES.STEP_PROGRESS,
        AUDIT_EVENT_TYPES.STEP_OUTPUT_TRUNCATED,
    ]);

    if (requiresPhase.has(event.event_type) && !event.phase) {
        errors.push('phase is required for this event_type');
    }
    if (requiresStep.has(event.event_type) && !event.step_id) {
        errors.push('step_id is required for this event_type');
    }
    if (
        event.event_type === AUDIT_EVENT_TYPES.RUN_STARTED ||
        event.event_type === AUDIT_EVENT_TYPES.RUN_FINISHED ||
        event.event_type === AUDIT_EVENT_TYPES.RUN_ABORTED ||
        event.event_type === AUDIT_EVENT_TYPES.RUN_FATAL
    ) {
        if (!event.status) {
            errors.push('status is required for run lifecycle events');
        }
    }

    return errors;
}
