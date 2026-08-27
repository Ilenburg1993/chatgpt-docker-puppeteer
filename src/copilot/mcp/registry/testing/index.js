// @ts-check
/** Testing-only membrane for canonical MCP registry mutable test state. */

export {
    buildMcpToolCallAuditCorrelation,
    readMcpToolTargetCorrelation,
    readMcpTraceCorrelation,
    scopeMcpToolAuditCapability,
} from '../audit-correlation.js';
export {
    buildMcpToolResultAuditMetadataForTests,
    resetCanonicalMcpToolsCacheForTests,
    runToolHandlerWithCancellationForTests,
} from '../runtime.js';
