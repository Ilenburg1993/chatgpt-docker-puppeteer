// @ts-check
import fs from 'node:fs';
import path from 'node:path';

/**
 * @typedef {object} CreateRunStateStoreOptions
 * @property {string} runDir
 */
/**
 * @param {CreateRunStateStoreOptions} options
 * @returns {object}
 */
export function createRunStateStore(options) {
    const runDir = options.runDir;
    fs.mkdirSync(runDir, { recursive: true });

    const manifestPath = path.join(runDir, 'run_manifest.json');
    const progressPath = path.join(runDir, 'progress.json');
    const phaseTimelinePath = path.join(runDir, 'phase_timeline.json');
    const findingsRawPath = path.join(runDir, 'findings_raw.json');
    const findingsNormalizedPath = path.join(runDir, 'findings_normalized.json');
    const proposalsPath = path.join(runDir, 'proposals.json');
    const contractRegistrySnapshotPath = path.join(runDir, 'contract_registry_snapshot.json');
    const contractCoveragePath = path.join(runDir, 'contract_coverage.json');
    const contractDriftPath = path.join(runDir, 'contract_drift.json');
    const contractParityPath = path.join(runDir, 'contract_parity.json');
    const semanticPreflightPath = path.join(runDir, 'semantic_preflight.json');
    const logStatsPath = path.join(runDir, 'log_stats.json');
    const evidenceGraphPath = path.join(runDir, 'evidence_graph.json');
    const gateDecisionsPath = path.join(runDir, 'gate_decisions.json');
    const summaryPath = path.join(runDir, 'summary.md');

    /** @type {any[]} */
    let phaseTimeline = [];

    /**
     * @param {string} filePath
     * @param {any} payload
     */
    function writeJson(filePath, payload) {
        fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
    }

    return {
        paths: {
            manifestPath,
            progressPath,
            phaseTimelinePath,
            findingsRawPath,
            findingsNormalizedPath,
            proposalsPath,
            contractRegistrySnapshotPath,
            contractCoveragePath,
            contractDriftPath,
            contractParityPath,
            semanticPreflightPath,
            logStatsPath,
            evidenceGraphPath,
            gateDecisionsPath,
            summaryPath,
        },
        /** @param {any} payload */
        writeManifest(payload) {
            writeJson(manifestPath, payload);
        },
        /** @param {any} payload */
        writeProgress(payload) {
            writeJson(progressPath, payload);
        },
        /** @param {any} entry */
        addPhaseStatus(entry) {
            phaseTimeline.push(entry);
            writeJson(phaseTimelinePath, phaseTimeline);
        },
        /** @param {any} entries */
        setPhaseTimeline(entries) {
            phaseTimeline = Array.isArray(entries) ? entries : [];
            writeJson(phaseTimelinePath, phaseTimeline);
        },
        /** @param {any} payload */
        writeFindingsRaw(payload) {
            writeJson(findingsRawPath, payload);
        },
        /** @param {any} payload */
        writeFindingsNormalized(payload) {
            writeJson(findingsNormalizedPath, payload);
        },
        /** @param {any} payload */
        writeProposals(payload) {
            writeJson(proposalsPath, payload);
        },
        /** @param {any} payload */
        writeContractRegistrySnapshot(payload) {
            writeJson(contractRegistrySnapshotPath, payload);
        },
        /** @param {any} payload */
        writeContractCoverage(payload) {
            writeJson(contractCoveragePath, payload);
        },
        /** @param {any} payload */
        writeContractDrift(payload) {
            writeJson(contractDriftPath, payload);
        },
        /** @param {any} payload */
        writeContractParity(payload) {
            writeJson(contractParityPath, payload);
        },
        /** @param {any} payload */
        writeSemanticPreflight(payload) {
            writeJson(semanticPreflightPath, payload);
        },
        /** @param {any} payload */
        writeLogStats(payload) {
            writeJson(logStatsPath, payload);
        },
        /** @param {any} payload */
        writeEvidenceGraph(payload) {
            writeJson(evidenceGraphPath, payload);
        },
        /** @param {any} payload */
        writeGateDecisions(payload) {
            writeJson(gateDecisionsPath, payload);
        },
        /** @param {any} text */
        writeSummary(text) {
            fs.writeFileSync(summaryPath, text, 'utf8');
        },
    };
}
