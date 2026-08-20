# LLM-B Tool Ops — State of the Art e Análise Aprofundada

**Data**: 2026-06-14 **Status**: snapshot operacional **Escopo**: superfície de ferramentas
disponível à LLM-B, contratos observados, gaps sentidos e proposta de evolução arquitetural.

---

## 1. Premissas

- Este relatório descreve **o que existe de fato** no runtime atual, não o que a documentação
  promete.
- Toda afirmação sobre tool behavior deve ser confirmada por código real ou por reprodução via tool
  canônica.
- O referencial arquitetural é 2.0/2.1: barrels puros, owners canônicos, contratos explícitos,
  observabilidade e governança por teste.

---

## 2. Mapa de Tools por Owner

As tools se organizam em famílias. Abaixo, agrupamento funcional observado no registry e no código.

### 2.1 Leitura e exploração

- `read_file_content`
- `list_directory`
- `search_in_files`
- `workspace_scope_*`
- `workspace_index_*`
- `workspace_parse_file`
- `workspace_scope_context`
- `workspace_find_imports`

### 2.2 Edição e escrita

- `edit`
- `patch_file`
- `create_file`
- `write_file_content`
- `copy_file`
- `move_file`
- `delete_file`
- `diff_files`
- `patch_bundle_plan`

### 2.3 Execução e shell

- `exec_command`
- `run_node_file`
- `run_npm_script`

### 2.4 Git e GitHub

- `git_status`
- `git_diff`
- `git_changed_files`
- `git_commit`
- `git_push`
- `git_create_branch`
- `git_current_branch`
- `git_log`
- `git_is_dirty`

### 2.5 Qualidade e testes

- `lint_check`
- `lint_fix`
- `run_tests`
- `quality_gate`
- `typecheck`

### 2.6 Introspecção e governança

- `list_tools`
- `get_tool_contract_report`
- `get_tool_health`
- `get_telemetry`
- `get_agent_info`
- `hook_get_audit_tail`
- `hook_get_pending_tasks`
- `read_briefing`

### 2.7 Gerenciamento de tarefas

- `todo_list`
- `todo_create`
- `todo_update`
- `todo_set_status`
- `todo_get`
- `todo_search`
- `todo_stats`
- `todo_bulk_update`
- `todo_clear_completed`
- `todo_add_subtask`
- `todo_delete`
- `todo_import`

### 2.8 Sessão e estado

- `get_session_state`
- `set_session_context`
- `session_mode_get`
- `session_mode_set`
- `session_plan_read`
- `session_plan_update`
- `session_plan_delete`
- `session_agent_list`
- `session_agent_current`
- `session_agent_select`
- `session_agent_reload`
- `session_compact`
- `reload_agent_process`

### 2.9 Comunicação e orquestração

- `request_user_input`
- `ask_user`
- `report_intent`
- `report_intent_local`
- `skill`
- `invoke_skill`
- `task`
- `list_agents`
- `read_agent`
- `get_workspace_info`

### 2.10 Browser/Puppeteer runtime

- `web_fetch`
- `web_fetch_local`
- `web_search`

### 2.11 Infra e transporte

- `list_bash`
- `toggle_tool`
- `permission_mode_get`
- `permission_mode_set`

---

## 3. Contratos observados

### 3.1 Leitura

- `read_file_content` aceita janelas (`startLine`, `endLine`), estratégia de cache
  (`cached|stream`), codificação, hash, read-through e metadados.
- Retorno rico: `io.traceId`, cache hit/miss, `readStrategy`, estatísticas de bytes e linhas.

### 3.2 Busca

- `search_in_files` expõe `cursor`, `maxResults`, `includePattern`, `excludePattern`, regex e
  sensibilidade de caso.
- `workspace_*_symbol` oferece lookup simbólico pré-indexado com paginação (`cursor`, `exactMatch`,
  `caseSensitive`).

### 3.3 Edição

- `patch_file` aceita `expectedHash`, `expectedOccurrences`, `occurrenceIndex`, `dryRun`,
  `diffContextLines`, `maxDiffLines` e `replace_all`.
- Retorno inclui diff preview e sidecars de rollback quando disponíveis.

### 3.4 Qualidade

- `quality_gate` é allowlisted por nome (`lint`, `typecheck`, `unit`, `integration`, etc.), com
  saída estruturada
  `{ ok, gate, script, durationMs, exitCode, checks[], failingFiles[], artifacts[] }`.

### 3.5 Telemetria

- `get_telemetry`, `get_tool_health`, `get_tool_contract_report` fornecem métricas de uso, latência,
  taxa de erro e cobertura de metadados.

---

## 4. O que funciona bem

- **Leitura seletiva**: janelas, read-through e metadados reduzem custo em arquivos grandes.
- **Busca híbrida**: ripgrep + índice simbólico com fallback explícito.
- **Edição cirúrgica**: `patch_file` com pré-condições reduz retrabalho em refators.
- **Qualidade estruturada**: `quality_gate` entrega envelope JSON estável por gate allowlisted.
- **Governança**: saúde de tools, contrato de tools e telemetria são superfícies reais, não
  promessas.
- **Atomicidade local**: rollback por arquivo em `patch_file` e sessões persistentes no
  ConversationHub.

---

## 5. Gargalos e gaps funcionais

### 5.1 Alta prioridade

| ID    | Gap                                                                                                                                  | Impacto                                             | Evidência                                  |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------- | ------------------------------------------ |
| 5.1.1 | Busca simbólica indexada aplica `LIMIT` antes de filtrar por escopo (`pathPrefix`, `kind`, `exactMatch`).                            | Falso negativo em módulos com homônimos externos.   | `findIoIndexSymbol()` + pós-filtro JS.     |
| 5.1.2 | `exactMatch` ignora normalização de case no ramo indexado quando `caseSensitive=false`.                                              | Caso-insensível falha indevidamente.                | Comparação `===` sem normalização.         |
| 5.1.3 | `normalizeCursorOffset()` retorna `0` para cursor inválido.                                                                          | Paginação pode repetir página 1 sem erro explícito. | `output-window.js`.                        |
| 5.1.4 | Falhas de tools não têm envelope operacional uniforme (`retryable`, `blockedReason`, `terminalSummary`, `durationMs`, `io.traceId`). | Retomada autônoma é frágil.                         | Returns `success:false, error` em cascata. |

### 5.2 Média prioridade

| ID    | Gap                                                                                       | Impacto                                                               |
| ----- | ----------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| 5.2.1 | `patch_file` é single-file; refators amplos exigem N edições sequenciais sem atomicidade. | Risco de estado intermediário corrompido.                             |
| 5.2.2 | Falta diff semântico por módulo/símbolo/owner.                                            | Diffs são texto puro; custo semântico alto para revisão arquitetural. |
| 5.2.3 | Memória operacional vive em Markdown, não em store consultável.                           | Decisões arquiteturais não são indexáveis nem filtráveis por tool.    |

### 5.3 Baixa prioridade

| ID    | Gap                                                     | Impacto                                    |
| ----- | ------------------------------------------------------- | ------------------------------------------ |
| 5.3.1 | Falta templates/alias reutilizáveis de tool.            | Chamadas repetitivas carregam boilerplate. |
| 5.3.2 | Falta feedback incremental por tool para fluxos longos. | Dificulta planejamento de retomada.        |

---

## 6. Proposta de evolução

### 6.1 Filtro SQL first-class para busca simbólica

- Mover `pathPrefix`, `kind`, `exactMatch`, `caseSensitive` para a query SQL.
- Adicionar método dedicado `findSymbolScoped()`.
- Fallback apenas quando SQL não puder cover o filtro; retornar `indexFallbackReason`.

### 6.2 Envelope de tool canônico

- Criar tipo `ToolOperationResult` aplicado a sucesso e falha.
- Campos: `ok`, `status`, `retryable`, `blockedReason`, `suggestedNextAction`, `terminalSummary`,
  `durationMs`, `exitCode?`, `io.traceId`, `checks[]`, `artifacts[]`.
- Integrar com `quality_gate` e com handlers existentes sem alterar semântica pública.

### 6.3 Patch transacional multi-arquivo

- Criar `apply_patch_plan` ou `patch_bundle` com N operações atômicas.
- `dryRun` obrigatório por padrão.
- Falhar tudo se qualquer pré-condição quebrar; retornar diff agregado e plano de rollback.

### 6.4 Diff semântico por owner/símbolo

- `diff_symbol({ file, symbol })` e `diff_owner({ ownerPath })`.
- Integração com parser de símbolos existente; fallback seguro para textual.

### 6.5 Memória operacional consultável

- Store `architecture_decision_records`.
- Schema: `id`, `date`, `owner`, `decision`, `riskBefore`, `riskAfter`, `evidencePaths`, `tests`,
  `supersedes`.
- Consultável por tool (`architecture_decision_search`).

---

## 7. Critérios de validação

Para qualquer melhoria nesta superfície:

1. Código real alterado: JSDoc + schema de retorno.
2. Testes unitários para contrato normal e contrato de erro.
3. `typecheck:node` e `lint` verdes no escopo tocado.
4. Atualização deste documento com delta real (antes/depois).
5. Nenhum bypass silencioso: se o contrato não pode ser cumprido, a tool deve falhar
   estruturadamente.

---

## 8. Próximos passos sugeridos

1. Implementar `findSymbolScoped()` e corrigir normalização de case.
2. Padronizar `ToolOperationResult` em `search/` e `code/`.
3. Propor `patch_bundle` como piloto em um módulo pequeno (`tests/unit/copilot/tools/**`).
4. Criar store `architecture_decision_records` com tool de consulta.
5. Revisar `get_tool_health` para expor categorias degradadas.

---

## 9. Nota de governança

Este documento é baseado em leitura nominal de código e contratos. Para evitar drift, todas as
funcionalidades descritas como “faltantes” devem ser validadas contra o código atual antes de serem
propostas como implementação. Atualizações futuras devem registrar a data e o autor implícito da
run.
