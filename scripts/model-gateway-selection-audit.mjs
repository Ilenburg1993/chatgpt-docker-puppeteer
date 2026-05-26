#!/usr/bin/env node
import {
    DEFAULT_MODEL_GATEWAY_CATALOG_PATH,
    JsonModelGatewayCatalogStore,
    auditModelGatewayCatalogSnapshotIntegrity,
    auditModelGatewayPreRuntimeSelection,
    createEnvSecretRegistry,
} from '../src/copilot/model-gateway/index.js';

const args = process.argv.slice(2);
const argSet = new Set(args);

if (argSet.has('--help') || argSet.has('-h')) {
    process.stdout.write(`Usage: node scripts/model-gateway-selection-audit.mjs [--json] [--strict] [--profile=<id>] [--profiles=a,b] [--fail-on-unselected]

Audit metadata-first model-gateway route selection from the persisted catalog. This does not fetch providers, execute
runtime probes or call models.
`);
    process.exit(0);
}

function readProfiles() {
    const profiles = [];
    for (const arg of args) {
        if (arg.startsWith('--profile=')) profiles.push(arg.slice('--profile='.length));
        if (arg.startsWith('--profiles=')) profiles.push(...arg.slice('--profiles='.length).split(','));
    }
    return profiles.map((profile) => profile.trim()).filter(Boolean);
}

const json = argSet.has('--json');
const strict = argSet.has('--strict');
const failOnUnselected = argSet.has('--fail-on-unselected');
const store = new JsonModelGatewayCatalogStore({ filePath: DEFAULT_MODEL_GATEWAY_CATALOG_PATH });
const snapshot = await store.readSnapshot();
const integrity = auditModelGatewayCatalogSnapshotIntegrity(snapshot);
const selection = auditModelGatewayPreRuntimeSelection(snapshot, {
    strict,
    profiles: readProfiles(),
    secretRegistry: createEnvSecretRegistry(),
});
const summary = {
    storePath: store.filePath,
    snapshotId: snapshot.snapshotId,
    generatedAt: snapshot.generatedAt,
    integrity,
    selection,
};

if (json) {
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
} else {
    process.stdout.write(`model-gateway pre-runtime selection audit: ok=${selection.ok ? 'yes' : 'no'} mode=${selection.mode}\n`);
    process.stdout.write(
        `snapshot: projections=${selection.snapshotContext.projectionCount} routes=${selection.snapshotContext.routeOptionCount} overlays=${selection.snapshotContext.accountOverlayCount} eligibility=${selection.snapshotContext.eligibilityDecisionCount} candidates=${selection.snapshotContext.candidateCount}\n`,
    );
    process.stdout.write(
        `profiles: selected=${selection.summary.selectedProfileCount}/${selection.summary.profileCount} candidates=${selection.summary.candidateCount} rejected=${selection.summary.rejectedCount}\n`,
    );
    for (const profile of selection.profiles) {
        const selected = profile.selected;
        const selectedLabel = selected
            ? `${selected.providerId}:${selected.providerModel} via ${selected.selectorKind} score=${selected.score ?? '-'}`
            : '(none)';
        process.stdout.write(
            `  ${profile.profileId}: selected=${selectedLabel} candidates=${profile.candidateCount} rejected=${profile.rejectedCount}\n`,
        );
        if (!selected && profile.topRejectedReasons.length > 0) {
            process.stdout.write(`    top rejected: ${profile.topRejectedReasons.slice(0, 5).join(', ')}\n`);
        }
    }
}

if (!integrity.ok || (failOnUnselected && !selection.ok)) process.exit(1);
