// @ts-check
/**
 * @typedef {any} GroupKeyFinding
 */
/**
 * @param {GroupKeyFinding} finding
 */
function groupKey(finding) {
    if (finding.contract_id) {
        const fileToken = finding.file
            ? String(finding.file).replace(/\\/g, '/').split('/').slice(0, 3).join('/')
            : 'global';
        return `contract:${finding.contract_id}:${fileToken}`;
    }
    if (finding.file) {
        const normalized = String(finding.file).replace(/\\/g, '/');
        const parts = normalized.split('/');
        return `file:${parts.slice(0, Math.min(parts.length, 3)).join('/')}`;
    }
    return `tool:${finding.source_tool || 'unknown'}`;
}

/**
 * @param {unknown[]} findings
 * @returns {object}
 */
export function buildEvidenceGraph(findings) {
    /** @type {Map<string, any[]>} */
    const groups = new Map();
    for (const finding of findings) {
        const key = groupKey(finding);
        if (!groups.has(key)) {
            groups.set(key, []);
        }
        const bucket = groups.get(key);
        if (bucket) bucket.push(finding);
    }

    /** @type {{ id: string; label: string; size: number; contract_id?: string | null }[]} */
    const nodes = [];
    /** @type {{ from: string; to: string; reason: string }[]} */
    const edges = [];

    let index = 1;
    for (const [key, list] of groups.entries()) {
        const nodeId = `EVG-${String(index).padStart(4, '0')}`;
        index += 1;
        const contractId = list[0]?.contract_id || null;
        nodes.push({
            id: nodeId,
            label: key,
            size: list.length,
            contract_id: contractId,
        });
        for (const finding of list) {
            finding.evidence_graph_id = nodeId;
            finding.root_cause_candidates = Array.isArray(finding.root_cause_candidates)
                ? finding.root_cause_candidates
                : [];
        }
    }

    for (let i = 0; i < nodes.length; i += 1) {
        for (let j = i + 1; j < nodes.length; j += 1) {
            const left = /** @type {any} */ (nodes[i]);
            const right = /** @type {any} */ (nodes[j]);
            if (left.contract_id && right.contract_id && left.contract_id === right.contract_id) {
                edges.push({
                    from: left.id,
                    to: right.id,
                    reason: 'shared_contract',
                });
            }
        }
    }

    return {
        graph: {
            nodes,
            edges,
        },
        findings,
    };
}
