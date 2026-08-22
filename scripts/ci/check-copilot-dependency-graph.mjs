#!/usr/bin/env node
// @ts-check
/**
 * Dependency-graph architecture gate for the source tree.
 *
 * Fails on parse errors, unresolved local/package imports or circular components. Files with no incoming edge are
 * reported as informational candidates only because entrypoints, workers and process launchers are legitimately roots.
 *
 * @module scripts/ci/check-copilot-dependency-graph
 */

import { buildDependencyGraph } from '../analysis/dependency-graph.mjs';

/** @param {{scope?:string}} [options] */
export function buildCopilotDependencyGraphGovernanceReport(options = {}) {
    const graph = buildDependencyGraph(options.scope ?? 'src');
    const violations = Object.freeze({
        parseErrors: Object.freeze([...graph.parseErrors]),
        unresolvedLocalImports: Object.freeze([...graph.unresolvedLocalImports]),
        cycles: Object.freeze(graph.cycles.map((cycle) => Object.freeze([...cycle]))),
    });
    return Object.freeze({
        success: Object.values(violations).every((entries) => entries.length === 0),
        scopeRoot: graph.scopeRoot,
        files: graph.files.length,
        edges: Object.values(graph.graph).reduce((total, dependencies) => total + dependencies.length, 0),
        orphanCandidates: graph.orphans.length,
        violations,
    });
}

if (import.meta.url === `file://${process.argv[1]}`) {
    const report = buildCopilotDependencyGraphGovernanceReport();
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (!report.success) process.exitCode = 1;
}
