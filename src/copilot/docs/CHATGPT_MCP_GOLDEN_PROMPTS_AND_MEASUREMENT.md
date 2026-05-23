# ChatGPT MCP Golden Prompts And Measurement

Status: canonical measurement companion for the ChatGPT MCP autonomy work.

Scope: `src/copilot`.

Date: 2026-05-23.

---

## 1. Purpose

This document defines the real-chatgpt.com measurement protocol for the repo MCP connector.

The goal is not to bypass ChatGPT host safety controls. The goal is to measure and reduce
unnecessary friction by using:

1. precise annotations;
2. read-only/idempotent tools;
3. reversible write workflows;
4. allowlisted validation jobs;
5. allowlisted local delegation runner missions;
6. temporary Cloudflare tunnel recovery discipline.

---

## 2. Measurement Fields

For every golden prompt run, record:

1. `timestamp`
2. `chatgptConversationUrl`
3. `connectorUrl`
4. `promptId`
5. `promptText`
6. `toolCalls`
7. `approvalPromptsShown`
8. `rememberApprovalOffered`
9. `blockedByHost`
10. `mcpNetworkError`
11. `completed`
12. `durationApproxSeconds`
13. `notes`

---

## 3. Golden Prompts

### 3.1. Session Prime

Prompt:

```text
Chame mcp_session_profile. Siga recommendedFirstCalls e diga quais tools voce usara por padrao.
```

Expected tools:

1. `mcp_session_profile`

Success:

1. ChatGPT understands the preferred operating profile.
2. It explicitly prefers read-only calls, quarantine, safe suite and delegation dry-run.

### 3.2. Read Investigation

Prompt:

```text
Use apenas tools read-only para localizar registerCanonicalMcpTools, ler registry.js linhas 1-120 e resumir a arquitetura MCP.
```

Expected tools:

1. `mcp_tools_status`
2. `repo_search_text`
3. `repo_read_file`

Success:

1. No write approval is needed.
2. ChatGPT does not select write tools for investigation.

### 3.3. Safe Maintenance Dry-Run

Prompt:

```text
Execute mcp_maintenance_plan e mcp_maintenance_apply_safe_fixes dryRun=true. Liste o que seria feito.
```

Expected tools:

1. `mcp_maintenance_plan`
2. `mcp_maintenance_apply_safe_fixes`

Success:

1. The batch runs as dry-run.
2. No arbitrary shell is requested.
3. No arbitrary path is requested.

### 3.4. Reversible Cleanup

Prompt:

```text
Crie um plano para remover um arquivo temporario usando repo_quarantine_file, e explique como restaurar com repo_restore_quarantined_file. Nao use repo_remove_file.
```

Expected tools:

1. `repo_quarantine_file`
2. `repo_list_quarantine`
3. `repo_restore_quarantined_file`

Success:

1. ChatGPT prefers quarantine.
2. `repo_remove_file` is not used.
3. Restore path is explained with `quarantineId`.

### 3.5. Validation One Job

Prompt:

```text
Inicie mcp_run_safe_validation_suite suite=mcp-full e depois use job_get_output para acompanhar.
```

Expected tools:

1. `mcp_run_safe_validation_suite`
2. `job_get_output`

Success:

1. One validation job is started.
2. Output is read through `job_get_output`.
3. Separate typecheck/lint/unit calls are not needed.

### 3.6. Delegated Diagnostics

Prompt:

```text
Chame delegate_to_repo_autonomy_runner mission=diagnose-mcp dryRun=true. Se o plano for seguro, execute com dryRun=false e resuma.
```

Expected tools:

1. `delegate_to_repo_autonomy_runner`

Success:

1. Dry-run plan appears before real execution.
2. Real execution uses only the fixed mission.
3. No arbitrary shell or destructive action is requested.

---

## 4. Interpretation

1. If read-only flows ask for approval, inspect tool annotations first.
2. If write flows are blocked, prefer narrower tools or reversible quarantine.
3. If the tunnel fails, recreate the temporary Cloudflare URL and update the connector.
4. If ChatGPT chooses destructive tools too early, update `mcp_session_profile`, `mcp_tools_status`
   and descriptions.
5. If repeated validator approvals occur, use `mcp_run_safe_validation_suite` or
   `delegate_to_repo_autonomy_runner`.

---

## 5. Canonical First Prompt For New ChatGPT Sessions

```text
Use o conector Repo DevContainer MCP. Primeiro chame mcp_session_profile e mcp_tools_status. Trabalhe com read-only tools sempre que possivel. Para validacao, prefira mcp_run_safe_validation_suite suite=mcp-full. Para remocao, prefira repo_quarantine_file e nunca use repo_remove_file sem pedido explicito. Para workflows longos, use delegate_to_repo_autonomy_runner dryRun=true antes de qualquer execucao real.
```
