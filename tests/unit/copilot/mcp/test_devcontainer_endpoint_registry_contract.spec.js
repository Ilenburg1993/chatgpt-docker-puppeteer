// @ts-check

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, it } from 'vitest';

const LIBRARY = '.devcontainer/scripts/network/lib/endpoint-registry.sh';
const CANONICAL_REGISTRY = '.devcontainer/scripts/network/endpoints.github-copilot.tsv';

/** @param {string} stdout */
function parseKeyValueLines(stdout) {
    /** @type {Record<string, string>} */
    const output = {};
    for (const line of stdout.split(/\r?\n/u)) {
        const separator = line.indexOf('=');
        if (separator <= 0) continue;
        output[line.slice(0, separator)] = line.slice(separator + 1);
    }
    return output;
}

/** @param {string} registryPath */
/** @param {string} path */
async function pathExists(path) {
    try {
        await stat(path);
        return true;
    } catch {
        return false;
    }
}

/** @param {string} script @param {string[]} args @param {Record<string, string>} env */
function runDevcontainerScript(script, args, env) {
    const result = spawnSync('bash', [script, ...args], {
        cwd: process.cwd(),
        env: { ...process.env, ...env },
        encoding: 'utf8',
        timeout: 20_000,
    });
    if (result.error) throw result.error;
    assert.equal(result.signal, null, `${script} terminated by ${String(result.signal)}\n${result.stderr}`);
    return result;
}

/** @param {string} registryPath */
function auditRegistry(registryPath) {
    const script = [
        'source "$1"',
        'network_endpoint_registry_audit_v1 "$2" v1.2.0',
        'audit_rc=$?',
        'printf "audit_rc=%s\\n" "$audit_rc"',
        'printf "status=%s\\n" "$NETWORK_ENDPOINT_REGISTRY_AUDIT_STATUS"',
        'printf "version_status=%s\\n" "$NETWORK_ENDPOINT_REGISTRY_AUDIT_VERSION_STATUS"',
        'printf "rows=%s\\n" "$NETWORK_ENDPOINT_REGISTRY_AUDIT_ROWS"',
        'printf "bad_urls=%s\\n" "$NETWORK_ENDPOINT_REGISTRY_AUDIT_BAD_URLS"',
        'printf "duplicate_urls=%s\\n" "$NETWORK_ENDPOINT_REGISTRY_AUDIT_DUPLICATE_URLS"',
        'printf "duplicate_ids=%s\\n" "$NETWORK_ENDPOINT_REGISTRY_AUDIT_DUPLICATE_IDS"',
        'printf "total_bad=%s\\n" "$NETWORK_ENDPOINT_REGISTRY_AUDIT_TOTAL_BAD"',
        'materialized="$(network_endpoint_registry_materialize_urls_v1 "$2" 256 2>/dev/null)"',
        'materialize_rc=$?',
        'printf "materialize_rc=%s\\n" "$materialize_rc"',
        'printf "materialized_count=%s\\n" "$(printf "%s\\n" "$materialized" | awk "NF { c++ } END { print c+0 }")"',
    ].join('; ');
    const result = spawnSync('bash', ['--noprofile', '--norc', '-c', script, '_', LIBRARY, registryPath], {
        cwd: process.cwd(),
        encoding: 'utf8',
        timeout: 10_000,
    });
    if (result.error) throw result.error;
    assert.equal(result.signal, null, `registry audit terminated by ${String(result.signal)}`);
    return { process: result, fields: parseKeyValueLines(result.stdout) };
}

describe('DevContainer endpoint registry shared contract', () => {
    it('accepts the canonical v1.2.0 registry and only then materializes all active URLs', () => {
        const result = auditRegistry(CANONICAL_REGISTRY);
        assert.equal(result.process.status, 0);
        assert.equal(result.fields['status'], 'ok');
        assert.equal(result.fields['version_status'], 'ok');
        assert.equal(result.fields['audit_rc'], '0');
        assert.equal(result.fields['total_bad'], '0');
        assert.equal(result.fields['materialize_rc'], '0');
        assert.ok(Number(result.fields['rows']) > 0);
        assert.equal(result.fields['materialized_count'], result.fields['rows']);
    });

    it('rejects a globally invalid registry even when most rows are individually valid', async () => {
        const dir = join(process.cwd(), 'src/copilot/.ai/jobs/endpoint-registry-contract-test');
        await mkdir(dir, { recursive: true });
        const fixture = join(dir, 'duplicate.tsv');
        const canonical = await readFile(CANONICAL_REGISTRY, 'utf8');
        const firstActive = canonical
            .split(/\r?\n/u)
            .find((line) => line.length > 0 && !line.startsWith('#'));
        assert.ok(firstActive);
        await writeFile(fixture, `${canonical.trimEnd()}\n${firstActive}\n`, 'utf8');
        try {
            const result = auditRegistry(fixture);
            assert.equal(result.fields['status'], 'invalid');
            assert.notEqual(result.fields['audit_rc'], '0');
            assert.ok(Number(result.fields['duplicate_urls']) >= 1);
            assert.ok(Number(result.fields['duplicate_ids']) >= 1);
            assert.notEqual(result.fields['materialize_rc'], '0');
            assert.equal(result.fields['materialized_count'], '0');
        } finally {
            await rm(dir, { recursive: true, force: true });
        }
    });

    it('rejects version drift and malformed five-field contract rows before materialization', async () => {
        const dir = join(process.cwd(), 'src/copilot/.ai/jobs/endpoint-registry-contract-version-test');
        await mkdir(dir, { recursive: true });
        const fixture = join(dir, 'invalid.tsv');
        const canonical = await readFile(CANONICAL_REGISTRY, 'utf8');
        const content = canonical
            .replace('# Version: v1.2.0', '# Version: v9.9.9')
            .concat('\nhttps://example.com/\tbad id with spaces\tcapability\turgent\t999\n');
        await writeFile(fixture, content, 'utf8');
        try {
            const result = auditRegistry(fixture);
            assert.equal(result.fields['status'], 'invalid');
            assert.equal(result.fields['version_status'], 'mismatch');
            assert.ok(Number(result.fields['total_bad']) >= 2);
            assert.notEqual(result.fields['materialize_rc'], '0');
            assert.equal(result.fields['materialized_count'], '0');
        } finally {
            await rm(dir, { recursive: true, force: true });
        }
    });

    it('manager never consumes a globally invalid registry and falls back before probes', async () => {
        const dir = join(process.cwd(), 'src/copilot/.ai/jobs/endpoint-registry-manager-consumer-test');
        await mkdir(dir, { recursive: true });
        const fixture = join(dir, 'invalid.tsv');
        const report = join(dir, 'manager.report');
        const summary = join(dir, 'manager.summary');
        const canonical = await readFile(CANONICAL_REGISTRY, 'utf8');
        const firstActive = canonical.split(/\r?\n/u).find((line) => line.length > 0 && !line.startsWith('#'));
        assert.ok(firstActive);
        await writeFile(fixture, `${canonical.trimEnd()}\n${firstActive}\n`, 'utf8');
        try {
            const result = runDevcontainerScript('.devcontainer/scripts/network/github-copilot-network-manager.sh', ['start'], {
                DEVCONTAINER_COPILOT_ENDPOINT_REGISTRY_FILE: fixture,
                DEVCONTAINER_COPILOT_ENDPOINT_REGISTRY_CANONICAL_FILE: fixture,
                DEVCONTAINER_COPILOT_NETWORK_MANAGER_MODE: 'off',
                DEVCONTAINER_COPILOT_NETWORK_REPORT_FILE: report,
                DEVCONTAINER_COPILOT_NETWORK_METRICS_FILE: join(dir, 'manager.metrics.tsv'),
                DEVCONTAINER_COPILOT_NETWORK_STATUS_FILE: join(dir, 'manager.status'),
                DEVCONTAINER_COPILOT_NETWORK_SUMMARY_FILE: summary,
                DEVCONTAINER_COPILOT_NETWORK_DIAGNOSIS_FILE: join(dir, 'manager.diagnosis.tsv'),
                DEVCONTAINER_COPILOT_NETWORK_HISTORY_FILE: join(dir, 'manager.history.tsv'),
                DEVCONTAINER_COPILOT_NETWORK_HISTORY_ANALYSIS_FILE: join(dir, 'manager.history-analysis.tsv'),
                DEVCONTAINER_COPILOT_NETWORK_RECOMMENDATION_FILE: join(dir, 'manager.recommendation'),
                DEVCONTAINER_COPILOT_NETWORK_RECOMMENDATION_JSON_FILE: join(dir, 'manager.recommendation.json'),
                DEVCONTAINER_COPILOT_NETWORK_LOCK_FILE: join(dir, 'manager.lock'),
            });
            assert.equal(result.status, 0, result.stderr);
            const [reportText, summaryText] = await Promise.all([readFile(report, 'utf8'), readFile(summary, 'utf8')]);
            assert.match(reportText, /endpoint_source=default-registry-invalid/u);
            assert.match(summaryText, /endpoint_source=default-registry-invalid/u);
            const firstActiveId = firstActive.split('\t')[0];
            if (!firstActiveId) throw new Error('Registro ativo sem identificador.');
            assert.doesNotMatch(reportText, new RegExp(firstActiveId.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'));
        } finally {
            await rm(dir, { recursive: true, force: true });
        }
    });

    it('advisor treats an invalid registry as non-authoritative and falls back without probing', async () => {
        const dir = join(process.cwd(), 'src/copilot/.ai/jobs/endpoint-registry-advisor-consumer-test');
        await mkdir(dir, { recursive: true });
        const fixture = join(dir, 'invalid.tsv');
        const summary = join(dir, 'advisor.summary');
        const canonical = await readFile(CANONICAL_REGISTRY, 'utf8');
        const firstActive = canonical.split(/\r?\n/u).find((line) => line.length > 0 && !line.startsWith('#'));
        assert.ok(firstActive);
        await writeFile(fixture, `${canonical.trimEnd()}\n${firstActive}\n`, 'utf8');
        try {
            const result = runDevcontainerScript('.devcontainer/scripts/network/copilot-route-advisor.sh', ['start'], {
                DEVCONTAINER_COPILOT_ENDPOINT_REGISTRY_FILE: fixture,
                DEVCONTAINER_COPILOT_ROUTE_ADVISOR_MODE: 'off',
                DEVCONTAINER_COPILOT_ROUTE_ADVISOR_REPORT_FILE: join(dir, 'advisor.report'),
                DEVCONTAINER_COPILOT_ROUTE_ADVISOR_METRICS_FILE: join(dir, 'advisor.metrics.tsv'),
                DEVCONTAINER_COPILOT_ROUTE_ADVISOR_DECISIONS_FILE: join(dir, 'advisor.decisions.tsv'),
                DEVCONTAINER_COPILOT_ROUTE_ADVISOR_STATUS_FILE: join(dir, 'advisor.status'),
                DEVCONTAINER_COPILOT_ROUTE_ADVISOR_SUMMARY_FILE: summary,
                DEVCONTAINER_COPILOT_ROUTE_ADVISOR_LOCK_FILE: join(dir, 'advisor.lock'),
            });
            assert.equal(result.status, 0, result.stderr);
            const summaryText = await readFile(summary, 'utf8');
            assert.match(summaryText, /endpoint_source=default-registry-invalid/u);
            assert.match(summaryText, /endpoint_registry_status=invalid/u);
        } finally {
            await rm(dir, { recursive: true, force: true });
        }
    });

    it('proxy fails closed before actuation when the enabled registry is invalid', async () => {
        const dir = join(process.cwd(), 'src/copilot/.ai/jobs/endpoint-registry-proxy-consumer-test');
        await mkdir(dir, { recursive: true });
        const fixture = join(dir, 'invalid.tsv');
        const statusFile = join(dir, 'proxy.status');
        const summaryFile = join(dir, 'proxy.summary');
        const runtimeDir = join(dir, 'runtime');
        const canonical = await readFile(CANONICAL_REGISTRY, 'utf8');
        const firstActive = canonical.split(/\r?\n/u).find((line) => line.length > 0 && !line.startsWith('#'));
        assert.ok(firstActive);
        await writeFile(fixture, `${canonical.trimEnd()}\n${firstActive}\n`, 'utf8');
        try {
            const result = runDevcontainerScript('.devcontainer/scripts/network/local-copilot-proxy.sh', ['start'], {
                DEVCONTAINER_COPILOT_ENDPOINT_REGISTRY_FILE: fixture,
                DEVCONTAINER_LOCAL_COPILOT_PROXY_MODE: 'local',
                DEVCONTAINER_LOCAL_COPILOT_PROXY_RUNTIME_DIR: runtimeDir,
                DEVCONTAINER_LOCAL_COPILOT_PROXY_REPORT_FILE: join(dir, 'proxy.report'),
                DEVCONTAINER_LOCAL_COPILOT_PROXY_STATUS_FILE: statusFile,
                DEVCONTAINER_LOCAL_COPILOT_PROXY_SUMMARY_FILE: summaryFile,
                DEVCONTAINER_LOCAL_COPILOT_PROXY_METRICS_FILE: join(dir, 'proxy.metrics.tsv'),
                DEVCONTAINER_LOCAL_COPILOT_PROXY_ENV_FILE: join(dir, 'proxy.env'),
                DEVCONTAINER_LOCAL_COPILOT_PROXY_VSCODE_HINT_FILE: join(dir, 'proxy.vscode.json'),
            });
            assert.notEqual(result.status, 0);
            assert.equal((await readFile(statusFile, 'utf8')).trim(), 'blocked');
            const summaryText = await readFile(summaryFile, 'utf8');
            assert.match(summaryText, /reason=endpoint-registry-invalid/u);
            assert.match(summaryText, /probe_url_source=blocked-registry-invalid/u);
            assert.equal(await pathExists(join(runtimeDir, 'tinyproxy-copilot.pid')), false);
            assert.equal(await pathExists(join(runtimeDir, 'tinyproxy-copilot.conf')), false);
        } finally {
            await rm(dir, { recursive: true, force: true });
        }
    });
});
