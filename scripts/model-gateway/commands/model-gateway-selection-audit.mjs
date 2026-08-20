#!/usr/bin/env node
import {
    DEFAULT_MODEL_GATEWAY_CATALOG_PATH,
    JsonModelGatewayCatalogStore,
    auditModelGatewayCatalogSnapshotIntegrity,
    auditModelGatewayPreRuntimeSelection,
    createEnvSecretRegistry,
    renderModelGatewayLocalProviderOptInGuidance,
    summarizeModelGatewayLocalProviderOptInBlocks,
} from '../../../src/copilot/model-gateway/index.js';
import { loadModelGatewayDotenv } from '../lib/env.mjs';

loadModelGatewayDotenv();

import { createArgReader } from '../cli-args.mjs';

const args = process.argv.slice(2);
const readArg = createArgReader(args);
const argSet = new Set(args);

if (argSet.has('--help') || argSet.has('-h')) {
    process.stdout.write(`Usage: node scripts/model-gateway/commands/model-gateway-selection-audit.mjs [--json] [--strict] [--profile <id>|--profile=<id>] [--profiles a,b|--profiles=a,b] [--fail-on-unselected] [--fail-on-supply-warning]

Audit metadata-first model-gateway route selection from the persisted catalog. This does not fetch providers, execute
runtime probes or call models.
`);
    process.exit(0);
}


function readProfiles() {
    const profiles = [];
    const profile = readArg('--profile');
    const profileList = readArg('--profiles');
    if (profile) profiles.push(profile);
    if (profileList) profiles.push(...profileList.split(','));
    return profiles.map((profile) => profile.trim()).filter(Boolean);
}

/** @param {Record<string, unknown> | null | undefined} counts */
function formatCountMap(counts) {
    return Object.entries(counts ?? {})
        .map(([key, count]) => `${key}:${count}`)
        .join(',') || '-';
}

const json = argSet.has('--json');
const strict = argSet.has('--strict');
const failOnUnselected = argSet.has('--fail-on-unselected');
const failOnSupplyWarning = argSet.has('--fail-on-supply-warning');
const store = new JsonModelGatewayCatalogStore({ filePath: DEFAULT_MODEL_GATEWAY_CATALOG_PATH });
const snapshot = await store.readSnapshot();
const integrity = auditModelGatewayCatalogSnapshotIntegrity(snapshot);
const selection = auditModelGatewayPreRuntimeSelection(snapshot, {
    strict,
    profiles: readProfiles(),
    secretRegistry: createEnvSecretRegistry(),
});
const localProviderOptIn = summarizeModelGatewayLocalProviderOptInBlocks(selection);
const summary = {
    storePath: store.filePath,
    snapshotId: snapshot.snapshotId,
    generatedAt: snapshot.generatedAt,
    integrity,
    supplyWarningCount: selection.profiles.reduce((sum, profile) => sum + profile.supplyWarnings.length, 0),
    localProviderOptIn,
    selection,
};

if (json) {
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
} else {
    process.stdout.write(`model-gateway pre-runtime selection audit: ok=${selection.ok ? 'yes' : 'no'} mode=${selection.mode}\n`);
    process.stdout.write(
        `snapshot: projections=${selection.snapshotContext['projectionCount']} routes=${selection.snapshotContext['routeOptionCount']} overlays=${selection.snapshotContext['accountOverlayCount']} eligibility=${selection.snapshotContext['eligibilityDecisionCount']} candidates=${selection.snapshotContext['candidateCount']}\n`,
    );
    process.stdout.write(
        `profiles: selected=${selection.summary.selectedProfileCount}/${selection.summary.profileCount} candidates=${selection.summary.candidateCount} rejected=${selection.summary.rejectedCount}\n`,
    );
    for (const profile of selection.profiles) {
        const selected = profile.selected;
        const selectedLabel = selected
            ? `${selected['providerId']}:${selected['providerModel']} via ${selected['selectorKind']} score=${selected['score'] ?? '-'}`
            : '(none)';
        process.stdout.write(
            `  ${profile.profileId}: selected=${selectedLabel} candidates=${profile.candidateCount} rejected=${profile.rejectedCount}\n`,
        );
        if (!selected && profile.topRejectedReasons.length > 0) {
            process.stdout.write(`    top rejected: ${profile.topRejectedReasons.slice(0, 5).join(', ')}\n`);
        }
        if (profile.capabilitySupply) {
            process.stdout.write(
                `    supply required=${formatCountMap(profile.capabilitySupply.required)} soft=${formatCountMap(profile.capabilitySupply.softRequired)} preferred=${formatCountMap(profile.capabilitySupply.preferred)}\n`,
            );
        }
        if (profile.supplyWarnings.length > 0) {
            process.stdout.write(`    warnings=${profile.supplyWarnings.slice(0, 8).join(',')}\n`);
        }
    }
    if (localProviderOptIn.hasBlocks) {
        process.stdout.write(`\n${renderModelGatewayLocalProviderOptInGuidance({ profileIds: localProviderOptIn.blockedProfileIds })}\n`);
    }
}

if (!integrity.ok || (failOnUnselected && !selection.ok) || (failOnSupplyWarning && summary.supplyWarningCount > 0)) process.exit(1);
