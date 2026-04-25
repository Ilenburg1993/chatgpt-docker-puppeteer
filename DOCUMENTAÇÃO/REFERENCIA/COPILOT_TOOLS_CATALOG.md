# Catálogo de Tools — CLI vs Custom Runtime

Data de referência: 2026-04-24.

## Objetivo

Este documento define e registra, de forma auditável:

1. quais tools são **built-ins do Copilot CLI**;
2. quais tools são **customizadas do runtime local**;
3. a política obrigatória de precedência entre elas.

## Política canônica de precedência

- **Tools built-in do CLI DEVEM prevalecer** sobre qualquer tool custom com o mesmo nome.
- Tools custom que sobrescreviam built-ins do CLI foram **deprecadas**.
- O runtime deve evitar `overridesBuiltInTool: true` para colisões com built-ins do CLI.

## Defaults de aprovação

- O projeto mantém `approve_all` como default canônico para `onPermissionRequest` em
  `SessionConfig`.
- `AGENT_PERMISSION_MODE` default é `approve_all` em `src/copilot/config/env.js`.

## Ferramentas de observabilidade do catálogo

### Endpoint HTTP

`GET /api/sdk/tools`

Agora retorna, além da projeção local, um bloco `catalog` com:

- `catalog.cli.tools` (built-ins do CLI via `client.rpc.tools.list`);
- `catalog.custom.tools` (tools custom do runtime);
- `catalog.collisions` (nomes em colisão por igualdade);
- `catalog.deprecatedCustomTools` (tools locais deprecadas);
- `catalog.policy.cliBuiltinsPrecedeCustomTools=true`.

### Comando de auditoria local

```bash
node --input-type=module -e "import { CopilotClient } from '@github/copilot-sdk'; import { getAllTools } from './src/copilot/tools/index.js'; const custom=getAllTools().map(t=>t.name).sort(); const client=new CopilotClient(); await client.start(); let builtins=[]; try{ const res=await client.rpc.tools.list({}); builtins=(res?.tools??[]).map(t=>t.name).filter(Boolean).sort(); } finally { await client.stop(); } const collisions=custom.filter(n=>builtins.includes(n)); console.log(JSON.stringify({customCount:custom.length,builtinCount:builtins.length,collisions,custom,builtins},null,2));"
```

## Built-ins do CLI (catálogo detectado)

Total: 14

- ask_user
- bash
- fetch_copilot_cli_documentation
- glob
- grep
- list_bash
- read_bash
- report_intent
- skill
- stop_bash
- str_replace_editor
- task
- web_fetch
- write_bash

## Tools custom do runtime local (catálogo detectado)

Total: 91

- add_task
- copy_file
- create_file
- delete_file
- diff_files
- exec_command
- exp_agent_deselect
- exp_agent_get_current
- exp_agent_list
- exp_agent_reload
- exp_agent_select
- exp_extensions_disable
- exp_extensions_enable
- exp_extensions_list
- exp_extensions_reload
- exp_fleet_start
- exp_mcp_disable
- exp_mcp_enable
- exp_mcp_list
- exp_mcp_reload
- exp_plugins_list
- exp_skills_disable
- exp_skills_enable
- exp_skills_list
- exp_skills_reload
- get_agent_info
- get_session_state
- get_system_health
- get_tasks
- get_telemetry
- get_tool_health
- get_workspace_info
- git_changed_files
- git_commit
- git_create_branch
- git_current_branch
- git_diff
- git_is_dirty
- git_log
- git_push
- git_status
- hook_get_audit_tail
- hook_get_pending_tasks
- hub_create_session
- hub_list_sessions
- hub_poll_user_messages
- hub_read_history
- hub_send_message
- invoke_skill
- legacy_report_intent
- legacy_web_fetch
- lint_check
- list_directory
- list_tools
- move_file
- patch_file
- permission_mode_get
- permission_mode_set
- read_briefing
- read_file_content
- request_user_input
- run_node_file
- run_npm_script
- run_tests
- search_in_files
- session_agent_list
- session_agent_select
- session_compact
- session_mode_get
- session_mode_set
- session_plan_delete
- session_plan_read
- session_plan_update
- set_session_context
- todo_add_subtask
- todo_bulk_update
- todo_clear_completed
- todo_create
- todo_delete
- todo_get
- todo_import
- todo_list
- todo_search
- todo_set_status
- todo_stats
- todo_update
- toggle_tool
- typecheck
- web_search
- write_file_content
- write_pending_task

## Colisões detectadas e resolução

Colisões detectadas na auditoria de 2026-04-24:

- report_intent (CLI + custom)
- web_fetch (CLI + custom)

Resolução aplicada:

- custom `report_intent` -> `legacy_report_intent` (**deprecated**)
- custom `web_fetch` -> `legacy_web_fetch` (**deprecated**)
- `web_search` deixou de declarar override explícito
- bridge MCP deixou de declarar override explícito para built-ins

Com isso, o nome canônico dos built-ins CLI volta a ser livre e prioritário.

## Compatibilidade

- `legacy_report_intent` e `legacy_web_fetch` permanecem por retrocompatibilidade explícita.
- Código novo deve usar built-ins do CLI (`report_intent`, `web_fetch`) quando disponíveis.

## Arquivos alterados nesta política

- `src/copilot/tools/web-tools.js`
- `src/copilot/tools/introspection-tools.js`
- `src/copilot/bridges/mcp-tool-bridge.js`
- `src/copilot/server/routes/sdk/client.js`
- `src/copilot/agent/agent-context.js`
- `src/copilot/agent/facades/agent-runtime-tools.js`
