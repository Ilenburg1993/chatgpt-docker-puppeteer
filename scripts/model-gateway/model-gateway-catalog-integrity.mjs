#!/usr/bin/env node
import {
    DEFAULT_MODEL_GATEWAY_CATALOG_PATH,
    JsonModelGatewayCatalogStore,
    auditModelGatewayCatalogSnapshotIntegrity,
} from '../../src/copilot/model-gateway/index.js';

const args = process.argv.slice(2);
const json = args.includes('--json');
const store = new JsonModelGatewayCatalogStore({ filePath: DEFAULT_MODEL_GATEWAY_CATALOG_PATH });
const snapshot = await store.readSnapshot();
const integrity = auditModelGatewayCatalogSnapshotIntegrity(snapshot);
const summary = {
    ...integrity,
    storePath: store.filePath,
    snapshotId: snapshot.snapshotId,
    generatedAt: snapshot.generatedAt,
};

if (json) {
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
} else {
    process.stdout.write(
        `model-gateway catalog integrity: ok=${summary.ok ? 'yes' : 'no'} projections=${summary.duplicateChecks.projections.rowCount} evidences=${summary.duplicateChecks.evidences.rowCount} redactedIdentities=${summary.redactedIdentityCount}\n`,
    );
    for (const [field, check] of Object.entries(summary.duplicateChecks)) {
        process.stdout.write(
            `  ${field}: rows=${check.rowCount} unique=${check.uniqueKeyCount} duplicateKeys=${check.duplicateKeyCount} extra=${check.duplicateExtraRowCount}\n`,
        );
    }
    if (summary.redactedIdentitySamples.length > 0) {
        process.stdout.write('  redacted identity samples:\n');
        for (const sample of summary.redactedIdentitySamples.slice(0, 8)) {
            process.stdout.write(`    ${sample.field}: ${sample.id ?? sample.providerModel ?? sample.providerId ?? '-'}\n`);
        }
    }
}

if (!summary.ok) process.exit(1);

