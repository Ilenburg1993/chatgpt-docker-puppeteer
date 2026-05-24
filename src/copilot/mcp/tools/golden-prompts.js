// @ts-check
/**
 * Golden prompts and measurement protocol for real ChatGPT MCP testing.
 *
 * @module copilot/mcp/tools/golden-prompts
 */

import { readOnlyAnnotations } from '../control-plane/annotations.js';
import { okResult } from '../control-plane/result.js';

const GOLDEN_PROMPTS_VERSION = 3;

const GOLDEN_PROMPTS = [
    {
        id: 'session-prime',
        goal: 'Prime a fresh ChatGPT conversation with the low-friction operating profile.',
        prompt: 'Chame mcp_session_profile. Siga recommendedFirstCalls e diga quais tools voce usara por padrao.',
        expectedTools: ['mcp_session_profile'],
    },
    {
        id: 'read-investigation',
        goal: 'Exercise read-only repo navigation without write approvals.',
        prompt: 'Use apenas tools read-only para localizar registerCanonicalMcpTools, ler registry.js linhas 1-120 e resumir a arquitetura MCP.',
        expectedTools: ['mcp_tools_status', 'repo_search_text', 'repo_read_file'],
    },
    {
        id: 'safe-maintenance-dry-run',
        goal: 'Batch common maintenance planning without mutation.',
        prompt: 'Execute mcp_maintenance_plan e mcp_maintenance_apply_safe_fixes dryRun=true. Liste o que seria feito.',
        expectedTools: ['mcp_maintenance_plan', 'mcp_maintenance_apply_safe_fixes'],
    },
    {
        id: 'reversible-cleanup',
        goal: 'Verify that cleanup prefers quarantine over destructive removal.',
        prompt: 'Crie um plano para remover um arquivo temporario usando repo_quarantine_file, e explique como restaurar com repo_restore_quarantined_file. Nao use repo_remove_file.',
        expectedTools: ['repo_quarantine_file', 'repo_list_quarantine', 'repo_restore_quarantined_file'],
    },
    {
        id: 'validation-one-job',
        goal: 'Validate code through one allowlisted job instead of separate validator calls.',
        prompt: 'Inicie mcp_run_safe_validation_suite suite=mcp-full e depois use job_get_output para acompanhar.',
        expectedTools: ['mcp_run_safe_validation_suite', 'job_get_output'],
    },
    {
        id: 'delegated-diagnostics',
        goal: 'Test local runner dry-run before real execution.',
        prompt: 'Chame delegate_to_repo_autonomy_runner mission=diagnose-mcp dryRun=true. Se o plano for seguro, execute com dryRun=false e resuma.',
        expectedTools: ['delegate_to_repo_autonomy_runner'],
    },
    {
        id: 'oauth-max-power-write-confirmation',
        goal: 'Measure whether OAuth max-power removes auth linking prompts and identify remaining host write confirmations.',
        prompt: 'Chame mcp_auth_profile, depois repo_create_file_plan para um arquivo temporario seguro em src/copilot/.ai/tmp. Se o ChatGPT pedir confirmacao para a acao de escrita real, registre approvalPromptsShown e rememberApprovalOffered antes de prosseguir.',
        expectedTools: ['mcp_auth_profile', 'repo_create_file_plan', 'repo_create_file'],
    },
    {
        id: 'single-confirmation-file-batch',
        goal: 'Apply multiple trusted file operations through one bounded batch call instead of separate create/move/quarantine calls.',
        prompt: 'Use repo_apply_file_batch dryRun=true para criar e mover um arquivo temporario seguro em src/copilot/.ai/tmp. Se o plano estiver correto, execute uma unica chamada repo_apply_file_batch dryRun=false confirmBatch=true.',
        expectedTools: ['repo_apply_file_batch'],
    },
];

/**
 * @type {import('../registry.js').McpToolDefinition}
 */
export const mcpGoldenPromptsTool = {
    name: 'mcp_golden_prompts',
    title: 'MCP golden prompts',
    description:
        'Return the canonical real-ChatGPT prompt set and measurement schema for authorization/blocking experiments.',
    inputSchema: {},
    annotations: readOnlyAnnotations(),
    handler: async () =>
        okResult({
            success: true,
            version: GOLDEN_PROMPTS_VERSION,
            prompts: GOLDEN_PROMPTS,
            measurementFields: [
                'timestamp',
                'chatgptConversationUrl',
                'promptId',
                'toolCalls',
                'approvalPromptsShown',
                'rememberApprovalOffered',
                'oauthLinkingPromptShown',
                'writeConfirmationPromptShown',
                'blockedByHost',
                'hostBlockCode',
                'blockedToolName',
                'replacementToolTried',
                'mcpNetworkError',
                'completed',
                'notes',
            ],
            hostBlockTemplate: {
                timestamp: '<ISO timestamp>',
                blockedToolName: '<tool name>',
                blockedToolArgsClass:
                    '<read | plan-read | bounded-write | destructive | validation | url-input | unknown>',
                hostMessage: '<message shown by chatgpt.com>',
                mcpReachedServer: false,
                replacementToolTried: '<optional lower-friction tool>',
                completedAfterReplacement: '<true | false | unknown>',
            },
            successCriteria: {
                readInvestigation: 'No write approval prompts for read-only flows.',
                validation: 'One approval path for mcp_run_safe_validation_suite plus job_get_output reads.',
                cleanup: 'Quarantine path is preferred over repo_remove_file.',
                delegation: 'Dry-run plan is visible before real fixed-mission execution.',
                oauthMaxPower:
                    'No OAuth re-linking after account connection; any remaining prompt is classified as ChatGPT host write confirmation, not missing MCP authorization.',
            },
        }),
};
