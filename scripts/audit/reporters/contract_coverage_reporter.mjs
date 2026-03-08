// @ts-check
/**
 * @typedef {object} ContractCoverageMap
 * @property {number} total
 * @property {number} violated
 * @property {number} covered
 * @property {number} [covered_by_run]
 * @property {number} [covered_by_tests]
 */
/**
 * @typedef {any} ContractDrift
 */
/**
 * @param {Record<string, ContractCoverageMap>} coverage
 * @param {ContractDrift} [drift]
 * @returns {string}
 */
export function renderContractCoverage(coverage, drift = {}) {
    const lines = ['## Contract Coverage'];
    const domains = Object.keys(coverage || {}).sort();
    if (domains.length === 0) {
        lines.push('- Nenhum domínio de contrato carregado.');
    } else {
        for (const domain of domains) {
            const row = coverage[domain] || { total: 0, violated: 0, covered: 0 };
            const coveredByRun = Number.isFinite(row.covered_by_run) ? row.covered_by_run : row.covered;
            const coveredByTests = Number.isFinite(row.covered_by_tests) ? row.covered_by_tests : 0;
            lines.push(
                `- ${domain}: total=${row.total}, cobertos_run=${coveredByRun}, cobertos_testes=${coveredByTests}, violados=${row.violated}`,
            );
        }
    }

    lines.push('');
    lines.push('## Contract Drift');
    const stale = Array.isArray(drift.stale_contracts) ? drift.stale_contracts : [];
    const unowned = Array.isArray(drift.unowned_critical) ? drift.unowned_critical : [];
    const orphanTests = Array.isArray(drift.tests_without_contract) ? drift.tests_without_contract : [];
    lines.push(`- stale_contracts: ${stale.length}`);
    lines.push(`- unowned_critical: ${unowned.length}`);
    lines.push(`- tests_without_contract: ${orphanTests.length}`);
    return lines.join('\n');
}
