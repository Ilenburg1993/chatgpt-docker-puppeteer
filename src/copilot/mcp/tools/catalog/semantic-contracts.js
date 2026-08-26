// @ts-check
/**
 * Exhaustive semantic contracts for the canonical MCP tool catalog.
 *
 * Every canonical tool name must appear exactly once. New/stale names fail catalog construction. Protocol annotations,
 * OAuth caller scope, risk, retry semantics, cancellation and output-contract class are projections of these entries.
 *
 * @module copilot/mcp/tools/catalog/semantic-contracts
 */

import {
    classifyMcpToolContractRisk,
    projectMcpToolAnnotations,
    validateMcpToolContractSemantics,
} from '#copilot/mcp/public/protocol/catalog';

export const MCP_TOOL_CONTRACTS_VERSION = '2.0.0';

/** @typedef {Readonly<{
 * effect: import('#copilot/mcp/public/protocol/catalog').McpToolContract['effects']['mutation'];
 * externalSideEffects: import('#copilot/mcp/public/protocol/catalog').McpToolContract['effects']['externalSideEffects'];
 * callerScope: import('#copilot/mcp/public/protocol/catalog').McpToolContract['authority']['callerScope'];
 * network: import('#copilot/mcp/public/protocol/catalog').McpToolContract['authority']['network'];
 * credentials: readonly import('#copilot/mcp/public/protocol/catalog').McpToolContract['credentials'][number][];
 * idempotency: import('#copilot/mcp/public/protocol/catalog').McpToolContract['idempotency'];
 * retry: import('#copilot/mcp/public/protocol/catalog').McpToolContract['retry'];
 * execution: import('#copilot/mcp/public/protocol/catalog').McpToolExecutionContract;
 * output: import('#copilot/mcp/public/protocol/catalog').McpToolContract['output']['class'];
 * maxResultBytes?: number;
 * }>} McpToolContractProfile */

const CONTRACT_PROFILE_BY_TOOL = /** @type {Readonly<Record<string, McpToolContractProfile>>} */ (
    Object.freeze({
        repo_status: {
            effect: 'none',
            idempotency: 'idempotent',
            callerScope: 'read',
            execution: {
                cancellation: 'cancellable',
                drainTimeoutMs: 15000,
                rationale:
                    'OperationContext.signal reaches the owned cancellable/acceptance boundary; after abort the handler must settle only after owned call-scoped work is terminal.',
            },
            output: 'specific',
            network: 'local',
            credentials: ['none'],
            externalSideEffects: 'none',
            retry: 'safe',
        },
        repo_tree: {
            effect: 'none',
            idempotency: 'idempotent',
            callerScope: 'read',
            execution: {
                cancellation: 'bounded-non-cancellable',
                continuationBoundMs: 120000,
                rationale:
                    'Current implementation is locally/input bounded but does not yet prove end-to-end cooperative cancellation; bounded work may settle after the registry reports cancellation.',
            },
            output: 'intentional-untyped',
            network: 'local',
            credentials: ['none'],
            externalSideEffects: 'none',
            retry: 'safe',
        },
        repo_root_tree: {
            effect: 'none',
            idempotency: 'idempotent',
            callerScope: 'read',
            execution: {
                cancellation: 'bounded-non-cancellable',
                continuationBoundMs: 120000,
                rationale:
                    'Current implementation is locally/input bounded but does not yet prove end-to-end cooperative cancellation; bounded work may settle after the registry reports cancellation.',
            },
            output: 'intentional-untyped',
            network: 'local',
            credentials: ['none'],
            externalSideEffects: 'none',
            retry: 'safe',
        },
        repo_root_redaction_status: {
            effect: 'none',
            idempotency: 'idempotent',
            callerScope: 'read',
            execution: {
                cancellation: 'bounded-non-cancellable',
                continuationBoundMs: 120000,
                rationale:
                    'Current implementation is locally/input bounded but does not yet prove end-to-end cooperative cancellation; bounded work may settle after the registry reports cancellation.',
            },
            output: 'intentional-untyped',
            network: 'local',
            credentials: ['none'],
            externalSideEffects: 'none',
            retry: 'safe',
        },
        repo_read_file: {
            effect: 'none',
            idempotency: 'idempotent',
            callerScope: 'read',
            execution: {
                cancellation: 'bounded-non-cancellable',
                continuationBoundMs: 120000,
                rationale:
                    'Current implementation is locally/input bounded but does not yet prove end-to-end cooperative cancellation; bounded work may settle after the registry reports cancellation.',
            },
            output: 'intentional-untyped',
            network: 'local',
            credentials: ['none'],
            externalSideEffects: 'none',
            retry: 'safe',
        },
        repo_file_stats: {
            effect: 'none',
            idempotency: 'idempotent',
            callerScope: 'read',
            execution: {
                cancellation: 'bounded-non-cancellable',
                continuationBoundMs: 120000,
                rationale:
                    'Current implementation is locally/input bounded but does not yet prove end-to-end cooperative cancellation; bounded work may settle after the registry reports cancellation.',
            },
            output: 'intentional-untyped',
            network: 'local',
            credentials: ['none'],
            externalSideEffects: 'none',
            retry: 'safe',
        },
        repo_bulk_inspect: {
            effect: 'none',
            idempotency: 'idempotent',
            callerScope: 'read',
            execution: {
                cancellation: 'bounded-non-cancellable',
                continuationBoundMs: 120000,
                rationale:
                    'Current implementation is locally/input bounded but does not yet prove end-to-end cooperative cancellation; bounded work may settle after the registry reports cancellation.',
            },
            output: 'intentional-untyped',
            network: 'local',
            credentials: ['none'],
            externalSideEffects: 'none',
            retry: 'safe',
        },
        repo_read_file_chunks: {
            effect: 'none',
            idempotency: 'idempotent',
            callerScope: 'read',
            execution: {
                cancellation: 'bounded-non-cancellable',
                continuationBoundMs: 120000,
                rationale:
                    'Current implementation is locally/input bounded but does not yet prove end-to-end cooperative cancellation; bounded work may settle after the registry reports cancellation.',
            },
            output: 'intentional-untyped',
            network: 'local',
            credentials: ['none'],
            externalSideEffects: 'none',
            retry: 'safe',
        },
        repo_diff_files: {
            effect: 'none',
            idempotency: 'idempotent',
            callerScope: 'read',
            execution: {
                cancellation: 'bounded-non-cancellable',
                continuationBoundMs: 120000,
                rationale:
                    'Current implementation is locally/input bounded but does not yet prove end-to-end cooperative cancellation; bounded work may settle after the registry reports cancellation.',
            },
            output: 'intentional-untyped',
            network: 'local',
            credentials: ['none'],
            externalSideEffects: 'none',
            retry: 'safe',
        },
        repo_search_text: {
            effect: 'none',
            idempotency: 'idempotent',
            callerScope: 'read',
            execution: {
                cancellation: 'bounded-non-cancellable',
                continuationBoundMs: 300000,
                rationale:
                    'Current external/network path has explicit request/input bounds but does not yet prove cooperative cancellation across every remote primitive.',
            },
            output: 'intentional-untyped',
            network: 'local',
            credentials: ['none'],
            externalSideEffects: 'none',
            retry: 'safe',
        },
        repo_find_symbol_usages: {
            effect: 'none',
            idempotency: 'idempotent',
            callerScope: 'read',
            execution: {
                cancellation: 'bounded-non-cancellable',
                continuationBoundMs: 120000,
                rationale:
                    'Current implementation is locally/input bounded but does not yet prove end-to-end cooperative cancellation; bounded work may settle after the registry reports cancellation.',
            },
            output: 'intentional-untyped',
            network: 'local',
            credentials: ['none'],
            externalSideEffects: 'none',
            retry: 'safe',
        },
        repo_symbol_search: {
            effect: 'none',
            idempotency: 'idempotent',
            callerScope: 'read',
            execution: {
                cancellation: 'bounded-non-cancellable',
                continuationBoundMs: 300000,
                rationale:
                    'Current external/network path has explicit request/input bounds but does not yet prove cooperative cancellation across every remote primitive.',
            },
            output: 'intentional-untyped',
            network: 'local',
            credentials: ['none'],
            externalSideEffects: 'none',
            retry: 'safe',
        },
        repo_file_outline: {
            effect: 'none',
            idempotency: 'idempotent',
            callerScope: 'read',
            execution: {
                cancellation: 'bounded-non-cancellable',
                continuationBoundMs: 120000,
                rationale:
                    'Current implementation is locally/input bounded but does not yet prove end-to-end cooperative cancellation; bounded work may settle after the registry reports cancellation.',
            },
            output: 'intentional-untyped',
            network: 'local',
            credentials: ['none'],
            externalSideEffects: 'none',
            retry: 'safe',
        },
        repo_create_file_plan: {
            effect: 'none',
            idempotency: 'idempotent',
            callerScope: 'read',
            execution: {
                cancellation: 'bounded-non-cancellable',
                continuationBoundMs: 3600000,
                rationale:
                    'Mutation is governed by its application contract, but cancellation is not yet proven across every transactional/recovery phase; late completion remains explicit migration debt.',
            },
            output: 'intentional-untyped',
            network: 'local',
            credentials: ['none'],
            externalSideEffects: 'none',
            retry: 'safe',
        },
        repo_patch_plan: {
            effect: 'none',
            idempotency: 'idempotent',
            callerScope: 'read',
            execution: {
                cancellation: 'bounded-non-cancellable',
                continuationBoundMs: 120000,
                rationale:
                    'Current implementation is locally/input bounded but does not yet prove end-to-end cooperative cancellation; bounded work may settle after the registry reports cancellation.',
            },
            output: 'intentional-untyped',
            network: 'local',
            credentials: ['none'],
            externalSideEffects: 'none',
            retry: 'safe',
        },
        repo_quarantine_file_plan: {
            effect: 'none',
            idempotency: 'idempotent',
            callerScope: 'read',
            execution: {
                cancellation: 'bounded-non-cancellable',
                continuationBoundMs: 3600000,
                rationale:
                    'Mutation is governed by its application contract, but cancellation is not yet proven across every transactional/recovery phase; late completion remains explicit migration debt.',
            },
            output: 'intentional-untyped',
            network: 'local',
            credentials: ['none'],
            externalSideEffects: 'none',
            retry: 'safe',
        },
        repo_move_file_plan: {
            effect: 'none',
            idempotency: 'idempotent',
            callerScope: 'read',
            execution: {
                cancellation: 'bounded-non-cancellable',
                continuationBoundMs: 3600000,
                rationale:
                    'Mutation is governed by its application contract, but cancellation is not yet proven across every transactional/recovery phase; late completion remains explicit migration debt.',
            },
            output: 'intentional-untyped',
            network: 'local',
            credentials: ['none'],
            externalSideEffects: 'none',
            retry: 'safe',
        },
        repo_index_refresh_plan: {
            effect: 'none',
            idempotency: 'idempotent',
            callerScope: 'read',
            execution: {
                cancellation: 'bounded-non-cancellable',
                continuationBoundMs: 120000,
                rationale:
                    'Current implementation is locally/input bounded but does not yet prove end-to-end cooperative cancellation; bounded work may settle after the registry reports cancellation.',
            },
            output: 'intentional-untyped',
            network: 'local',
            credentials: ['none'],
            externalSideEffects: 'none',
            retry: 'safe',
        },
        mcp_validation_plan: {
            effect: 'none',
            idempotency: 'idempotent',
            callerScope: 'validate',
            execution: {
                cancellation: 'not-applicable',
                rationale:
                    'The operation does not claim caller-owned long-running work for which cooperative drain is a meaningful lifecycle promise.',
            },
            output: 'intentional-untyped',
            network: 'local',
            credentials: ['none'],
            externalSideEffects: 'none',
            retry: 'safe',
        },
        repo_index_status: {
            effect: 'none',
            idempotency: 'idempotent',
            callerScope: 'read',
            execution: {
                cancellation: 'not-applicable',
                rationale:
                    'The operation does not claim caller-owned long-running work for which cooperative drain is a meaningful lifecycle promise.',
            },
            output: 'intentional-untyped',
            network: 'local',
            credentials: ['none'],
            externalSideEffects: 'none',
            retry: 'safe',
        },
        repo_index_build: {
            effect: 'bounded-write',
            idempotency: 'non-idempotent',
            callerScope: 'write',
            execution: {
                cancellation: 'cancellable',
                drainTimeoutMs: 15000,
                rationale:
                    'OperationContext.signal reaches the owned cancellable/acceptance boundary; after abort the handler must settle only after owned call-scoped work is terminal.',
            },
            output: 'intentional-untyped',
            network: 'local',
            credentials: ['none'],
            externalSideEffects: 'none',
            retry: 'manual-only',
        },
        repo_index_search: {
            effect: 'none',
            idempotency: 'idempotent',
            callerScope: 'read',
            execution: {
                cancellation: 'bounded-non-cancellable',
                continuationBoundMs: 300000,
                rationale:
                    'Current external/network path has explicit request/input bounds but does not yet prove cooperative cancellation across every remote primitive.',
            },
            output: 'intentional-untyped',
            network: 'local',
            credentials: ['none'],
            externalSideEffects: 'none',
            retry: 'safe',
        },
        repo_index_find_symbol: {
            effect: 'none',
            idempotency: 'idempotent',
            callerScope: 'read',
            execution: {
                cancellation: 'bounded-non-cancellable',
                continuationBoundMs: 120000,
                rationale:
                    'Current implementation is locally/input bounded but does not yet prove end-to-end cooperative cancellation; bounded work may settle after the registry reports cancellation.',
            },
            output: 'intentional-untyped',
            network: 'local',
            credentials: ['none'],
            externalSideEffects: 'none',
            retry: 'safe',
        },
        repo_find_imports: {
            effect: 'none',
            idempotency: 'idempotent',
            callerScope: 'read',
            execution: {
                cancellation: 'bounded-non-cancellable',
                continuationBoundMs: 120000,
                rationale:
                    'Current implementation is locally/input bounded but does not yet prove end-to-end cooperative cancellation; bounded work may settle after the registry reports cancellation.',
            },
            output: 'intentional-untyped',
            network: 'local',
            credentials: ['none'],
            externalSideEffects: 'none',
            retry: 'safe',
        },
        repo_find_orphan_imports: {
            effect: 'none',
            idempotency: 'idempotent',
            callerScope: 'read',
            execution: {
                cancellation: 'bounded-non-cancellable',
                continuationBoundMs: 120000,
                rationale:
                    'Current implementation is locally/input bounded but does not yet prove end-to-end cooperative cancellation; bounded work may settle after the registry reports cancellation.',
            },
            output: 'intentional-untyped',
            network: 'local',
            credentials: ['none'],
            externalSideEffects: 'none',
            retry: 'safe',
        },
        repo_index_invalidate: {
            effect: 'bounded-write',
            idempotency: 'non-idempotent',
            callerScope: 'write',
            execution: {
                cancellation: 'bounded-non-cancellable',
                continuationBoundMs: 3600000,
                rationale:
                    'Mutation is governed by its application contract, but cancellation is not yet proven across every transactional/recovery phase; late completion remains explicit migration debt.',
            },
            output: 'intentional-untyped',
            network: 'local',
            credentials: ['none'],
            externalSideEffects: 'none',
            retry: 'manual-only',
        },
        repo_working_set: {
            effect: 'none',
            idempotency: 'stateful-read',
            callerScope: 'read',
            execution: {
                cancellation: 'bounded-non-cancellable',
                continuationBoundMs: 120000,
                rationale:
                    'Current implementation is locally/input bounded but does not yet prove end-to-end cooperative cancellation; bounded work may settle after the registry reports cancellation.',
            },
            output: 'intentional-untyped',
            network: 'local',
            credentials: ['none'],
            externalSideEffects: 'none',
            retry: 'conditional',
        },
        git_status: {
            effect: 'none',
            idempotency: 'idempotent',
            callerScope: 'read',
            execution: {
                cancellation: 'cancellable',
                drainTimeoutMs: 15000,
                rationale:
                    'OperationContext.signal reaches the owned cancellable/acceptance boundary; after abort the handler must settle only after owned call-scoped work is terminal.',
            },
            output: 'specific',
            network: 'local',
            credentials: ['none'],
            externalSideEffects: 'none',
            retry: 'safe',
        },
        git_diff: {
            effect: 'none',
            idempotency: 'idempotent',
            callerScope: 'read',
            execution: {
                cancellation: 'cancellable',
                drainTimeoutMs: 15000,
                rationale:
                    'OperationContext.signal reaches the owned cancellable/acceptance boundary; after abort the handler must settle only after owned call-scoped work is terminal.',
            },
            output: 'specific',
            network: 'local',
            credentials: ['none'],
            externalSideEffects: 'none',
            retry: 'safe',
        },
        git_log: {
            effect: 'none',
            idempotency: 'idempotent',
            callerScope: 'read',
            execution: {
                cancellation: 'cancellable',
                drainTimeoutMs: 15000,
                rationale:
                    'OperationContext.signal reaches the owned cancellable/acceptance boundary; after abort the handler must settle only after owned call-scoped work is terminal.',
            },
            output: 'specific',
            network: 'local',
            credentials: ['none'],
            externalSideEffects: 'none',
            retry: 'safe',
        },
        git_branch_info: {
            effect: 'none',
            idempotency: 'idempotent',
            callerScope: 'read',
            execution: {
                cancellation: 'cancellable',
                drainTimeoutMs: 15000,
                rationale:
                    'OperationContext.signal reaches the owned cancellable/acceptance boundary; after abort the handler must settle only after owned call-scoped work is terminal.',
            },
            output: 'specific',
            network: 'local',
            credentials: ['none'],
            externalSideEffects: 'none',
            retry: 'safe',
        },
        git_stage_plan: {
            effect: 'none',
            idempotency: 'idempotent',
            callerScope: 'read',
            execution: {
                cancellation: 'cancellable',
                drainTimeoutMs: 15000,
                rationale:
                    'OperationContext.signal reaches the owned cancellable/acceptance boundary; after abort the handler must settle only after owned call-scoped work is terminal.',
            },
            output: 'intentional-untyped',
            network: 'local',
            credentials: ['none'],
            externalSideEffects: 'none',
            retry: 'safe',
        },
        git_stage: {
            effect: 'bounded-write',
            idempotency: 'non-idempotent',
            callerScope: 'write',
            execution: {
                cancellation: 'cancellable',
                drainTimeoutMs: 15000,
                rationale:
                    'OperationContext.signal reaches the owned cancellable/acceptance boundary; after abort the handler must settle only after owned call-scoped work is terminal.',
            },
            output: 'intentional-untyped',
            network: 'local',
            credentials: ['none'],
            externalSideEffects: 'none',
            retry: 'manual-only',
        },
        git_commit_plan: {
            effect: 'none',
            idempotency: 'idempotent',
            callerScope: 'read',
            execution: {
                cancellation: 'cancellable',
                drainTimeoutMs: 15000,
                rationale:
                    'OperationContext.signal reaches the owned cancellable/acceptance boundary; after abort the handler must settle only after owned call-scoped work is terminal.',
            },
            output: 'intentional-untyped',
            network: 'local',
            credentials: ['none'],
            externalSideEffects: 'none',
            retry: 'safe',
        },
        git_commit: {
            effect: 'bounded-write',
            idempotency: 'non-idempotent',
            callerScope: 'write',
            execution: {
                cancellation: 'cancellable',
                drainTimeoutMs: 15000,
                rationale:
                    'OperationContext.signal reaches the owned cancellable/acceptance boundary; after abort the handler must settle only after owned call-scoped work is terminal.',
            },
            output: 'intentional-untyped',
            network: 'local',
            credentials: ['none'],
            externalSideEffects: 'none',
            retry: 'manual-only',
        },
        git_push_plan: {
            effect: 'none',
            idempotency: 'idempotent',
            callerScope: 'read',
            execution: {
                cancellation: 'cancellable',
                drainTimeoutMs: 15000,
                rationale:
                    'OperationContext.signal reaches the owned cancellable/acceptance boundary; after abort the handler must settle only after owned call-scoped work is terminal.',
            },
            output: 'intentional-untyped',
            network: 'open-world',
            credentials: ['git-upstream'],
            externalSideEffects: 'none',
            retry: 'safe',
        },
        git_publish_changes: {
            effect: 'destructive',
            idempotency: 'non-idempotent',
            callerScope: 'admin',
            execution: {
                cancellation: 'cancellable',
                drainTimeoutMs: 15000,
                rationale:
                    'OperationContext.signal reaches the owned cancellable/acceptance boundary; after abort the handler must settle only after owned call-scoped work is terminal.',
            },
            output: 'intentional-untyped',
            network: 'open-world',
            credentials: ['git-upstream'],
            externalSideEffects: 'guarded',
            retry: 'manual-only',
        },
        git_push: {
            effect: 'destructive',
            idempotency: 'non-idempotent',
            callerScope: 'admin',
            execution: {
                cancellation: 'cancellable',
                drainTimeoutMs: 15000,
                rationale:
                    'OperationContext.signal reaches the owned cancellable/acceptance boundary; after abort the handler must settle only after owned call-scoped work is terminal.',
            },
            output: 'intentional-untyped',
            network: 'open-world',
            credentials: ['git-upstream'],
            externalSideEffects: 'guarded',
            retry: 'manual-only',
        },
        project_doctor: {
            effect: 'none',
            idempotency: 'idempotent',
            callerScope: 'read',
            execution: {
                cancellation: 'cancellable',
                drainTimeoutMs: 15000,
                rationale:
                    'OperationContext.signal reaches the owned cancellable/acceptance boundary; after abort the handler must settle only after owned call-scoped work is terminal.',
            },
            output: 'intentional-untyped',
            network: 'local',
            credentials: ['none'],
            externalSideEffects: 'none',
            retry: 'safe',
        },
        run_typecheck_copilot: {
            effect: 'bounded-write',
            idempotency: 'non-idempotent',
            callerScope: 'validate',
            execution: {
                cancellation: 'cancellable',
                drainTimeoutMs: 15000,
                rationale:
                    'OperationContext.signal reaches the owned cancellable/acceptance boundary; after abort the handler must settle only after owned call-scoped work is terminal.',
            },
            output: 'intentional-untyped',
            network: 'local',
            credentials: ['none'],
            externalSideEffects: 'none',
            retry: 'manual-only',
        },
        run_lint_copilot: {
            effect: 'bounded-write',
            idempotency: 'non-idempotent',
            callerScope: 'validate',
            execution: {
                cancellation: 'cancellable',
                drainTimeoutMs: 15000,
                rationale:
                    'OperationContext.signal reaches the owned cancellable/acceptance boundary; after abort the handler must settle only after owned call-scoped work is terminal.',
            },
            output: 'intentional-untyped',
            network: 'local',
            credentials: ['none'],
            externalSideEffects: 'none',
            retry: 'manual-only',
        },
        run_unit_copilot: {
            effect: 'bounded-write',
            idempotency: 'non-idempotent',
            callerScope: 'validate',
            execution: {
                cancellation: 'cancellable',
                drainTimeoutMs: 15000,
                rationale:
                    'OperationContext.signal reaches the owned cancellable/acceptance boundary; after abort the handler must settle only after owned call-scoped work is terminal.',
            },
            output: 'intentional-untyped',
            network: 'local',
            credentials: ['none'],
            externalSideEffects: 'none',
            retry: 'manual-only',
        },
        mcp_run_safe_validation_suite: {
            effect: 'bounded-write',
            idempotency: 'non-idempotent',
            callerScope: 'validate',
            execution: {
                cancellation: 'cancellable',
                drainTimeoutMs: 15000,
                rationale:
                    'OperationContext.signal reaches the owned cancellable/acceptance boundary; after abort the handler must settle only after owned call-scoped work is terminal.',
            },
            output: 'intentional-untyped',
            network: 'local',
            credentials: ['none'],
            externalSideEffects: 'none',
            retry: 'manual-only',
        },
        run_project_doctor: {
            effect: 'none',
            idempotency: 'idempotent',
            callerScope: 'validate',
            execution: {
                cancellation: 'cancellable',
                drainTimeoutMs: 15000,
                rationale:
                    'OperationContext.signal reaches the owned cancellable/acceptance boundary; after abort the handler must settle only after owned call-scoped work is terminal.',
            },
            output: 'intentional-untyped',
            network: 'local',
            credentials: ['none'],
            externalSideEffects: 'none',
            retry: 'safe',
        },
        run_copilot_validator: {
            effect: 'bounded-write',
            idempotency: 'non-idempotent',
            callerScope: 'validate',
            execution: {
                cancellation: 'cancellable',
                drainTimeoutMs: 15000,
                rationale:
                    'OperationContext.signal reaches the owned cancellable/acceptance boundary; after abort the handler must settle only after owned call-scoped work is terminal.',
            },
            output: 'intentional-untyped',
            network: 'local',
            credentials: ['none'],
            externalSideEffects: 'none',
            retry: 'manual-only',
        },
        job_list: {
            effect: 'none',
            idempotency: 'idempotent',
            callerScope: 'read',
            execution: {
                cancellation: 'bounded-non-cancellable',
                continuationBoundMs: 120000,
                rationale:
                    'Current implementation is locally/input bounded but does not yet prove end-to-end cooperative cancellation; bounded work may settle after the registry reports cancellation.',
            },
            output: 'intentional-untyped',
            network: 'local',
            credentials: ['none'],
            externalSideEffects: 'none',
            retry: 'safe',
        },
        mcp_last_validation_summary: {
            effect: 'none',
            idempotency: 'idempotent',
            callerScope: 'validate',
            execution: {
                cancellation: 'bounded-non-cancellable',
                continuationBoundMs: 120000,
                rationale:
                    'Current implementation is locally/input bounded but does not yet prove end-to-end cooperative cancellation; bounded work may settle after the registry reports cancellation.',
            },
            output: 'intentional-untyped',
            network: 'local',
            credentials: ['none'],
            externalSideEffects: 'none',
            retry: 'safe',
        },
        mcp_validation_dashboard: {
            effect: 'none',
            idempotency: 'idempotent',
            callerScope: 'validate',
            execution: {
                cancellation: 'bounded-non-cancellable',
                continuationBoundMs: 120000,
                rationale:
                    'Current implementation is locally/input bounded but does not yet prove end-to-end cooperative cancellation; bounded work may settle after the registry reports cancellation.',
            },
            output: 'intentional-untyped',
            network: 'local',
            credentials: ['none'],
            externalSideEffects: 'none',
            retry: 'safe',
        },
        job_get_summary: {
            effect: 'none',
            idempotency: 'idempotent',
            callerScope: 'read',
            execution: {
                cancellation: 'bounded-non-cancellable',
                continuationBoundMs: 120000,
                rationale:
                    'Current implementation is locally/input bounded but does not yet prove end-to-end cooperative cancellation; bounded work may settle after the registry reports cancellation.',
            },
            output: 'intentional-untyped',
            network: 'local',
            credentials: ['none'],
            externalSideEffects: 'none',
            retry: 'safe',
        },
        job_get_output: {
            effect: 'none',
            idempotency: 'idempotent',
            callerScope: 'read',
            execution: {
                cancellation: 'bounded-non-cancellable',
                continuationBoundMs: 120000,
                rationale:
                    'Current implementation is locally/input bounded but does not yet prove end-to-end cooperative cancellation; bounded work may settle after the registry reports cancellation.',
            },
            output: 'intentional-untyped',
            network: 'local',
            credentials: ['none'],
            externalSideEffects: 'none',
            retry: 'safe',
        },
        job_cancel: {
            effect: 'bounded-write',
            idempotency: 'non-idempotent',
            callerScope: 'admin',
            execution: {
                cancellation: 'bounded-non-cancellable',
                continuationBoundMs: 3600000,
                rationale:
                    'Mutation is governed by its application contract, but cancellation is not yet proven across every transactional/recovery phase; late completion remains explicit migration debt.',
            },
            output: 'intentional-untyped',
            network: 'local',
            credentials: ['none'],
            externalSideEffects: 'none',
            retry: 'manual-only',
        },
        llmb_live_readiness: {
            effect: 'none',
            idempotency: 'idempotent',
            callerScope: 'read',
            execution: {
                cancellation: 'cancellable',
                drainTimeoutMs: 15000,
                rationale:
                    'Fresh readiness runs in one call-scoped subprocess. Caller abort terminates its process group with immediate SIGKILL escalation and the handler settles only after child close, so synchronous SQLite work and nested redaction Workers cannot outlive the invocation.',
            },
            output: 'intentional-untyped',
            network: 'local',
            credentials: ['none'],
            externalSideEffects: 'none',
            retry: 'safe',
        },
        llmb_live_runs: {
            effect: 'none',
            idempotency: 'idempotent',
            callerScope: 'read',
            execution: {
                cancellation: 'cancellable',
                drainTimeoutMs: 15000,
                rationale:
                    'OperationContext.signal reaches the owned cancellable/acceptance boundary; after abort the handler must settle only after owned call-scoped work is terminal.',
            },
            output: 'intentional-untyped',
            network: 'local',
            credentials: ['none'],
            externalSideEffects: 'none',
            retry: 'safe',
        },
        llmb_live_test_cancel: {
            effect: 'destructive',
            idempotency: 'non-idempotent',
            callerScope: 'admin',
            execution: {
                cancellation: 'bounded-non-cancellable',
                continuationBoundMs: 3600000,
                rationale:
                    'Mutation is governed by its application contract, but cancellation is not yet proven across every transactional/recovery phase; late completion remains explicit migration debt.',
            },
            output: 'intentional-untyped',
            network: 'local',
            credentials: ['none'],
            externalSideEffects: 'none',
            retry: 'manual-only',
        },
        llmb_live_test_plan: {
            effect: 'none',
            idempotency: 'idempotent',
            callerScope: 'read',
            execution: {
                cancellation: 'not-applicable',
                rationale:
                    'The operation does not claim caller-owned long-running work for which cooperative drain is a meaningful lifecycle promise.',
            },
            output: 'intentional-untyped',
            network: 'local',
            credentials: ['none'],
            externalSideEffects: 'none',
            retry: 'safe',
        },
        llmb_live_test_run: {
            effect: 'bounded-write',
            idempotency: 'non-idempotent',
            callerScope: 'write',
            execution: {
                cancellation: 'cancellable',
                drainTimeoutMs: 15000,
                rationale:
                    'OperationContext.signal reaches the owned cancellable/acceptance boundary; after abort the handler must settle only after owned call-scoped work is terminal.',
            },
            output: 'intentional-untyped',
            network: 'open-world',
            credentials: ['model-provider'],
            externalSideEffects: 'guarded',
            retry: 'manual-only',
        },
        mcp_client_latency_evidence: {
            effect: 'bounded-write',
            idempotency: 'non-idempotent',
            callerScope: 'write',
            execution: {
                cancellation: 'bounded-non-cancellable',
                continuationBoundMs: 300000,
                rationale:
                    'Current external/network path has explicit request/input bounds but does not yet prove cooperative cancellation across every remote primitive.',
            },
            output: 'intentional-untyped',
            network: 'local',
            credentials: ['none'],
            externalSideEffects: 'none',
            retry: 'manual-only',
        },
        mcp_latency_attribution: {
            effect: 'none',
            idempotency: 'idempotent',
            callerScope: 'read',
            execution: {
                cancellation: 'bounded-non-cancellable',
                continuationBoundMs: 300000,
                rationale:
                    'Current external/network path has explicit request/input bounds but does not yet prove cooperative cancellation across every remote primitive.',
            },
            output: 'intentional-untyped',
            network: 'open-world',
            credentials: ['cloudflare-api'],
            externalSideEffects: 'none',
            retry: 'safe',
        },
        mcp_latency_dashboard: {
            effect: 'none',
            idempotency: 'idempotent',
            callerScope: 'read',
            execution: {
                cancellation: 'bounded-non-cancellable',
                continuationBoundMs: 300000,
                rationale:
                    'Current external/network path has explicit request/input bounds but does not yet prove cooperative cancellation across every remote primitive.',
            },
            output: 'intentional-untyped',
            network: 'local',
            credentials: ['none'],
            externalSideEffects: 'none',
            retry: 'safe',
        },
        mcp_latency_pulse: {
            effect: 'none',
            idempotency: 'idempotent',
            callerScope: 'read',
            execution: {
                cancellation: 'bounded-non-cancellable',
                continuationBoundMs: 300000,
                rationale:
                    'Current external/network path has explicit request/input bounds but does not yet prove cooperative cancellation across every remote primitive.',
            },
            output: 'intentional-untyped',
            network: 'local',
            credentials: ['none'],
            externalSideEffects: 'none',
            retry: 'safe',
        },
        mcp_openai_endpoint_latency: {
            effect: 'bounded-write',
            idempotency: 'non-idempotent',
            callerScope: 'write',
            execution: {
                cancellation: 'bounded-non-cancellable',
                continuationBoundMs: 300000,
                rationale:
                    'Current external/network path has explicit request/input bounds but does not yet prove cooperative cancellation across every remote primitive.',
            },
            output: 'intentional-untyped',
            network: 'open-world',
            credentials: ['none'],
            externalSideEffects: 'none',
            retry: 'manual-only',
        },
        mcp_round_trip_analytics: {
            effect: 'bounded-write',
            idempotency: 'non-idempotent',
            callerScope: 'write',
            execution: {
                cancellation: 'bounded-non-cancellable',
                continuationBoundMs: 120000,
                rationale:
                    'Current implementation is locally/input bounded but does not yet prove end-to-end cooperative cancellation; bounded work may settle after the registry reports cancellation.',
            },
            output: 'intentional-untyped',
            network: 'local',
            credentials: ['none'],
            externalSideEffects: 'none',
            retry: 'manual-only',
        },
        mcp_tool_payload_audit: {
            effect: 'none',
            idempotency: 'idempotent',
            callerScope: 'read',
            execution: {
                cancellation: 'not-applicable',
                rationale:
                    'The operation does not claim caller-owned long-running work for which cooperative drain is a meaningful lifecycle promise.',
            },
            output: 'intentional-untyped',
            network: 'local',
            credentials: ['none'],
            externalSideEffects: 'none',
            retry: 'safe',
        },
        mcp_dependency_outdated: {
            effect: 'none',
            idempotency: 'idempotent',
            callerScope: 'read',
            execution: {
                cancellation: 'cancellable',
                drainTimeoutMs: 15000,
                rationale:
                    'OperationContext.signal reaches the owned cancellable/acceptance boundary; after abort the handler must settle only after owned call-scoped work is terminal.',
            },
            output: 'intentional-untyped',
            network: 'open-world',
            credentials: ['package-registry'],
            externalSideEffects: 'none',
            retry: 'safe',
        },
        mcp_dependency_upgrade: {
            effect: 'bounded-write',
            idempotency: 'non-idempotent',
            callerScope: 'write',
            execution: {
                cancellation: 'cancellable',
                drainTimeoutMs: 15000,
                rationale:
                    'OperationContext.signal reaches the owned cancellable/acceptance boundary; after abort the handler must settle only after owned call-scoped work is terminal.',
            },
            output: 'intentional-untyped',
            network: 'open-world',
            credentials: ['package-registry'],
            externalSideEffects: 'none',
            retry: 'manual-only',
        },
        mcp_cleanup_ai_artifacts: {
            effect: 'destructive',
            idempotency: 'non-idempotent',
            callerScope: 'admin',
            execution: {
                cancellation: 'bounded-non-cancellable',
                continuationBoundMs: 3600000,
                rationale:
                    'Mutation is governed by its application contract, but cancellation is not yet proven across every transactional/recovery phase; late completion remains explicit migration debt.',
            },
            output: 'intentional-untyped',
            network: 'local',
            credentials: ['none'],
            externalSideEffects: 'none',
            retry: 'manual-only',
        },
        mcp_maintenance_plan: {
            effect: 'none',
            idempotency: 'idempotent',
            callerScope: 'read',
            execution: {
                cancellation: 'not-applicable',
                rationale:
                    'The operation does not claim caller-owned long-running work for which cooperative drain is a meaningful lifecycle promise.',
            },
            output: 'intentional-untyped',
            network: 'local',
            credentials: ['none'],
            externalSideEffects: 'none',
            retry: 'safe',
        },
        mcp_maintenance_apply_safe_fixes: {
            effect: 'bounded-write',
            idempotency: 'non-idempotent',
            callerScope: 'write',
            execution: {
                cancellation: 'bounded-non-cancellable',
                continuationBoundMs: 3600000,
                rationale:
                    'Mutation is governed by its application contract, but cancellation is not yet proven across every transactional/recovery phase; late completion remains explicit migration debt.',
            },
            output: 'intentional-untyped',
            network: 'local',
            credentials: ['none'],
            externalSideEffects: 'none',
            retry: 'manual-only',
        },
        terminal_exec: {
            effect: 'destructive',
            idempotency: 'non-idempotent',
            callerScope: 'admin',
            execution: {
                cancellation: 'cancellable',
                drainTimeoutMs: 15000,
                rationale:
                    'OperationContext.signal reaches the owned cancellable/acceptance boundary; after abort the handler must settle only after owned call-scoped work is terminal.',
            },
            output: 'specific',
            maxResultBytes: 41943040,
            network: 'open-world',
            credentials: ['none'],
            externalSideEffects: 'possible',
            retry: 'manual-only',
        },
        terminal_session_control: {
            effect: 'destructive',
            idempotency: 'non-idempotent',
            callerScope: 'admin',
            execution: {
                cancellation: 'bounded-non-cancellable',
                continuationBoundMs: 3600000,
                rationale:
                    'Mutation is governed by its application contract, but cancellation is not yet proven across every transactional/recovery phase; late completion remains explicit migration debt.',
            },
            output: 'specific',
            network: 'open-world',
            credentials: ['none'],
            externalSideEffects: 'possible',
            retry: 'manual-only',
        },
        terminal_session_read: {
            effect: 'none',
            idempotency: 'idempotent',
            callerScope: 'read',
            execution: {
                cancellation: 'not-applicable',
                rationale:
                    'The operation does not claim caller-owned long-running work for which cooperative drain is a meaningful lifecycle promise.',
            },
            output: 'specific',
            maxResultBytes: 12582912,
            network: 'local',
            credentials: ['none'],
            externalSideEffects: 'none',
            retry: 'safe',
        },
        delegate_to_repo_autonomy_runner: {
            effect: 'bounded-write',
            idempotency: 'non-idempotent',
            callerScope: 'write',
            execution: {
                cancellation: 'cancellable',
                drainTimeoutMs: 15000,
                rationale:
                    'OperationContext.signal reaches the owned cancellable/acceptance boundary; after abort the handler must settle only after owned call-scoped work is terminal.',
            },
            output: 'intentional-untyped',
            network: 'local',
            credentials: ['none'],
            externalSideEffects: 'none',
            retry: 'manual-only',
        },
        mcp_golden_prompts: {
            effect: 'none',
            idempotency: 'idempotent',
            callerScope: 'read',
            execution: {
                cancellation: 'bounded-non-cancellable',
                continuationBoundMs: 120000,
                rationale:
                    'Current implementation is locally/input bounded but does not yet prove end-to-end cooperative cancellation; bounded work may settle after the registry reports cancellation.',
            },
            output: 'intentional-untyped',
            network: 'local',
            credentials: ['none'],
            externalSideEffects: 'none',
            retry: 'safe',
        },
        mcp_apps_sdk_readiness: {
            effect: 'none',
            idempotency: 'idempotent',
            callerScope: 'read',
            execution: {
                cancellation: 'bounded-non-cancellable',
                continuationBoundMs: 300000,
                rationale:
                    'Current external/network path has explicit request/input bounds but does not yet prove cooperative cancellation across every remote primitive.',
            },
            output: 'intentional-untyped',
            network: 'local',
            credentials: ['none'],
            externalSideEffects: 'none',
            retry: 'safe',
        },
        search: {
            effect: 'none',
            idempotency: 'idempotent',
            callerScope: 'read',
            execution: {
                cancellation: 'bounded-non-cancellable',
                continuationBoundMs: 300000,
                rationale:
                    'Current external/network path has explicit request/input bounds but does not yet prove cooperative cancellation across every remote primitive.',
            },
            output: 'specific',
            network: 'local',
            credentials: ['none'],
            externalSideEffects: 'none',
            retry: 'safe',
        },
        fetch: {
            effect: 'none',
            idempotency: 'idempotent',
            callerScope: 'read',
            execution: {
                cancellation: 'bounded-non-cancellable',
                continuationBoundMs: 300000,
                rationale:
                    'Current external/network path has explicit request/input bounds but does not yet prove cooperative cancellation across every remote primitive.',
            },
            output: 'specific',
            network: 'local',
            credentials: ['none'],
            externalSideEffects: 'none',
            retry: 'safe',
        },
        mcp_devcontainer_network_posture_audit: {
            effect: 'none',
            idempotency: 'idempotent',
            callerScope: 'read',
            execution: {
                cancellation: 'bounded-non-cancellable',
                continuationBoundMs: 120000,
                rationale:
                    'Current implementation is locally/input bounded but does not yet prove end-to-end cooperative cancellation; bounded work may settle after the registry reports cancellation.',
            },
            output: 'intentional-untyped',
            network: 'local',
            credentials: ['none'],
            externalSideEffects: 'none',
            retry: 'safe',
        },
        mcp_devcontainer_network_control_plane_refresh: {
            effect: 'bounded-write',
            idempotency: 'non-idempotent',
            callerScope: 'write',
            execution: {
                cancellation: 'cancellable',
                drainTimeoutMs: 15000,
                rationale:
                    'OperationContext.signal reaches the owned cancellable/acceptance boundary; after abort the handler must settle only after owned call-scoped work is terminal.',
            },
            output: 'intentional-untyped',
            network: 'local',
            credentials: ['none'],
            externalSideEffects: 'none',
            retry: 'manual-only',
        },
        mcp_cloudflare_config_audit: {
            effect: 'none',
            idempotency: 'idempotent',
            callerScope: 'read',
            execution: {
                cancellation: 'bounded-non-cancellable',
                continuationBoundMs: 300000,
                rationale:
                    'Current external/network path has explicit request/input bounds but does not yet prove cooperative cancellation across every remote primitive.',
            },
            output: 'intentional-untyped',
            network: 'fixed-external',
            credentials: ['cloudflare-api'],
            externalSideEffects: 'none',
            retry: 'safe',
        },
        mcp_cloudflare_plan_capabilities_audit: {
            effect: 'none',
            idempotency: 'idempotent',
            callerScope: 'read',
            execution: {
                cancellation: 'bounded-non-cancellable',
                continuationBoundMs: 300000,
                rationale:
                    'Current external/network path has explicit request/input bounds but does not yet prove cooperative cancellation across every remote primitive.',
            },
            output: 'intentional-untyped',
            network: 'fixed-external',
            credentials: ['cloudflare-api'],
            externalSideEffects: 'none',
            retry: 'safe',
        },
        mcp_cloudflare_edge_backup_create: {
            effect: 'bounded-write',
            idempotency: 'non-idempotent',
            callerScope: 'admin',
            execution: {
                cancellation: 'bounded-non-cancellable',
                continuationBoundMs: 3600000,
                rationale:
                    'Mutation is governed by its application contract, but cancellation is not yet proven across every transactional/recovery phase; late completion remains explicit migration debt.',
            },
            output: 'intentional-untyped',
            network: 'fixed-external',
            credentials: ['cloudflare-api'],
            externalSideEffects: 'none',
            retry: 'manual-only',
        },
        mcp_cloudflare_edge_backups_list: {
            effect: 'none',
            idempotency: 'idempotent',
            callerScope: 'read',
            execution: {
                cancellation: 'bounded-non-cancellable',
                continuationBoundMs: 300000,
                rationale:
                    'Current external/network path has explicit request/input bounds but does not yet prove cooperative cancellation across every remote primitive.',
            },
            output: 'intentional-untyped',
            network: 'local',
            credentials: ['none'],
            externalSideEffects: 'none',
            retry: 'safe',
        },
        mcp_cloudflare_edge_audit: {
            effect: 'none',
            idempotency: 'idempotent',
            callerScope: 'read',
            execution: {
                cancellation: 'bounded-non-cancellable',
                continuationBoundMs: 300000,
                rationale:
                    'Current external/network path has explicit request/input bounds but does not yet prove cooperative cancellation across every remote primitive.',
            },
            output: 'intentional-untyped',
            network: 'fixed-external',
            credentials: ['cloudflare-api'],
            externalSideEffects: 'none',
            retry: 'safe',
        },
        mcp_cloudflare_edge_policy_apply: {
            effect: 'bounded-write',
            idempotency: 'non-idempotent',
            callerScope: 'admin',
            execution: {
                cancellation: 'bounded-non-cancellable',
                continuationBoundMs: 3600000,
                rationale:
                    'Mutation is governed by its application contract, but cancellation is not yet proven across every transactional/recovery phase; late completion remains explicit migration debt.',
            },
            output: 'intentional-untyped',
            network: 'fixed-external',
            credentials: ['cloudflare-api'],
            externalSideEffects: 'guarded',
            retry: 'manual-only',
        },
        mcp_cloudflare_edge_policy_diff: {
            effect: 'none',
            idempotency: 'idempotent',
            callerScope: 'read',
            execution: {
                cancellation: 'bounded-non-cancellable',
                continuationBoundMs: 300000,
                rationale:
                    'Current external/network path has explicit request/input bounds but does not yet prove cooperative cancellation across every remote primitive.',
            },
            output: 'intentional-untyped',
            network: 'fixed-external',
            credentials: ['cloudflare-api'],
            externalSideEffects: 'none',
            retry: 'safe',
        },
        mcp_cloudflare_edge_policy_plan: {
            effect: 'none',
            idempotency: 'idempotent',
            callerScope: 'read',
            execution: {
                cancellation: 'bounded-non-cancellable',
                continuationBoundMs: 300000,
                rationale:
                    'Current external/network path has explicit request/input bounds but does not yet prove cooperative cancellation across every remote primitive.',
            },
            output: 'intentional-untyped',
            network: 'fixed-external',
            credentials: ['cloudflare-api'],
            externalSideEffects: 'none',
            retry: 'safe',
        },
        mcp_cloudflare_edge_snapshot: {
            effect: 'none',
            idempotency: 'idempotent',
            callerScope: 'read',
            execution: {
                cancellation: 'bounded-non-cancellable',
                continuationBoundMs: 300000,
                rationale:
                    'Current external/network path has explicit request/input bounds but does not yet prove cooperative cancellation across every remote primitive.',
            },
            output: 'intentional-untyped',
            network: 'fixed-external',
            credentials: ['cloudflare-api'],
            externalSideEffects: 'none',
            retry: 'safe',
        },
        mcp_cloudflare_metrics_snapshot: {
            effect: 'none',
            idempotency: 'idempotent',
            callerScope: 'read',
            execution: {
                cancellation: 'bounded-non-cancellable',
                continuationBoundMs: 300000,
                rationale:
                    'Current external/network path has explicit request/input bounds but does not yet prove cooperative cancellation across every remote primitive.',
            },
            output: 'intentional-untyped',
            network: 'local',
            credentials: ['none'],
            externalSideEffects: 'none',
            retry: 'safe',
        },
        mcp_cloudflare_post_change_gates: {
            effect: 'none',
            idempotency: 'idempotent',
            callerScope: 'read',
            execution: {
                cancellation: 'bounded-non-cancellable',
                continuationBoundMs: 300000,
                rationale:
                    'Current external/network path has explicit request/input bounds but does not yet prove cooperative cancellation across every remote primitive.',
            },
            output: 'intentional-untyped',
            network: 'fixed-external',
            credentials: ['cloudflare-api'],
            externalSideEffects: 'none',
            retry: 'safe',
        },
        mcp_cloudflare_transport_benchmark_plan: {
            effect: 'none',
            idempotency: 'idempotent',
            callerScope: 'read',
            execution: {
                cancellation: 'bounded-non-cancellable',
                continuationBoundMs: 300000,
                rationale:
                    'Current external/network path has explicit request/input bounds but does not yet prove cooperative cancellation across every remote primitive.',
            },
            output: 'intentional-untyped',
            network: 'local',
            credentials: ['none'],
            externalSideEffects: 'none',
            retry: 'safe',
        },
        mcp_host_block_diagnostics: {
            effect: 'none',
            idempotency: 'idempotent',
            callerScope: 'read',
            execution: {
                cancellation: 'bounded-non-cancellable',
                continuationBoundMs: 300000,
                rationale:
                    'Current external/network path has explicit request/input bounds but does not yet prove cooperative cancellation across every remote primitive.',
            },
            output: 'intentional-untyped',
            network: 'local',
            credentials: ['none'],
            externalSideEffects: 'none',
            retry: 'safe',
        },
        chatgpt_connector_profile: {
            effect: 'none',
            idempotency: 'idempotent',
            callerScope: 'read',
            execution: {
                cancellation: 'bounded-non-cancellable',
                continuationBoundMs: 300000,
                rationale:
                    'Current external/network path has explicit request/input bounds but does not yet prove cooperative cancellation across every remote primitive.',
            },
            output: 'intentional-untyped',
            network: 'local',
            credentials: ['none'],
            externalSideEffects: 'none',
            retry: 'safe',
        },
        claude_connector_profile: {
            effect: 'none',
            idempotency: 'idempotent',
            callerScope: 'read',
            execution: {
                cancellation: 'bounded-non-cancellable',
                continuationBoundMs: 300000,
                rationale:
                    'Current external/network path has explicit request/input bounds but does not yet prove cooperative cancellation across every remote primitive.',
            },
            output: 'intentional-untyped',
            network: 'local',
            credentials: ['none'],
            externalSideEffects: 'none',
            retry: 'safe',
        },
        chatgpt_connector_url_check: {
            effect: 'none',
            idempotency: 'idempotent',
            callerScope: 'read',
            execution: {
                cancellation: 'bounded-non-cancellable',
                continuationBoundMs: 300000,
                rationale:
                    'Current external/network path has explicit request/input bounds but does not yet prove cooperative cancellation across every remote primitive.',
            },
            output: 'intentional-untyped',
            network: 'fixed-external',
            credentials: ['none'],
            externalSideEffects: 'none',
            retry: 'safe',
        },
        chatgpt_connector_current_url_status: {
            effect: 'none',
            idempotency: 'idempotent',
            callerScope: 'read',
            execution: {
                cancellation: 'bounded-non-cancellable',
                continuationBoundMs: 300000,
                rationale:
                    'Current external/network path has explicit request/input bounds but does not yet prove cooperative cancellation across every remote primitive.',
            },
            output: 'intentional-untyped',
            network: 'fixed-external',
            credentials: ['none'],
            externalSideEffects: 'none',
            retry: 'safe',
        },
        mcp_auth_profile: {
            effect: 'none',
            idempotency: 'idempotent',
            callerScope: 'read',
            execution: {
                cancellation: 'not-applicable',
                rationale:
                    'The operation does not claim caller-owned long-running work for which cooperative drain is a meaningful lifecycle promise.',
            },
            output: 'intentional-untyped',
            network: 'local',
            credentials: ['none'],
            externalSideEffects: 'none',
            retry: 'safe',
        },
        mcp_oauth_issuer_diagnostics: {
            effect: 'none',
            idempotency: 'idempotent',
            callerScope: 'read',
            execution: {
                cancellation: 'bounded-non-cancellable',
                continuationBoundMs: 300000,
                rationale:
                    'Current external/network path has explicit request/input bounds but does not yet prove cooperative cancellation across every remote primitive.',
            },
            output: 'intentional-untyped',
            network: 'fixed-external',
            credentials: ['none'],
            externalSideEffects: 'none',
            retry: 'safe',
        },
        mcp_connection_readiness: {
            effect: 'none',
            idempotency: 'idempotent',
            callerScope: 'read',
            execution: {
                cancellation: 'bounded-non-cancellable',
                continuationBoundMs: 300000,
                rationale:
                    'Current external/network path has explicit request/input bounds but does not yet prove cooperative cancellation across every remote primitive.',
            },
            output: 'intentional-untyped',
            network: 'fixed-external',
            credentials: ['none'],
            externalSideEffects: 'none',
            retry: 'safe',
        },
        mcp_cloudflare_remote_audit: {
            effect: 'none',
            idempotency: 'idempotent',
            callerScope: 'read',
            execution: {
                cancellation: 'bounded-non-cancellable',
                continuationBoundMs: 300000,
                rationale:
                    'Current external/network path has explicit request/input bounds but does not yet prove cooperative cancellation across every remote primitive.',
            },
            output: 'intentional-untyped',
            network: 'fixed-external',
            credentials: ['cloudflare-api'],
            externalSideEffects: 'none',
            retry: 'safe',
        },
        mcp_cloudflare_skip_audit: {
            effect: 'none',
            idempotency: 'idempotent',
            callerScope: 'read',
            execution: {
                cancellation: 'bounded-non-cancellable',
                continuationBoundMs: 300000,
                rationale:
                    'Current external/network path has explicit request/input bounds but does not yet prove cooperative cancellation across every remote primitive.',
            },
            output: 'intentional-untyped',
            network: 'fixed-external',
            credentials: ['cloudflare-api'],
            externalSideEffects: 'none',
            retry: 'safe',
        },
        mcp_cloudflare_mcp_passthrough_plan: {
            effect: 'none',
            idempotency: 'idempotent',
            callerScope: 'read',
            execution: {
                cancellation: 'bounded-non-cancellable',
                continuationBoundMs: 300000,
                rationale:
                    'Current external/network path has explicit request/input bounds but does not yet prove cooperative cancellation across every remote primitive.',
            },
            output: 'intentional-untyped',
            network: 'fixed-external',
            credentials: ['cloudflare-api'],
            externalSideEffects: 'none',
            retry: 'safe',
        },
        mcp_cloudflare_mcp_passthrough_diff: {
            effect: 'none',
            idempotency: 'idempotent',
            callerScope: 'read',
            execution: {
                cancellation: 'bounded-non-cancellable',
                continuationBoundMs: 300000,
                rationale:
                    'Current external/network path has explicit request/input bounds but does not yet prove cooperative cancellation across every remote primitive.',
            },
            output: 'intentional-untyped',
            network: 'fixed-external',
            credentials: ['cloudflare-api'],
            externalSideEffects: 'none',
            retry: 'safe',
        },
        mcp_cloudflare_mcp_passthrough_apply: {
            effect: 'bounded-write',
            idempotency: 'non-idempotent',
            callerScope: 'admin',
            execution: {
                cancellation: 'bounded-non-cancellable',
                continuationBoundMs: 3600000,
                rationale:
                    'Mutation is governed by its application contract, but cancellation is not yet proven across every transactional/recovery phase; late completion remains explicit migration debt.',
            },
            output: 'intentional-untyped',
            network: 'fixed-external',
            credentials: ['cloudflare-api'],
            externalSideEffects: 'guarded',
            retry: 'manual-only',
        },
        repo_patch_batch_plan: {
            effect: 'none',
            idempotency: 'idempotent',
            callerScope: 'read',
            execution: {
                cancellation: 'bounded-non-cancellable',
                continuationBoundMs: 120000,
                rationale:
                    'Current implementation is locally/input bounded but does not yet prove end-to-end cooperative cancellation; bounded work may settle after the registry reports cancellation.',
            },
            output: 'intentional-untyped',
            network: 'local',
            credentials: ['none'],
            externalSideEffects: 'none',
            retry: 'safe',
        },
        repo_apply_patch_batch: {
            effect: 'bounded-write',
            idempotency: 'non-idempotent',
            callerScope: 'write',
            execution: {
                cancellation: 'bounded-non-cancellable',
                continuationBoundMs: 3600000,
                rationale:
                    'Mutation is governed by its application contract, but cancellation is not yet proven across every transactional/recovery phase; late completion remains explicit migration debt.',
            },
            output: 'intentional-untyped',
            network: 'local',
            credentials: ['none'],
            externalSideEffects: 'none',
            retry: 'manual-only',
        },
        repo_apply_file_batch_plan: {
            effect: 'none',
            idempotency: 'idempotent',
            callerScope: 'read',
            execution: {
                cancellation: 'bounded-non-cancellable',
                continuationBoundMs: 3600000,
                rationale:
                    'Mutation is governed by its application contract, but cancellation is not yet proven across every transactional/recovery phase; late completion remains explicit migration debt.',
            },
            output: 'intentional-untyped',
            network: 'local',
            credentials: ['none'],
            externalSideEffects: 'none',
            retry: 'safe',
        },
        repo_apply_file_batch: {
            effect: 'destructive',
            idempotency: 'non-idempotent',
            callerScope: 'admin',
            execution: {
                cancellation: 'bounded-non-cancellable',
                continuationBoundMs: 3600000,
                rationale:
                    'Mutation is governed by its application contract, but cancellation is not yet proven across every transactional/recovery phase; late completion remains explicit migration debt.',
            },
            output: 'intentional-untyped',
            network: 'local',
            credentials: ['none'],
            externalSideEffects: 'none',
            retry: 'manual-only',
        },
        repo_write_file: {
            effect: 'bounded-write',
            idempotency: 'non-idempotent',
            callerScope: 'write',
            execution: {
                cancellation: 'bounded-non-cancellable',
                continuationBoundMs: 3600000,
                rationale:
                    'Mutation is governed by its application contract, but cancellation is not yet proven across every transactional/recovery phase; late completion remains explicit migration debt.',
            },
            output: 'intentional-untyped',
            network: 'local',
            credentials: ['none'],
            externalSideEffects: 'none',
            retry: 'manual-only',
        },
        repo_create_file: {
            effect: 'bounded-write',
            idempotency: 'non-idempotent',
            callerScope: 'write',
            execution: {
                cancellation: 'bounded-non-cancellable',
                continuationBoundMs: 3600000,
                rationale:
                    'Mutation is governed by its application contract, but cancellation is not yet proven across every transactional/recovery phase; late completion remains explicit migration debt.',
            },
            output: 'intentional-untyped',
            network: 'local',
            credentials: ['none'],
            externalSideEffects: 'none',
            retry: 'manual-only',
        },
        repo_apply_patch: {
            effect: 'bounded-write',
            idempotency: 'non-idempotent',
            callerScope: 'write',
            execution: {
                cancellation: 'bounded-non-cancellable',
                continuationBoundMs: 3600000,
                rationale:
                    'Mutation is governed by its application contract, but cancellation is not yet proven across every transactional/recovery phase; late completion remains explicit migration debt.',
            },
            output: 'intentional-untyped',
            network: 'local',
            credentials: ['none'],
            externalSideEffects: 'none',
            retry: 'manual-only',
        },
        repo_move_file: {
            effect: 'bounded-write',
            idempotency: 'non-idempotent',
            callerScope: 'write',
            execution: {
                cancellation: 'bounded-non-cancellable',
                continuationBoundMs: 3600000,
                rationale:
                    'Mutation is governed by its application contract, but cancellation is not yet proven across every transactional/recovery phase; late completion remains explicit migration debt.',
            },
            output: 'intentional-untyped',
            network: 'local',
            credentials: ['none'],
            externalSideEffects: 'none',
            retry: 'manual-only',
        },
        repo_list_quarantine: {
            effect: 'none',
            idempotency: 'idempotent',
            callerScope: 'read',
            execution: {
                cancellation: 'bounded-non-cancellable',
                continuationBoundMs: 3600000,
                rationale:
                    'Mutation is governed by its application contract, but cancellation is not yet proven across every transactional/recovery phase; late completion remains explicit migration debt.',
            },
            output: 'intentional-untyped',
            network: 'local',
            credentials: ['none'],
            externalSideEffects: 'none',
            retry: 'safe',
        },
        repo_inspect_quarantined_file: {
            effect: 'none',
            idempotency: 'idempotent',
            callerScope: 'read',
            execution: {
                cancellation: 'bounded-non-cancellable',
                continuationBoundMs: 3600000,
                rationale:
                    'Mutation is governed by its application contract, but cancellation is not yet proven across every transactional/recovery phase; late completion remains explicit migration debt.',
            },
            output: 'intentional-untyped',
            network: 'local',
            credentials: ['none'],
            externalSideEffects: 'none',
            retry: 'safe',
        },
        repo_quarantine_file: {
            effect: 'bounded-write',
            idempotency: 'non-idempotent',
            callerScope: 'write',
            execution: {
                cancellation: 'bounded-non-cancellable',
                continuationBoundMs: 3600000,
                rationale:
                    'Mutation is governed by its application contract, but cancellation is not yet proven across every transactional/recovery phase; late completion remains explicit migration debt.',
            },
            output: 'intentional-untyped',
            network: 'local',
            credentials: ['none'],
            externalSideEffects: 'none',
            retry: 'manual-only',
        },
        repo_restore_quarantined_file: {
            effect: 'bounded-write',
            idempotency: 'non-idempotent',
            callerScope: 'admin',
            execution: {
                cancellation: 'bounded-non-cancellable',
                continuationBoundMs: 3600000,
                rationale:
                    'Mutation is governed by its application contract, but cancellation is not yet proven across every transactional/recovery phase; late completion remains explicit migration debt.',
            },
            output: 'intentional-untyped',
            network: 'local',
            credentials: ['none'],
            externalSideEffects: 'none',
            retry: 'manual-only',
        },
        repo_remove_file: {
            effect: 'destructive',
            idempotency: 'non-idempotent',
            callerScope: 'admin',
            execution: {
                cancellation: 'bounded-non-cancellable',
                continuationBoundMs: 3600000,
                rationale:
                    'Mutation is governed by its application contract, but cancellation is not yet proven across every transactional/recovery phase; late completion remains explicit migration debt.',
            },
            output: 'intentional-untyped',
            network: 'local',
            credentials: ['none'],
            externalSideEffects: 'none',
            retry: 'manual-only',
        },
        copilot_sessions_list: {
            effect: 'none',
            idempotency: 'idempotent',
            callerScope: 'read',
            execution: {
                cancellation: 'bounded-non-cancellable',
                continuationBoundMs: 120000,
                rationale:
                    'Current implementation is locally/input bounded but does not yet prove end-to-end cooperative cancellation; bounded work may settle after the registry reports cancellation.',
            },
            output: 'intentional-untyped',
            network: 'local',
            credentials: ['none'],
            externalSideEffects: 'none',
            retry: 'safe',
        },
        copilot_session_get: {
            effect: 'none',
            idempotency: 'idempotent',
            callerScope: 'read',
            execution: {
                cancellation: 'bounded-non-cancellable',
                continuationBoundMs: 120000,
                rationale:
                    'Current implementation is locally/input bounded but does not yet prove end-to-end cooperative cancellation; bounded work may settle after the registry reports cancellation.',
            },
            output: 'intentional-untyped',
            network: 'local',
            credentials: ['none'],
            externalSideEffects: 'none',
            retry: 'safe',
        },
        mcp_capabilities_summary: {
            effect: 'none',
            idempotency: 'idempotent',
            callerScope: 'read',
            execution: {
                cancellation: 'not-applicable',
                rationale:
                    'The operation does not claim caller-owned long-running work for which cooperative drain is a meaningful lifecycle promise.',
            },
            output: 'intentional-untyped',
            network: 'local',
            credentials: ['none'],
            externalSideEffects: 'none',
            retry: 'safe',
        },
        mcp_oauth_friction_audit: {
            effect: 'none',
            idempotency: 'idempotent',
            callerScope: 'read',
            execution: {
                cancellation: 'bounded-non-cancellable',
                continuationBoundMs: 300000,
                rationale:
                    'Current external/network path has explicit request/input bounds but does not yet prove cooperative cancellation across every remote primitive.',
            },
            output: 'intentional-untyped',
            network: 'local',
            credentials: ['none'],
            externalSideEffects: 'none',
            retry: 'safe',
        },
        mcp_session_profile: {
            effect: 'none',
            idempotency: 'idempotent',
            callerScope: 'read',
            execution: {
                cancellation: 'not-applicable',
                rationale:
                    'The operation does not claim caller-owned long-running work for which cooperative drain is a meaningful lifecycle promise.',
            },
            output: 'intentional-untyped',
            network: 'local',
            credentials: ['none'],
            externalSideEffects: 'none',
            retry: 'safe',
        },
        mcp_autonomy_power_score: {
            effect: 'none',
            idempotency: 'idempotent',
            callerScope: 'read',
            execution: {
                cancellation: 'not-applicable',
                rationale:
                    'The operation does not claim caller-owned long-running work for which cooperative drain is a meaningful lifecycle promise.',
            },
            output: 'intentional-untyped',
            network: 'local',
            credentials: ['none'],
            externalSideEffects: 'none',
            retry: 'safe',
        },
        mcp_tools_status: {
            effect: 'none',
            idempotency: 'idempotent',
            callerScope: 'read',
            execution: {
                cancellation: 'not-applicable',
                rationale:
                    'The operation does not claim caller-owned long-running work for which cooperative drain is a meaningful lifecycle promise.',
            },
            output: 'intentional-untyped',
            network: 'local',
            credentials: ['none'],
            externalSideEffects: 'none',
            retry: 'safe',
        },
        mcp_smoke_workspace: {
            effect: 'none',
            idempotency: 'idempotent',
            callerScope: 'read',
            execution: {
                cancellation: 'cancellable',
                drainTimeoutMs: 15000,
                rationale:
                    'OperationContext.signal reaches the owned cancellable/acceptance boundary; after abort the handler must settle only after owned call-scoped work is terminal.',
            },
            output: 'intentional-untyped',
            network: 'local',
            credentials: ['none'],
            externalSideEffects: 'none',
            retry: 'safe',
        },
        mcp_tunnel_status: {
            effect: 'none',
            idempotency: 'idempotent',
            callerScope: 'read',
            execution: {
                cancellation: 'bounded-non-cancellable',
                continuationBoundMs: 300000,
                rationale:
                    'Current external/network path has explicit request/input bounds but does not yet prove cooperative cancellation across every remote primitive.',
            },
            output: 'intentional-untyped',
            network: 'local',
            credentials: ['none'],
            externalSideEffects: 'none',
            retry: 'safe',
        },
        mcp_connector_smoke_refresh: {
            effect: 'bounded-write',
            idempotency: 'non-idempotent',
            callerScope: 'write',
            execution: {
                cancellation: 'bounded-non-cancellable',
                continuationBoundMs: 300000,
                rationale:
                    'Current external/network path has explicit request/input bounds but does not yet prove cooperative cancellation across every remote primitive.',
            },
            output: 'intentional-untyped',
            network: 'fixed-external',
            credentials: ['none'],
            externalSideEffects: 'none',
            retry: 'manual-only',
        },
        mcp_post_restart_readiness: {
            effect: 'none',
            idempotency: 'idempotent',
            callerScope: 'read',
            execution: {
                cancellation: 'bounded-non-cancellable',
                continuationBoundMs: 120000,
                rationale:
                    'Current implementation is locally/input bounded but does not yet prove end-to-end cooperative cancellation; bounded work may settle after the registry reports cancellation.',
            },
            output: 'intentional-untyped',
            network: 'fixed-external',
            credentials: ['none'],
            externalSideEffects: 'none',
            retry: 'safe',
        },
        mcp_reload_plan: {
            effect: 'none',
            idempotency: 'idempotent',
            callerScope: 'read',
            execution: {
                cancellation: 'not-applicable',
                rationale:
                    'The operation does not claim caller-owned long-running work for which cooperative drain is a meaningful lifecycle promise.',
            },
            output: 'intentional-untyped',
            network: 'local',
            credentials: ['none'],
            externalSideEffects: 'none',
            retry: 'safe',
        },
        mcp_reload_status: {
            effect: 'none',
            idempotency: 'idempotent',
            callerScope: 'read',
            execution: {
                cancellation: 'not-applicable',
                rationale:
                    'The operation does not claim caller-owned long-running work for which cooperative drain is a meaningful lifecycle promise.',
            },
            output: 'intentional-untyped',
            network: 'local',
            credentials: ['none'],
            externalSideEffects: 'none',
            retry: 'safe',
        },
        mcp_reload_schedule: {
            effect: 'bounded-write',
            idempotency: 'non-idempotent',
            callerScope: 'write',
            execution: {
                cancellation: 'cancellable',
                drainTimeoutMs: 15000,
                rationale:
                    'OperationContext.signal reaches the owned cancellable/acceptance boundary; after abort the handler must settle only after owned call-scoped work is terminal.',
            },
            output: 'intentional-untyped',
            network: 'local',
            credentials: ['none'],
            externalSideEffects: 'none',
            retry: 'manual-only',
        },
        mcp_runtime_health: {
            effect: 'none',
            idempotency: 'idempotent',
            callerScope: 'read',
            execution: {
                cancellation: 'bounded-non-cancellable',
                continuationBoundMs: 120000,
                rationale:
                    'Current implementation is locally/input bounded but does not yet prove end-to-end cooperative cancellation; bounded work may settle after the registry reports cancellation.',
            },
            output: 'intentional-untyped',
            network: 'local',
            credentials: ['none'],
            externalSideEffects: 'none',
            retry: 'safe',
        },
    })
);

const SPECIFIC_OUTPUT_RATIONALE =
    'This tool publishes a stable tool-specific output schema and the registry validates the structured result against it.';
const INTENTIONAL_UNTYPED_OUTPUT_RATIONALE =
    'This tool intentionally omits a specific output schema because its diagnostic or workflow result is heterogeneous; a generic passthrough schema would be less truthful than leaving the wire schema absent.';

/**
 * @param {import('#copilot/mcp/public/protocol/catalog').McpRawToolDefinition[]} tools
 * @returns {import('#copilot/mcp/public/protocol/catalog').McpToolDefinition[]}
 */
export function attachMcpToolSemanticContracts(tools) {
    const actualNames = new Set(tools.map((tool) => tool.name));
    const declaredNames = new Set(Object.keys(CONTRACT_PROFILE_BY_TOOL));
    const missing = [...actualNames].filter((name) => !declaredNames.has(name));
    const stale = [...declaredNames].filter((name) => !actualNames.has(name));
    if (missing.length > 0 || stale.length > 0) {
        throw new Error(
            `MCP semantic contract coverage mismatch: missing=${missing.join(',') || 'none'} stale=${stale.join(',') || 'none'}`,
        );
    }
    if (actualNames.size !== tools.length)
        throw new Error('MCP semantic contracts require unique canonical tool names.');

    return tools.map((tool) => attachContract(tool));
}

/** @param {import('#copilot/mcp/public/protocol/catalog').McpRawToolDefinition} tool */
function attachContract(tool) {
    const raw = CONTRACT_PROFILE_BY_TOOL[tool.name];
    if (!raw) throw new Error(`Missing MCP semantic contract for ${tool.name}.`);
    const contract = /** @type {import('#copilot/mcp/public/protocol/catalog').McpToolContract} */ (
        Object.freeze({
            schemaVersion: 1,
            effects: Object.freeze({ mutation: raw.effect, externalSideEffects: raw.externalSideEffects }),
            authority: Object.freeze({ callerScope: raw.callerScope, network: raw.network }),
            credentials: Object.freeze([...raw.credentials]),
            idempotency: raw.idempotency,
            retry: raw.retry,
            execution: Object.freeze({ ...raw.execution }),
            resultBudget: Object.freeze(
                raw.maxResultBytes === undefined
                    ? { mode: 'registry-default' }
                    : { mode: 'tool-specific', maxBytes: raw.maxResultBytes },
            ),
            output: Object.freeze({
                class: raw.output,
                rationale: raw.output === 'specific' ? SPECIFIC_OUTPUT_RATIONALE : INTENTIONAL_UNTYPED_OUTPUT_RATIONALE,
            }),
        })
    );
    const semanticErrors = validateMcpToolContractSemantics(contract);
    if (semanticErrors.length > 0) {
        throw new Error(`Invalid MCP semantic contract for ${tool.name}: ${semanticErrors.join('; ')}`);
    }
    const annotations = projectMcpToolAnnotations(contract);
    validateRawContractProjection(tool, contract);
    return { ...tool, contract, execution: contract.execution, annotations };
}

/**
 * Raw definitions may declare wire shape/result budgets, but never risk annotations. Those raw facts must agree with
 * their semantic output/result contract before the canonical projection is created.
 *
 * @param {import('#copilot/mcp/public/protocol/catalog').McpRawToolDefinition} tool
 * @param {import('#copilot/mcp/public/protocol/catalog').McpToolContract} contract
 */
function validateRawContractProjection(tool, contract) {
    const hasSpecificOutput = tool.outputSchema !== undefined;
    if ((contract.output.class === 'specific') !== hasSpecificOutput) {
        throw new Error(`MCP output-contract drift for ${tool.name}.`);
    }
    const declaredMax = Number.isInteger(tool.maxResultBytes) ? Number(tool.maxResultBytes) : null;
    const contractMax = contract.resultBudget.mode === 'tool-specific' ? Number(contract.resultBudget.maxBytes) : null;
    if (declaredMax !== contractMax) throw new Error(`MCP result-budget drift for ${tool.name}.`);
}

export function readMcpToolContractCoverage() {
    const rows = Object.values(CONTRACT_PROFILE_BY_TOOL);
    return Object.freeze({
        total: rows.length,
        readOnly: rows.filter((row) => row.effect === 'none').length,
        boundedWrite: rows.filter((row) => row.effect === 'bounded-write').length,
        destructive: rows.filter((row) => row.effect === 'destructive').length,
        openWorld: rows.filter((row) => row.network === 'open-world').length,
        idempotent: rows.filter((row) => row.idempotency === 'idempotent').length,
        scopes: Object.freeze({
            read: rows.filter((row) => row.callerScope === 'read').length,
            write: rows.filter((row) => row.callerScope === 'write').length,
            validate: rows.filter((row) => row.callerScope === 'validate').length,
            admin: rows.filter((row) => row.callerScope === 'admin').length,
        }),
        cancellation: Object.freeze({
            cancellable: rows.filter((row) => row.execution.cancellation === 'cancellable').length,
            boundedNonCancellable: rows.filter((row) => row.execution.cancellation === 'bounded-non-cancellable')
                .length,
            notApplicable: rows.filter((row) => row.execution.cancellation === 'not-applicable').length,
        }),
        output: Object.freeze({
            specific: rows.filter((row) => row.output === 'specific').length,
            intentionalUntyped: rows.filter((row) => row.output === 'intentional-untyped').length,
        }),
    });
}

/** @param {import('#copilot/mcp/public/protocol/catalog').McpToolDefinition} tool */
export function readMcpToolSemanticRisk(tool) {
    if (!tool.contract) throw new Error(`MCP tool ${tool.name} has no semantic contract.`);
    return classifyMcpToolContractRisk(tool.contract);
}
