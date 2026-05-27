// @ts-check
/**
 * Programmatic catalog refresh.
 *
 * Refresh runs importers, replaces evidence for refreshed sources, rebuilds canonical projections and returns an
 * OpenAI-compatible model list alongside the internal snapshot.
 *
 * @module copilot/model-gateway/catalog/refresh
 */

import { createCatalogImportRun, createCatalogModelTombstones, diffCanonicalModelProjections } from './import-runs.js';
import { createProviderAccountOverlay } from './contracts.js';
import { runCatalogImporters } from './importer-runner.js';
import { normalizeStoredCatalogSnapshot } from './json-catalog-store.js';
import { mergeModelMetadataEvidence, mergeProviderMetadataEvidence } from './merge.js';
import { toOpenAIModelCatalogList } from './openai-schema.js';
import { resolveModelGatewayCatalogRefreshLockKey, withModelGatewayCatalogRefreshLock } from './refresh-lock.js';
import { planModelGatewayCatalogRefresh } from './refresh-plan.js';
import { applyModelGatewayCatalogRetention } from './retention.js';
import {
    applyModelGatewayEligibilityToSnapshot,
    diffModelGatewayEligibilityDecisions,
    evaluateModelGatewayCatalogEligibility,
    summarizeModelGatewayEligibilityDiff,
} from '../eligibility/index.js';

/**
 * @typedef {object} ModelGatewayCatalogRefreshProgressEvent
 * @property {string} phase
 * @property {number} elapsedMs
 * @property {number} [progressPct]
 * @property {string} [writePolicy]
 * @property {string} [storePath]
 * @property {number} [importerCount]
 * @property {number} [selectedCount]
 * @property {number} [skippedCount]
 * @property {number} [rowCount]
 * @property {number} [sourceCount]
 * @property {number} [evidenceCount]
 * @property {number} [providerEvidenceCount]
 * @property {number} [routeOptionCount]
 * @property {number} [accountOverlayCount]
 * @property {number} [projectionCount]
 * @property {number} [providerProjectionCount]
 * @property {number} [eligibilityDecisionCount]
 * @property {number} [eligibilityAddedCount]
 * @property {number} [eligibilityRemovedCount]
 * @property {number} [eligibilityChangedCount]
 * @property {number} [addedCount]
 * @property {number} [removedCount]
 * @property {number} [changedCount]
 * @property {boolean} [committed]
 * @property {boolean} [storeAvailable]
 * @property {Record<string, any>} [importer]
 * @property {string[]} [selectedSourceIds]
 * @property {string[]} [skippedSourceIds]
 */

/**
 * @param {Date} startedAt
 * @param {Date} observedAt
 * @returns {number}
 */
function refreshElapsedMs(startedAt, observedAt) {
    return Math.max(0, observedAt.getTime() - startedAt.getTime());
}

/**
 * @param {((event: ModelGatewayCatalogRefreshProgressEvent) => void) | undefined} onProgress
 * @param {ModelGatewayCatalogRefreshProgressEvent} event
 * @returns {void}
 */
function emitRefreshProgress(onProgress, event) {
    if (typeof onProgress !== 'function') return;
    onProgress(event);
}

/**
 * @template {Record<string, any>} T
 * @param {T[]} records
 * @param {T[]} additions
 * @param {(record: T) => string} key
 * @returns {T[]}
 */
function upsertMany(records, additions, key) {
    const map = new Map(records.map((record) => [key(record), record]));
    for (const item of additions) map.set(key(item), item);
    return [...map.values()];
}

/**
 * @param {Record<string, any>} evidence
 * @returns {string}
 */
function projectionGroupKey(evidence) {
    return [
        String(evidence['providerId'] ?? 'unknown-provider'),
        String(evidence['providerModel'] ?? 'unknown-model'),
        String(evidence['routeProfile'] ?? 'default'),
    ].join(':');
}

/**
 * @param {Record<string, any>} evidence
 * @returns {string}
 */
function providerProjectionGroupKey(evidence) {
    return [
        String(evidence['providerId'] ?? 'unknown-provider'),
        String(evidence['subjectProviderId'] ?? 'unknown-subject-provider'),
    ].join(':');
}

/**
 * @param {Record<string, any>} overlay
 * @returns {string}
 */
function accountOverlayKey(overlay) {
    const explicit = overlay['accountOverlayId'];
    if (typeof explicit === 'string' && explicit) return explicit;
    return [
        overlay['providerId'],
        overlay['accountScope'],
        overlay['secretRef'],
        overlay['sourceId'],
    ]
        .filter((part) => typeof part === 'string' && part)
        .join(':') || JSON.stringify(overlay);
}

/**
 * @param {Record<string, any>[]} evidences
 * @returns {{ projections: Record<string, any>[]; conflicts: Record<string, any>[] }}
 */
function buildProjectionsFromEvidence(evidences) {
    /** @type {Map<string, Record<string, any>[]>} */
    const groups = new Map();
    for (const evidence of evidences) {
        const key = projectionGroupKey(evidence);
        const group = groups.get(key) ?? [];
        group.push(evidence);
        groups.set(key, group);
    }
    /** @type {Record<string, any>[]} */
    const projections = [];
    /** @type {Record<string, any>[]} */
    const conflicts = [];
    for (const [key, group] of groups.entries()) {
        const merged = mergeModelMetadataEvidence(group);
        projections.push(merged.projection);
        for (const conflict of merged.conflicts) {
            conflicts.push({ ...conflict, projectionKey: key });
        }
    }
    return {
        projections: projections.sort((left, right) =>
            `${left['providerId']}:${left['providerModel']}:${left['routeProfile'] ?? 'default'}`.localeCompare(
                `${right['providerId']}:${right['providerModel']}:${right['routeProfile'] ?? 'default'}`,
            ),
        ),
        conflicts,
    };
}

/**
 * @param {Record<string, any>[]} evidences
 * @returns {{ providerProjections: Record<string, any>[]; providerConflicts: Record<string, any>[] }}
 */
function buildProviderProjectionsFromEvidence(evidences) {
    /** @type {Map<string, Record<string, any>[]>} */
    const groups = new Map();
    for (const evidence of evidences) {
        const key = providerProjectionGroupKey(evidence);
        const group = groups.get(key) ?? [];
        group.push(evidence);
        groups.set(key, group);
    }
    /** @type {Record<string, any>[]} */
    const providerProjections = [];
    /** @type {Record<string, any>[]} */
    const providerConflicts = [];
    for (const [key, group] of groups.entries()) {
        const merged = mergeProviderMetadataEvidence(group);
        providerProjections.push(merged.projection);
        for (const conflict of merged.conflicts) {
            providerConflicts.push({ ...conflict, projectionKey: key });
        }
    }
    return {
        providerProjections: providerProjections.sort((left, right) =>
            `${left['providerId']}:${left['subjectProviderId']}`.localeCompare(`${right['providerId']}:${right['subjectProviderId']}`),
        ),
        providerConflicts,
    };
}

/**
 * @param {object} [input]
 * @param {import('./importer-runner.js').CatalogImporter[]} [input.importers]
 * @param {unknown} [input.snapshot]
 * @param {{ readSnapshot(): Promise<ReturnType<typeof normalizeStoredCatalogSnapshot>>; writeSnapshot(snapshot: object): Promise<void> }} [input.store]
 * @param {() => Date} [input.now]
 * @param {boolean} [input.incremental]
 * @param {boolean} [input.force]
 * @param {string[]} [input.sourceIds]
 * @param {boolean} [input.refreshAccountOverlays]
 * @param {{ enabled?: boolean; secretRegistry?: { has(ref: string): boolean }; policy?: Record<string, any>; healthRecords?: Record<string, any>[] }} [input.eligibility]
 * @param {{ mode?: string; maxInlineBytes?: number }} [input.rawPayloadStoragePolicy]
 * @param {import('./retention.js').ModelGatewayCatalogRetentionPolicy} [input.retentionPolicy]
 * @param {string} [input.writePolicy]
 * @param {string | false} [input.lockKey]
 * @param {(event: ModelGatewayCatalogRefreshProgressEvent) => void} [input.onProgress]
 * @returns {Promise<{
 *     snapshot: ReturnType<typeof normalizeStoredCatalogSnapshot>;
 *     diff: ReturnType<typeof diffCanonicalModelProjections>;
 *     openai: ReturnType<typeof toOpenAIModelCatalogList>;
 *     refreshPlan?: ReturnType<typeof planModelGatewayCatalogRefresh>;
 *     overlayRefresh: { enabled: boolean; imported: number; retained: number; total: number };
 *     eligibilityRefresh: { enabled: boolean; run: Record<string, any> | null; decisionCount: number; diff: ReturnType<typeof diffModelGatewayEligibilityDecisions> | null; diffSummary: ReturnType<typeof summarizeModelGatewayEligibilityDiff> | null };
 *     retention: ReturnType<typeof applyModelGatewayCatalogRetention>['summary'];
 *     writePolicy: { mode: string; storeAvailable: boolean; committed: boolean };
 *     refreshLock: { enabled: boolean; key: string | null };
 * }>}
 */
export async function refreshModelGatewayCatalog(input = {}) {
    const resolvedLockKey = input.lockKey === false
        ? null
        : (typeof input.lockKey === 'string' && input.lockKey.trim()) || resolveModelGatewayCatalogRefreshLockKey(input.store);
    if (resolvedLockKey) {
        return withModelGatewayCatalogRefreshLock(resolvedLockKey, async () => ({
            ...(await refreshModelGatewayCatalogUnlocked(input)),
            refreshLock: { enabled: true, key: resolvedLockKey },
        }));
    }
    return {
        ...(await refreshModelGatewayCatalogUnlocked(input)),
        refreshLock: { enabled: false, key: null },
    };
}

/**
 * @param {object} [input]
 * @param {import('./importer-runner.js').CatalogImporter[]} [input.importers]
 * @param {unknown} [input.snapshot]
 * @param {{ readSnapshot(): Promise<ReturnType<typeof normalizeStoredCatalogSnapshot>>; writeSnapshot(snapshot: object): Promise<void> }} [input.store]
 * @param {() => Date} [input.now]
 * @param {boolean} [input.incremental]
 * @param {boolean} [input.force]
 * @param {string[]} [input.sourceIds]
 * @param {boolean} [input.refreshAccountOverlays]
 * @param {{ enabled?: boolean; secretRegistry?: { has(ref: string): boolean }; policy?: Record<string, any>; healthRecords?: Record<string, any>[] }} [input.eligibility]
 * @param {{ mode?: string; maxInlineBytes?: number }} [input.rawPayloadStoragePolicy]
 * @param {import('./retention.js').ModelGatewayCatalogRetentionPolicy} [input.retentionPolicy]
 * @param {string} [input.writePolicy]
 * @param {(event: ModelGatewayCatalogRefreshProgressEvent) => void} [input.onProgress]
 * @returns {Promise<Omit<Awaited<ReturnType<typeof refreshModelGatewayCatalog>>, 'refreshLock'>>}
 */
async function refreshModelGatewayCatalogUnlocked(input = {}) {
    const now = input.now ?? (() => new Date());
    const startedAt = now();
    const writePolicy = input.writePolicy === 'commit' ? 'commit' : 'preview';
    emitRefreshProgress(input.onProgress, {
        phase: 'refresh_started',
        elapsedMs: 0,
        progressPct: 0,
        writePolicy,
        importerCount: (input.importers ?? []).length,
        storeAvailable: Boolean(input.store),
    });
    const previous = input.store ? await input.store.readSnapshot() : normalizeStoredCatalogSnapshot(input.snapshot);
    emitRefreshProgress(input.onProgress, {
        phase: 'previous_snapshot_loaded',
        elapsedMs: refreshElapsedMs(startedAt, now()),
        progressPct: 5,
        sourceCount: previous.sources.length,
        evidenceCount: previous.evidences.length,
        providerEvidenceCount: previous.providerEvidences.length,
        projectionCount: previous.projections.length,
        accountOverlayCount: previous.accountOverlays.length,
    });
    const refreshPlan = input.incremental === true
        ? planModelGatewayCatalogRefresh({
            importers: input.importers ?? [],
            sources: previous.sources,
            now: () => startedAt,
            force: input.force,
            sourceIds: input.sourceIds,
        })
        : null;
    emitRefreshProgress(input.onProgress, {
        phase: 'refresh_plan_ready',
        elapsedMs: refreshElapsedMs(startedAt, now()),
        progressPct: 10,
        selectedCount: refreshPlan?.selected.length ?? (input.importers ?? []).length,
        skippedCount: refreshPlan?.skipped.length ?? 0,
        selectedSourceIds: (refreshPlan?.selected ?? []).map((item) => item.sourceId),
        skippedSourceIds: (refreshPlan?.skipped ?? []).map((item) => item.sourceId),
    });
    const imported = await runCatalogImporters({
        importers: refreshPlan?.selectedImporters ?? input.importers ?? [],
        now,
        rawPayloadStoragePolicy: input.rawPayloadStoragePolicy,
        onProgress: (event) => emitRefreshProgress(input.onProgress, {
            ...event,
            phase: `importer:${event.phase}`,
            elapsedMs: refreshElapsedMs(startedAt, now()),
            importer: event,
            progressPct: 10 + Math.round((event.progressPct / 100) * 45),
        }),
    });
    emitRefreshProgress(input.onProgress, {
        phase: 'importers_completed',
        elapsedMs: refreshElapsedMs(startedAt, now()),
        progressPct: 55,
        sourceCount: imported.sources.length,
        evidenceCount: imported.evidences.length,
        providerEvidenceCount: imported.providerEvidences.length,
        routeOptionCount: imported.routeOptions.length,
        accountOverlayCount: imported.accountOverlays.length,
    });
    const refreshedSourceIds = new Set(imported.sources.map((source) => String(source['id'])));
    const retainedEvidences = previous.evidences.filter((evidence) => !refreshedSourceIds.has(String(evidence['sourceId'])));
    const retainedProviderEvidences = previous.providerEvidences.filter(
        (evidence) => !refreshedSourceIds.has(String(evidence['sourceId'])),
    );
    const retainedRouteOptions = previous.routeOptions.filter((option) => !refreshedSourceIds.has(String(option['sourceId'])));
    const retainedRawPayloadRefs = previous.rawPayloadRefs.filter((rawRef) => !refreshedSourceIds.has(String(rawRef['sourceId'])));
    const retainedAccountOverlays = (
        input.refreshAccountOverlays === true
            ? previous.accountOverlays.filter((overlay) => !refreshedSourceIds.has(String(overlay['sourceId'])))
            : previous.accountOverlays
    ).map((overlay) => createProviderAccountOverlay(/** @type {Parameters<typeof createProviderAccountOverlay>[0]} */ (overlay)));
    const accountOverlays = input.refreshAccountOverlays === true
        ? upsertMany(retainedAccountOverlays, imported.accountOverlays, accountOverlayKey)
        : retainedAccountOverlays;
    const combinedEvidences = [...retainedEvidences, ...imported.evidences];
    const combinedProviderEvidences = [...retainedProviderEvidences, ...imported.providerEvidences];
    const { projections, conflicts } = buildProjectionsFromEvidence(combinedEvidences);
    const { providerProjections, providerConflicts } = buildProviderProjectionsFromEvidence(combinedProviderEvidences);
    const diff = diffCanonicalModelProjections(previous.projections, projections);
    emitRefreshProgress(input.onProgress, {
        phase: 'projections_built',
        elapsedMs: refreshElapsedMs(startedAt, now()),
        progressPct: 70,
        projectionCount: projections.length,
        providerProjectionCount: providerProjections.length,
        addedCount: diff.added.length,
        removedCount: diff.removed.length,
        changedCount: diff.changed.length,
    });
    const modelTombstones = createCatalogModelTombstones({
        diff,
        previousProjections: previous.projections,
        observedAt: startedAt,
    });
    const refreshRun = createCatalogImportRun({
        runId: `model-gateway:catalog-refresh:${startedAt.toISOString()}`,
        providerId: 'model-gateway',
        sourceId: 'catalog-refresh',
        status: 'completed',
        startedAt,
        completedAt: now(),
        rowCount: projections.length,
        diff,
    });
    const nextSnapshot = {
        ...previous,
        source: 'catalog-refresh',
        sources: upsertMany(previous.sources, imported.sources, (item) => String(item['id'])),
        providerEvidences: combinedProviderEvidences,
        evidences: combinedEvidences,
        routeOptions: upsertMany(retainedRouteOptions, imported.routeOptions, (item) =>
            [
                item['providerId'],
                item['providerModel'],
                item['routeProfile'] ?? 'default',
                item['selectorKind'],
                item['selectorSyntax'],
            ]
                .filter((part) => typeof part === 'string' && part)
                .join(':'),
        ),
        rawPayloadRefs: [...retainedRawPayloadRefs, ...imported.rawPayloadRefs],
        accountOverlays,
        importRuns: [...previous.importRuns, ...imported.importRuns, refreshRun],
        providerProjections,
        projections,
        conflicts: [...providerConflicts, ...conflicts],
        modelTombstones: upsertMany(previous.modelTombstones, modelTombstones, (item) => String(item['projectionKey'])),
    };
    const eligibilityInput = input.eligibility && typeof input.eligibility === 'object' ? input.eligibility : {};
    const eligibilityEnabled = eligibilityInput['enabled'] === true;
    const evaluatedEligibility = eligibilityEnabled
        ? evaluateModelGatewayCatalogEligibility({
              snapshot: nextSnapshot,
              secretRegistry: eligibilityInput['secretRegistry'],
              policy: eligibilityInput['policy'],
              healthRecords: eligibilityInput['healthRecords'],
              now,
          })
        : null;
    const eligibilityDiff = evaluatedEligibility
        ? diffModelGatewayEligibilityDecisions(previous.modelEligibilityDecisions, evaluatedEligibility.decisions)
        : null;
    const eligibilityDiffSummary = eligibilityDiff ? summarizeModelGatewayEligibilityDiff(eligibilityDiff) : null;
    const snapshotWithEligibility = evaluatedEligibility
        ? applyModelGatewayEligibilityToSnapshot(nextSnapshot, evaluatedEligibility.decisions, evaluatedEligibility.run)
        : nextSnapshot;
    if (evaluatedEligibility) {
        emitRefreshProgress(input.onProgress, {
            phase: 'eligibility_evaluated',
            elapsedMs: refreshElapsedMs(startedAt, now()),
            progressPct: 82,
            eligibilityDecisionCount: evaluatedEligibility.decisions.length,
            eligibilityAddedCount: eligibilityDiffSummary?.addedCount ?? 0,
            eligibilityRemovedCount: eligibilityDiffSummary?.removedCount ?? 0,
            eligibilityChangedCount: eligibilityDiffSummary?.changedCount ?? 0,
            projectionCount: projections.length,
            routeOptionCount: snapshotWithEligibility['routeOptions'].length,
            accountOverlayCount: snapshotWithEligibility['accountOverlays'].length,
        });
    }
    const retained = applyModelGatewayCatalogRetention(snapshotWithEligibility, input.retentionPolicy);
    const snapshot = retained.snapshot;
    emitRefreshProgress(input.onProgress, {
        phase: 'retention_applied',
        elapsedMs: refreshElapsedMs(startedAt, now()),
        progressPct: 85,
        sourceCount: snapshot['sources'].length,
        evidenceCount: snapshot['evidences'].length,
        providerEvidenceCount: snapshot['providerEvidences'].length,
        routeOptionCount: snapshot['routeOptions'].length,
        accountOverlayCount: snapshot['accountOverlays'].length,
        projectionCount: snapshot['projections'].length,
        providerProjectionCount: snapshot['providerProjections'].length,
    });
    if (input.store && writePolicy === 'commit') await input.store.writeSnapshot(snapshot);
    emitRefreshProgress(input.onProgress, {
        phase: input.store && writePolicy === 'commit' ? 'snapshot_written' : 'snapshot_previewed',
        elapsedMs: refreshElapsedMs(startedAt, now()),
        progressPct: 95,
        committed: Boolean(input.store && writePolicy === 'commit'),
        storeAvailable: Boolean(input.store),
        writePolicy,
    });
    const output = {
        snapshot: normalizeStoredCatalogSnapshot(snapshot),
        diff,
        openai: toOpenAIModelCatalogList(projections, {
            providerProjections,
            eligibilityDecisions: snapshot['modelEligibilityDecisions'],
            routeOptions: snapshot['routeOptions'],
        }),
        overlayRefresh: {
            enabled: input.refreshAccountOverlays === true,
            imported: imported.accountOverlays.length,
            retained: retainedAccountOverlays.length,
            total: accountOverlays.length,
        },
        eligibilityRefresh: {
            enabled: eligibilityEnabled,
            run: evaluatedEligibility?.run ?? null,
            decisionCount: evaluatedEligibility?.decisions.length ?? 0,
            diff: eligibilityDiff,
            diffSummary: eligibilityDiffSummary,
        },
        retention: retained.summary,
        writePolicy: {
            mode: writePolicy,
            storeAvailable: Boolean(input.store),
            committed: Boolean(input.store && writePolicy === 'commit'),
        },
    };
    emitRefreshProgress(input.onProgress, {
        phase: 'refresh_completed',
        elapsedMs: refreshElapsedMs(startedAt, now()),
        progressPct: 100,
        committed: output.writePolicy.committed,
        storeAvailable: output.writePolicy.storeAvailable,
        writePolicy: output.writePolicy.mode,
        projectionCount: output.snapshot.projections.length,
        providerProjectionCount: output.snapshot.providerProjections.length,
        addedCount: output.diff.added.length,
        removedCount: output.diff.removed.length,
        changedCount: output.diff.changed.length,
    });
    if (refreshPlan) return { ...output, refreshPlan };
    return output;
}
