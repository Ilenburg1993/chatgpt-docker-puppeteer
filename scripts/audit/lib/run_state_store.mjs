import fs from 'node:fs';
import path from 'node:path';

/**
 * @param {{ runDir: string }} options
  * @returns {any}
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
        writeManifest(payload) {
            writeJson(manifestPath, payload);
        },
        writeProgress(payload) {
            writeJson(progressPath, payload);
        },
        addPhaseStatus(entry) {
            phaseTimeline.push(entry);
            writeJson(phaseTimelinePath, phaseTimeline);
        },
        setPhaseTimeline(entries) {
            phaseTimeline = Array.isArray(entries) ? entries : [];
            writeJson(phaseTimelinePath, phaseTimeline);
        },
        writeFindingsRaw(payload) {
            writeJson(findingsRawPath, payload);
        },
        writeFindingsNormalized(payload) {
            writeJson(findingsNormalizedPath, payload);
        },
        writeProposals(payload) {
            writeJson(proposalsPath, payload);
        },
        writeContractRegistrySnapshot(payload) {
            writeJson(contractRegistrySnapshotPath, payload);
        },
        writeContractCoverage(payload) {
            writeJson(contractCoveragePath, payload);
        },
        writeContractDrift(payload) {
            writeJson(contractDriftPath, payload);
        },
        writeContractParity(payload) {
            writeJson(contractParityPath, payload);
        },
        writeSemanticPreflight(payload) {
            writeJson(semanticPreflightPath, payload);
        },
        writeLogStats(payload) {
            writeJson(logStatsPath, payload);
        },
        writeEvidenceGraph(payload) {
            writeJson(evidenceGraphPath, payload);
        },
        writeGateDecisions(payload) {
            writeJson(gateDecisionsPath, payload);
        },
        writeSummary(text) {
            fs.writeFileSync(summaryPath, text, 'utf8');
        },
    };
}
