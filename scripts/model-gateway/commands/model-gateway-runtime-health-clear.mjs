#!/usr/bin/env node
import {
    clearByokProviderModelHealth,
    flushAndMirrorByokProviderHealthToSqlite,
    flushByokProviderHealth,
    listByokProviderModelHealth,
    SqliteModelGatewayCatalogStore,
} from '#copilot/model-gateway';

import { createArgReader } from '../cli-args.mjs';

const args = process.argv.slice(2);
const readArg = createArgReader(args);
const argSet = new Set(args);

if (argSet.has('--help') || argSet.has('-h')) {
    process.stdout.write(`Usage: node scripts/model-gateway/commands/model-gateway-runtime-health-clear.mjs [--json] [--provider ID] [--model ID] [--profile ID] [--all] [--apply]

Preview or clear already-observed BYOK runtime health. This never calls providers and never mutates canonical metadata.
Without --apply it is a dry-run preview. Use --all --apply only for deliberate full operational health reset.
`);
    process.exit(0);
}


/** @param {unknown} value */
function clean(value) {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/** @param {string} name */
function readColonArg(name) {
    const prefix = `${name}:`;
    const token = args.find((arg) => arg.startsWith(prefix));
    return token ? token.slice(prefix.length) : '';
}

/**
 * @param {ReturnType<typeof listByokProviderModelHealth>[number]} record
 * @param {{ providerId: string | null, providerModel: string | null, routeProfile: string | null }} scope
 * @param {boolean} all
 */
function matchesScope(record, scope, all) {
    if (all) return true;
    if (scope.providerId && record.providerId !== scope.providerId) return false;
    if (scope.providerModel && record.providerModel !== scope.providerModel) return false;
    if (scope.routeProfile && record.routeProfile !== scope.routeProfile) return false;
    return true;
}

const json = argSet.has('--json');
const apply = argSet.has('--apply') || argSet.has('--yes');
const all = argSet.has('--all');
const scope = {
    providerId: clean(readArg('--provider')) ?? clean(readColonArg('provider')),
    providerModel: clean(readArg('--model')) ?? clean(readColonArg('model')),
    routeProfile: clean(readArg('--profile')) ?? clean(readColonArg('profile')),
};
const hasScope = all || scope.providerId || scope.providerModel || scope.routeProfile;
const before = listByokProviderModelHealth();
const matched = before.filter((record) => matchesScope(record, scope, all));
let after = before;
let mirror = null;
let sqliteClear = null;
let error = null;
if (!hasScope) {
    error = 'scope_required: pass --provider/--model/--profile or --all';
} else if (apply) {
    clearByokProviderModelHealth(all ? {} : scope);
    await flushByokProviderHealth();
    const sqliteStore = new SqliteModelGatewayCatalogStore();
    sqliteClear = await sqliteStore.deleteRuntimeHealthRecords(all ? { all: true } : scope);
    mirror = await flushAndMirrorByokProviderHealthToSqlite({ sqliteStore });
    after = listByokProviderModelHealth();
}

const output = {
    schema: 'model-gateway-runtime-health-clear',
    ok: error === null,
    dryRun: !apply,
    applied: apply && error === null,
    runtimeExecuted: false,
    providersCalled: false,
    canonicalMetadataMutated: false,
    error,
    scope: all ? { all: true } : scope,
    summary: {
        beforeCount: before.length,
        matchedCount: matched.length,
        afterCount: after.length,
    },
    matched: matched.slice(0, 50).map((record) => ({
        routeProfile: record.routeProfile ?? null,
        providerId: record.providerId ?? null,
        providerModel: record.providerModel ?? null,
        lastStatus: record.lastStatus ?? null,
        lastFailureKind: record.lastFailureKind ?? null,
        lastSuccessAt: record.lastSuccessAt ?? null,
        lastFailureAt: record.lastFailureAt ?? null,
    })),
    mirror: mirror
        ? {
              records: mirror.records,
              healthObservations: mirror.healthObservations,
              probeResults: mirror.probeResults,
          }
        : null,
    sqliteClear,
    nextCommands: apply
        ? ['npm run model-gateway:runtime-health:diff', 'npm run model-gateway:auto:ready -- --profile=repo_agent']
        : [
              `npm run model-gateway:runtime-health:clear -- ${[
                  scope.providerId ? `--provider=${scope.providerId}` : null,
                  scope.providerModel ? `--model=${scope.providerModel}` : null,
                  scope.routeProfile ? `--profile=${scope.routeProfile}` : null,
                  all ? '--all' : null,
                  '--apply',
              ]
                  .filter(Boolean)
                  .join(' ')}`,
          ],
};

if (json) {
    process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
} else {
    process.stdout.write(
        `model-gateway runtime health clear: ok=${output.ok ? 'yes' : 'no'} dryRun=${output.dryRun ? 'yes' : 'no'} matched=${output.summary.matchedCount}/${output.summary.beforeCount} applied=${output.applied ? 'yes' : 'no'}\n`,
    );
    if (error) process.stdout.write(`error: ${error}\n`);
    for (const record of output.matched.slice(0, 12)) {
        process.stdout.write(
            `  ${record.routeProfile ?? '*'} ${record.providerId ?? '-'}:${record.providerModel ?? '-'} status=${record.lastStatus ?? '-'} failure=${record.lastFailureKind ?? '-'}\n`,
        );
    }
    if (!apply && output.ok) process.stdout.write(`next: ${output.nextCommands[0]}\n`);
}

if (error) process.exit(2);
