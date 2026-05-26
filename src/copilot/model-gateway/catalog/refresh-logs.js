// @ts-check
/**
 * Refresh JSONL log parser and summarizer.
 *
 * Refresh logs are operational history, not canonical model metadata. They help humans and LLMs inspect long metadata
 * ingestion runs without mutating the catalog or executing providers.
 *
 * @module copilot/model-gateway/catalog/refresh-logs
 */

/**
 * @param {unknown} value
 * @returns {value is Record<string, any>}
 */
function isRecord(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * @param {unknown} value
 * @returns {string | null}
 */
function optionalString(value) {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/**
 * @param {unknown} value
 * @returns {number | null}
 */
function optionalNumber(value) {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * @param {string} text
 * @returns {{ events: Record<string, any>[]; invalidLineCount: number }}
 */
export function parseModelGatewayRefreshLogText(text) {
    const events = [];
    let invalidLineCount = 0;
    for (const line of text.split(/\r?\n/u)) {
        if (!line.trim()) continue;
        try {
            const parsed = JSON.parse(line);
            if (isRecord(parsed)) events.push(parsed);
            else invalidLineCount += 1;
        } catch {
            invalidLineCount += 1;
        }
    }
    return { events, invalidLineCount };
}

/**
 * @param {Record<string, any>} event
 * @returns {string | null}
 */
function importerIdForEvent(event) {
    const direct = optionalString(event['importerId']);
    if (direct) return direct;
    const importer = event['importer'];
    if (isRecord(importer)) return optionalString(importer['importerId']);
    return null;
}

/**
 * @param {Record<string, any>} event
 * @returns {string[]}
 */
function errorsForEvent(event) {
    return Array.isArray(event['errors']) ? event['errors'].map((item) => String(item)).filter(Boolean) : [];
}

/**
 * @param {Record<string, any>[]} events
 * @param {object} [input]
 * @param {number} [input.invalidLineCount]
 * @param {string} [input.logPath]
 * @returns {{
 *     schema: string;
 *     logPath: string | null;
 *     eventCount: number;
 *     invalidLineCount: number;
 *     firstTs: string | null;
 *     lastTs: string | null;
 *     elapsedMs: number | null;
 *     completed: boolean;
 *     committed: boolean;
 *     phases: Record<string, number>;
 *     importers: Record<string, { started: number; completed: number; failed: number; rowCount: number; evidenceCount: number }>;
 *     totals: { projections: number | null; openai: number | null; overlays: number | null; added: number | null; removed: number | null; changed: number | null };
 *     failures: Array<{ phase: string; importerId: string | null; errors: string[] }>;
 * }}
 */
export function summarizeModelGatewayRefreshLogEvents(events, input = {}) {
    /** @type {Record<string, number>} */
    const phases = {};
    /** @type {Record<string, { started: number; completed: number; failed: number; rowCount: number; evidenceCount: number }>} */
    const importers = {};
    /** @type {Array<{ phase: string; importerId: string | null; errors: string[] }>} */
    const failures = [];
    let firstTs = null;
    let lastTs = null;
    let elapsedMs = null;
    let completed = false;
    let committed = false;
    const totals = {
        projections: /** @type {number | null} */ (null),
        openai: /** @type {number | null} */ (null),
        overlays: /** @type {number | null} */ (null),
        added: /** @type {number | null} */ (null),
        removed: /** @type {number | null} */ (null),
        changed: /** @type {number | null} */ (null),
    };

    for (const event of events) {
        const phase = optionalString(event['phase']) ?? optionalString(event['schema']) ?? 'unknown';
        phases[phase] = (phases[phase] ?? 0) + 1;
        firstTs = firstTs ?? optionalString(event['ts']);
        lastTs = optionalString(event['ts']) ?? lastTs;
        elapsedMs = optionalNumber(event['elapsedMs']) ?? elapsedMs;
        const importerId = importerIdForEvent(event);
        if (importerId) {
            const importer = isRecord(event['importer']) ? event['importer'] : {};
            const current = importers[importerId] ?? { started: 0, completed: 0, failed: 0, rowCount: 0, evidenceCount: 0 };
            if (phase.endsWith('importer_started')) current.started += 1;
            if (phase.endsWith('importer_completed')) current.completed += 1;
            if (phase.endsWith('importer_failed')) current.failed += 1;
            current.rowCount += optionalNumber(event['rowCount']) ?? optionalNumber(importer['rowCount']) ?? 0;
            current.evidenceCount += optionalNumber(event['evidenceCount']) ?? optionalNumber(importer['evidenceCount']) ?? 0;
            importers[importerId] = current;
        }
        if (phase === 'refresh_completed') completed = true;
        if (event['committed'] === true) committed = true;
        totals.projections = optionalNumber(event['projectionCount']) ?? optionalNumber(event['projections']) ?? totals.projections;
        totals.openai = optionalNumber(event['openai']) ?? totals.openai;
        totals.overlays = optionalNumber(event['overlays']) ?? optionalNumber(event['accountOverlayCount']) ?? totals.overlays;
        const diff = isRecord(event['diff']) ? event['diff'] : {};
        totals.added = optionalNumber(event['addedCount']) ?? optionalNumber(diff['added']) ?? totals.added;
        totals.removed = optionalNumber(event['removedCount']) ?? optionalNumber(diff['removed']) ?? totals.removed;
        totals.changed = optionalNumber(event['changedCount']) ?? optionalNumber(diff['changed']) ?? totals.changed;
        const errors = errorsForEvent(event);
        if (errors.length > 0) failures.push({ phase, importerId, errors });
    }

    return {
        schema: 'model-gateway-refresh-log-summary',
        logPath: optionalString(input.logPath),
        eventCount: events.length,
        invalidLineCount: optionalNumber(input.invalidLineCount) ?? 0,
        firstTs,
        lastTs,
        elapsedMs,
        completed,
        committed,
        phases,
        importers,
        totals,
        failures,
    };
}

/**
 * @param {string} text
 * @param {object} [input]
 * @param {string} [input.logPath]
 * @returns {ReturnType<typeof summarizeModelGatewayRefreshLogEvents>}
 */
export function summarizeModelGatewayRefreshLogText(text, input = {}) {
    const parsed = parseModelGatewayRefreshLogText(text);
    return summarizeModelGatewayRefreshLogEvents(parsed.events, {
        invalidLineCount: parsed.invalidLineCount,
        logPath: input.logPath,
    });
}
