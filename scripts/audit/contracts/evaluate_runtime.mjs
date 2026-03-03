// @ts-check
/**
 * @typedef {import('./load_registry.mjs').ContractDefinitionV1} ContractDefinitionV1
 */

/**
 * @param {ContractDefinitionV1[]} contracts
 */
function buildSignalMap(contracts) {
    /** @type {Map<string, ContractDefinitionV1>} */
    const map = new Map();
    for (const contract of contracts) {
        const signals = Array.isArray(contract.matcher?.signals) ? contract.matcher.signals : [];
        for (const signal of signals) {
            if (!map.has(signal)) {
                map.set(signal, contract);
            }
        }
    }
    return map;
}

/**
 * @typedef {object} EvaluateRuntimeSignalsOptions
 * @property {ContractDefinitionV1[]} contracts
 * @property {Array<{ signal: string} signals
 * @property {string} evidence
 * @property {string} source_tool
 * @property {string|null} file
 * @property {number|null} line
 */
/**
 * @param {EvaluateRuntimeSignalsOptions} options
  * @returns {object}
 */
export function evaluateRuntimeSignals(options) {
    const signalMap = buildSignalMap(options.contracts || []);
    /** @type {Array<Record<string, unknown>>} */
    const findings = [];

    for (const entry of options.signals || []) {
        const contract = signalMap.get(entry.signal);
        if (!contract) {
            continue;
        }
        findings.push({
            contract_id: contract.id,
            domain: contract.domain,
            source_tool: entry.source_tool || 'contract-runtime',
            file: entry.file || null,
            line: Number.isInteger(entry.line) ? entry.line : null,
            evidence: entry.evidence || `Signal ${entry.signal} acionado`,
            rule: entry.signal,
            severity_hint: contract.severity_default,
            type: contract.type_default,
            impact: contract.description,
            root_cause: `Invariante de runtime violada (${contract.id}).`,
            suggested_patch: `Corrigir fluxo associado ao sinal ${entry.signal} para restabelecer ${contract.title}.`,
            test_strategy: contract.test_recipe.join(' ; '),
            regression_risk:
                contract.severity_default === 'P0' || contract.severity_default === 'P1' ? 'Alto' : 'Médio',
            owner: contract.owner,
            enforcement_state: contract.enforcement?.level || 'warn',
        });
    }

    return findings;
}
