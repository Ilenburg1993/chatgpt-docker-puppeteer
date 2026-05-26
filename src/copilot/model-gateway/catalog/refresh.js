// @ts-check
/**
 * Programmatic catalog refresh.
 *
 * Refresh runs importers, replaces evidence for refreshed sources, rebuilds canonical projections and returns an
 * OpenAI-compatible model list alongside the internal snapshot.
 *
 * @module copilot/model-gateway/catalog/refresh
 */

import { createCatalogImportRun, diffCanonicalModelProjections } from './import-runs.js';
import { runCatalogImporters } from './importer-runner.js';
import { normalizeStoredCatalogSnapshot } from './json-catalog-store.js';
import { mergeModelMetadataEvidence, mergeProviderMetadataEvidence } from './merge.js';
import { toOpenAIModelCatalogList } from './openai-schema.js';
import { resolveModelGatewayCatalogRefreshLockKey, withModelGatewayCatalogRefreshLock } from './refresh-lock.js';
import { planModelGatewayCatalogRefresh } from './refresh-plan.js';
import { applyModelGatewayCatalogRetention } from './retention.js';

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
 * @param {import('./retention.js').ModelGatewayCatalogRetentionPolicy} [input.retentionPolicy]
 * @param {string} [input.writePolicy]
 * @param {string | false} [input.lockKey]
 * @returns {Promise<{
 *     snapshot: ReturnType<typeof normalizeStoredCatalogSnapshot>;
 *     diff: ReturnType<typeof diffCanonicalModelProjections>;
 *     openai: ReturnType<typeof toOpenAIModelCatalogList>;
 *     refreshPlan?: ReturnType<typeof planModelGatewayCatalogRefresh>;
 *     overlayRefresh: { enabled: boolean; imported: number; retained: number; total: number };
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
 * @param {import('./retention.js').ModelGatewayCatalogRetentionPolicy} [input.retentionPolicy]
 * @param {string} [input.writePolicy]
 * @returns {Promise<Omit<Awaited<ReturnType<typeof refreshModelGatewayCatalog>>, 'refreshLock'>>}
 */
async function refreshModelGatewayCatalogUnlocked(input = {}) {
    const now = input.now ?? (() => new Date());
    const startedAt = now();
    const writePolicy = input.writePolicy === 'commit' ? 'commit' : 'preview';
    const previous = input.store ? await input.store.readSnapshot() : normalizeStoredCatalogSnapshot(input.snapshot);
    const refreshPlan = input.incremental === true
        ? planModelGatewayCatalogRefresh({
            importers: input.importers ?? [],
            sources: previous.sources,
            now: () => startedAt,
            force: input.force,
            sourceIds: input.sourceIds,
        })
        : null;
    const imported = await runCatalogImporters({
        importers: refreshPlan?.selectedImporters ?? input.importers ?? [],
        now,
    });
    const refreshedSourceIds = new Set(imported.sources.map((source) => String(source['id'])));
    const retainedEvidences = previous.evidences.filter((evidence) => !refreshedSourceIds.has(String(evidence['sourceId'])));
    const retainedProviderEvidences = previous.providerEvidences.filter(
        (evidence) => !refreshedSourceIds.has(String(evidence['sourceId'])),
    );
    const retainedRouteOptions = previous.routeOptions.filter((option) => !refreshedSourceIds.has(String(option['sourceId'])));
    const retainedRawPayloadRefs = previous.rawPayloadRefs.filter((rawRef) => !refreshedSourceIds.has(String(rawRef['sourceId'])));
    const retainedAccountOverlays = input.refreshAccountOverlays === true
        ? previous.accountOverlays.filter((overlay) => !refreshedSourceIds.has(String(overlay['sourceId'])))
        : previous.accountOverlays;
    const accountOverlays = input.refreshAccountOverlays === true
        ? upsertMany(retainedAccountOverlays, imported.accountOverlays, accountOverlayKey)
        : retainedAccountOverlays;
    const combinedEvidences = [...retainedEvidences, ...imported.evidences];
    const combinedProviderEvidences = [...retainedProviderEvidences, ...imported.providerEvidences];
    const { projections, conflicts } = buildProjectionsFromEvidence(combinedEvidences);
    const { providerProjections, providerConflicts } = buildProviderProjectionsFromEvidence(combinedProviderEvidences);
    const diff = diffCanonicalModelProjections(previous.projections, projections);
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
    };
    const retained = applyModelGatewayCatalogRetention(nextSnapshot, input.retentionPolicy);
    const snapshot = retained.snapshot;
    if (input.store && writePolicy === 'commit') await input.store.writeSnapshot(snapshot);
    const output = {
        snapshot: normalizeStoredCatalogSnapshot(snapshot),
        diff,
        openai: toOpenAIModelCatalogList(projections, {
            providerProjections,
            eligibilityDecisions: previous.modelEligibilityDecisions,
        }),
        overlayRefresh: {
            enabled: input.refreshAccountOverlays === true,
            imported: imported.accountOverlays.length,
            retained: retainedAccountOverlays.length,
            total: accountOverlays.length,
        },
        retention: retained.summary,
        writePolicy: {
            mode: writePolicy,
            storeAvailable: Boolean(input.store),
            committed: Boolean(input.store && writePolicy === 'commit'),
        },
    };
    if (refreshPlan) return { ...output, refreshPlan };
    return output;
}
