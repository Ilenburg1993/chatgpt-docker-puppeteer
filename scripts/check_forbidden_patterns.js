#!/usr/bin/env node
import path from 'node:path';
import { parseArgs } from 'node:util';
import { evaluateStaticContracts } from './audit/contracts/evaluate_static.mjs';
import { getLegacyStaticContracts } from './audit/contracts/legacy_adapter.mjs';
import { loadContractRegistry } from './audit/contracts/load_registry.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const SRC = path.join(ROOT, 'src');

const { values } = parseArgs({
    options: {
        json: { type: 'boolean', default: false },
        'contracts-mode': { type: 'string', default: 'hybrid' },
        'parity-mode': { type: 'boolean', default: true },
    },
});

/**
 * @param {any[]} findings
 */
function mapOutputFindings(findings) {
    return findings.map(item => ({
        contract_id: item.contract_id || 'CONTRACT-UNKNOWN',
        domain: item.domain || 'unknown',
        file: item.file || null,
        line: Number.isInteger(item.line) ? item.line : null,
        evidence: item.evidence || 'n/a',
        severity: item.severity_hint || 'P2',
        type: item.type || 'falha de contrato',
        owner: item.owner || 'unknown',
        enforcement: item.enforcement_state || 'warn',
        message: item.impact || `Violação de contrato ${item.contract_id || 'desconhecido'}.`,
    }));
}

/**
 * @param {any[]} dslFindings
 * @param {any[]} legacyFindings
 */
function parityReport(dslFindings, legacyFindings) {
    /** @type {Map<string, number>} */
    const dslMap = new Map();
    /** @type {Map<string, number>} */
    const legacyMap = new Map();
    for (const item of dslFindings) {
        dslMap.set(item.contract_id, (dslMap.get(item.contract_id) || 0) + 1);
    }
    for (const item of legacyFindings) {
        legacyMap.set(item.contract_id, (legacyMap.get(item.contract_id) || 0) + 1);
    }

    /** @type {Array<{ contract_id: string, dsl: number, legacy: number }>} */
    const mismatches = [];
    const allKeys = new Set([...dslMap.keys(), ...legacyMap.keys()]);
    for (const key of allKeys) {
        const dslCount = dslMap.get(key) || 0;
        const legacyCount = legacyMap.get(key) || 0;
        if (dslCount !== legacyCount) {
            mismatches.push({ contract_id: key, dsl: dslCount, legacy: legacyCount });
        }
    }

    return {
        enabled: true,
        dsl_findings: dslFindings.length,
        legacy_findings: legacyFindings.length,
        mismatches,
    };
}

function main() {
    const mode = ['legacy', 'hybrid', 'strict'].includes(values['contracts-mode']) ? values['contracts-mode'] : 'hybrid';
    const parityEnabled = values['parity-mode'] === true;

    const registry = loadContractRegistry();
    const activeDslContracts = registry.contracts.filter(item => item.kind === 'static' && item.status === 'active');
    const legacyContracts = getLegacyStaticContracts();

    let primaryContracts = legacyContracts;
    if (mode === 'strict' || mode === 'hybrid') {
        primaryContracts = activeDslContracts;
    }

    const primaryEval = evaluateStaticContracts({
        rootDir: ROOT,
        scanDir: SRC,
        contracts: primaryContracts,
        allowlists: registry.allowlists,
    });

    let parity = {
        enabled: false,
        dsl_findings: 0,
        legacy_findings: 0,
        mismatches: [],
    };

    if (mode === 'hybrid' && parityEnabled) {
        const dslEval = evaluateStaticContracts({
            rootDir: ROOT,
            scanDir: SRC,
            contracts: activeDslContracts,
            allowlists: registry.allowlists,
        });
        const legacyEval = evaluateStaticContracts({
            rootDir: ROOT,
            scanDir: SRC,
            contracts: legacyContracts,
            allowlists: {},
        });
        parity = parityReport(dslEval.findings, legacyEval.findings);
    }

    const findings = mapOutputFindings(primaryEval.findings);
    const hasRegistryError = registry.errors.length > 0;
    const payload = {
        ok: findings.length === 0 && !(mode === 'strict' && hasRegistryError),
        mode,
        parity,
        registry: {
            path: registry.registryPath,
            contracts_loaded: registry.contracts.length,
            errors: registry.errors,
            warnings: registry.warnings,
        },
        summary: {
            total_findings: findings.length,
            files_scanned: primaryEval.files_scanned,
            contracts_scanned: primaryEval.contracts_scanned,
            by_contract: primaryEval.hits_by_contract,
        },
        findings,
    };

    if (values.json) {
        console.log(JSON.stringify(payload, null, 2));
    } else if (findings.length > 0) {
        console.error('\n[check_forbidden_patterns] Foram detectadas violações de contrato:');
        for (const f of findings) {
            console.error(`- [${f.contract_id}] ${f.file || 'n/a'}#L${f.line || 1}: ${f.evidence}`);
            console.error(`  -> ${f.message}`);
            console.error(`  -> domain=${f.domain} severity=${f.severity} owner=${f.owner} enforcement=${f.enforcement}\n`);
        }
        if (parity.enabled && parity.mismatches.length > 0) {
            console.error('[check_forbidden_patterns] Parity mismatch (DSL vs legado):');
            for (const mismatch of parity.mismatches) {
                console.error(`  - ${mismatch.contract_id}: dsl=${mismatch.dsl} legacy=${mismatch.legacy}`);
            }
            console.error('');
        }
        console.error('[check_forbidden_patterns] Falha: remova ou justifique itens antes de prosseguir.');
    } else {
        console.log(`[check_forbidden_patterns] OK — nenhum contrato violado em src/ (mode=${mode}).`);
        if (parity.enabled) {
            console.log(`[check_forbidden_patterns] parity: mismatches=${parity.mismatches.length}`);
        }
        if (mode === 'strict' && hasRegistryError) {
            console.error('[check_forbidden_patterns] Falha: registry inválido em modo strict.');
        }
    }

    if (!payload.ok) {
        process.exit(2);
    }
    process.exit(0);
}

main();
