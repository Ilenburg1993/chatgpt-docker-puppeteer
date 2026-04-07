// @ts-check
import assert from 'node:assert/strict';

import { buildProposalV3 } from '../../../scripts/audit/triage/proposal_engine_v3.mjs';

test('proposal engine builds contract-aware diff for process.exit violations', () => {
    const finding = {
        id: 'BUG-20990101-001',
        contract_id: 'CONTRACT-STATIC-PROCESS-EXIT',
        source_tool: 'check:forbidden',
        file: 'src/infra/locks/resilient_lock.js',
        line: 87,
        evidence: 'process.exit(1);',
        root_cause: 'Uso de process.exit fora de entrypoint.',
        severity: 'P1',
        type: 'falha de contrato',
    };

    const out = buildProposalV3(finding, {
        rankedCauses: [{ cause: 'Uso de process.exit fora de entrypoint.', score: 0.91 }],
        proposeDiffs: true,
        depth: 'deep',
        contextPack: {
            code_context_used: true,
            history: [],
        },
    });

    assert.ok(out.proposal.suggested_diff, 'diff sugerido deve existir em modo proposeDiffs=true');
    assert.match(out.proposal.suggested_diff, /FIX\(CONTRACT-STATIC-PROCESS-EXIT\)/);
    assert.doesNotMatch(out.proposal.suggested_diff, /throw new Error\(/);
});
