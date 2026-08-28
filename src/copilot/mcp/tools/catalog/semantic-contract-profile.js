// @ts-check
/**
 * Static semantic-contract profile for the canonical MCP tool catalog.
 *
 * This module intentionally owns only declarative tool facts, the semantic profile version and aggregate coverage.
 * It has no runtime/protocol imports so metadata/status consumers do not pull catalog composition or protocol projection
 * closures merely to read versioned facts.
 *
 * @module copilot/mcp/tools/catalog/semantic-contract-profile
 */

export const MCP_TOOL_CONTRACTS_VERSION = '2.10.0';

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

export const CONTRACT_PROFILE_BY_TOOL = /** @type {Readonly<Record<string, McpToolContractProfile>>} */ (
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
        mcp_validation_dashboard: {
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
                    'Both read views own cancellable call-scoped subprocess work. Fresh readiness uses immediate SIGKILL escalation after abort so synchronous SQLite/redaction work cannot outlive the call; runs uses the fixed read-only runs command and also settles only after owned child close.',
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
                cancellation: 'cancellable',
                drainTimeoutMs: 1000,
                rationale:
                    'Immediate reads remain synchronous in effect; optional bounded output-or-exit waits are event-driven and OperationContext cancellation releases only the read waiter without terminating the persistent process.',
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
        mcp_cloudflare_edge_policy_apply: {
            effect: 'bounded-write',
            idempotency: 'non-idempotent',
            callerScope: 'admin',
            execution: {
                cancellation: 'bounded-non-cancellable',
                continuationBoundMs: 3600000,
                rationale:
                    'Closed edge-policy/passthrough targets share the same guarded Cloudflare mutation authority and mandatory pre-mutation backup boundary; cancellation remains bounded migration debt.',
            },
            output: 'intentional-untyped',
            network: 'fixed-external',
            credentials: ['cloudflare-api'],
            externalSideEffects: 'guarded',
            retry: 'manual-only',
        },
        mcp_cloudflare_edge_snapshot: {
            effect: 'none',
            idempotency: 'idempotent',
            callerScope: 'read',
            execution: {
                cancellation: 'bounded-non-cancellable',
                continuationBoundMs: 300000,
                rationale:
                    'Closed fixed-external read views dispatch directly to bounded Cloudflare audit/policy owners; no view mutates state or broadens beyond Cloudflare API authority.',
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
                    'Closed local metrics/transport-plan views read only local cloudflared metrics, config and persisted benchmark state; no external Cloudflare API authority is acquired.',
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
                continuationBoundMs: 120000,
                rationale:
                    'All views are bounded local configuration/state projections; no external probe is performed by this owner.',
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
        repo_quarantine_status: {
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
        copilot_sessions: {
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
