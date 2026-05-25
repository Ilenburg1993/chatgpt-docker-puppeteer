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
 * @returns {Promise<{
 *     snapshot: ReturnType<typeof normalizeStoredCatalogSnapshot>;
 *     diff: ReturnType<typeof diffCanonicalModelProjections>;
 *     openai: ReturnType<typeof toOpenAIModelCatalogList>;
 * }>}
 */
export async function refreshModelGatewayCatalog(input = {}) {
    const now = input.now ?? (() => new Date());
    const startedAt = now();
    const previous = input.store ? await input.store.readSnapshot() : normalizeStoredCatalogSnapshot(input.snapshot);
    const imported = await runCatalogImporters({
        importers: input.importers ?? [],
        now,
    });
    const refreshedSourceIds = new Set(imported.sources.map((source) => String(source['id'])));
    const retainedEvidences = previous.evidences.filter((evidence) => !refreshedSourceIds.has(String(evidence['sourceId'])));
    const retainedProviderEvidences = previous.providerEvidences.filter(
        (evidence) => !refreshedSourceIds.has(String(evidence['sourceId'])),
    );
    const retainedRouteOptions = previous.routeOptions.filter((option) => !refreshedSourceIds.has(String(option['sourceId'])));
    const retainedRawPayloadRefs = previous.rawPayloadRefs.filter((rawRef) => !refreshedSourceIds.has(String(rawRef['sourceId'])));
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
    const snapshot = {
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
        importRuns: [...previous.importRuns, ...imported.importRuns, refreshRun],
        providerProjections,
        projections,
        conflicts: [...providerConflicts, ...conflicts],
    };
    if (input.store) await input.store.writeSnapshot(snapshot);
    return {
        snapshot: normalizeStoredCatalogSnapshot(snapshot),
        diff,
        openai: toOpenAIModelCatalogList(projections, { providerProjections }),
    };
}
