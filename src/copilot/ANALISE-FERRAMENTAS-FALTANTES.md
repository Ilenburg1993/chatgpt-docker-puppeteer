# Análise de Ferramentas Faltantes para `src/copilot`

**Data**: 2026-06-09  
**Escopo**: toolkit atual (105 ferramentas/operadores) vs necessidades de engenharia contínua do `src/copilot`  
**Objetivo**: identificar gaps, priorizar e propor roadmap de evolução das capabilities do agente.

---

## 1. Baseline das Ferramentas Disponíveis

### 1.1 Categorias já cobertas
- **Gerenciamento de estado e sessão**: `session_mode_*`, `set_session_context`, `get_session_state`, `session_plan_*`
- **Leitura/escrita de arquivos**: `read_file_content`, `write_file_content`, `create_file`, `delete_file`, `copy_file`, `move_file`, `patch_file`
- **Busca e indexação**: `search_in_files`, `workspace_index_*`, `workspace_symbol_search`, `find_symbol_usages`, `workspace_parse_file`
- **Execução e validação**: `exec_command`, `run_npm_script`, `run_node_file`, `lint_check`, `run_tests`, `typecheck`
- **Git e repositório**: `git_status`, `git_diff`, `git_commit`, `git_changed_files`, `git_push`, `git_create_branch`, `git_log`, `git_current_branch`, `git_is_dirty`
- **Comunicação**: `ask_user`, `request_user_input`, `hub_*`, `report_intent`, `report_intent_local`
- **Observabilidade**: `get_telemetry`, `get_tool_health`, `get_tool_contract_report`, `hook_get_audit_tail`, `hook_get_pending_tasks`
- **Gerenciamento de tarefas**: `todo_*` (CRUD completo, busca, estatísticas, importação em lote)
- **Workspace e escopo**: `workspace_scope_*`, `list_directory`, `diff_files`
- **Agentes e delegação**: `list_agents`, `read_agent`, `task`
- **Permissões**: `permission_mode_get`, `permission_mode_set`, `toggle_tool`
- **Web e rede**: `web_fetch_local`, `web_search`
- **Skills e extensões**: `invoke_skill`, `exp_*` (skills, MCP, plugins, extensions)

### 1.2 Forças da baseline atual
- Cobertura ampla de operações de arquivo e busca textual
- Integração nativa com git e npm
- Sistema de delegação via `task`
- Observabilidade de tools e telemetria
- Gerenciamento de permissões em runtime

---

## 2. Gaps Críticos Identificados

### 2.1 Refatoração Semântica (Prioridade: Crítica)
**Problema**: Não há ferramenta para renomear símbolos, mover exports ou atualizar imports automaticamente.  
**Impacto**: Refatorações manuais em `src/copilot` (que tem centenas de arquivos) são propensas a erro.  
**Ferramenta sugerida**: `refactor_rename_symbol(oldName, newName, paths)`  
**Benefício**: Mudanças estruturais seguras em larga escala.

### 2.2 Comparação Estruturada (Prioridade: Crítica)
**Problema**: `diff_files` é textual; não entende semântica de JS (add/remove de export, mudança de assinatura).  
**Impacto**: Code review e validação de mudanças são menos eficazes.  
**Ferramenta sugerida**: `diff_structured(pathA, pathB)`  
**Benefício**: Diff orientado a símbolos/funções, não apenas linhas.

### 2.3 Gestão de Dependências (Prioridade: Alta)
**Problema**: Não há ferramenta para atualizar imports após mover arquivos, detectar órfãos ou consolidar barrel exports.  
**Impacto**: Acúmulo de `import` quebrados após refatorações.  
**Ferramentas sugeridas**:
- `deps_find_orphans(modulePath)` — imports que não existem mais
- `deps_update_imports(oldPath, newPath)` — atualização em lote
- `deps_consolidate_barrel(dirPath)` — agrupar exports em barrel

### 2.4 Execução Seletiva de Testes (Prioridade: Alta)
**Problema**: `run_tests` aceita suites amplas (`fast`, `unit`, `integration`, `all`), mas não filtra por módulo/arquivo.  
**Impacto**: Lentidão no ciclo de validação durante desenvolvimento focalizado.  
**Ferramenta sugerida**: `run_tests_filter({suite, pattern, file})`  
**Benefício**: Validação rápida de mudanças locais sem rodar toda a suíte.

### 2.5 Monitoramento de Bundle/Performance (Prioridade: Alta)
**Problema**: Scripts de análise existem (`analyze:depcruise`, `analyze:deps:graph`, `analyze:arch:*`), mas não há tool direta para o agente.  
**Impacto**: Análise de performance requer invocação manual de scripts.  
**Ferramenta sugerida**: `perf_analyze_bundle(entryPoint)` + `perf_hotspots(dirPath)`  
**Benefício**: Diagnóstico proativo de gargalos antes que virem dívida.

### 2.6 Validação de Schema e Configuração (Prioridade: Média)
**Problema**: Não há ferramenta para validar `config.json`, `dynamic_rules.json` ou `.env*` contra schema canônico.  
**Impacto**: Configurações inválidas só são descobertas em runtime.  
**Ferramenta sugerida**: `config_validate(path, schema)`  
**Benefício**: Fail-fast em configurações quebradas.

### 2.7 Navegação Semântica Avançada (Prioridade: Média)
**Problema**: `workspace_symbol_search` e `find_symbol_usages` existem, mas falta navegação por tipo de símbolo com filtros compostos.  
**Impacto**: Exploração de módulos grandes requer múltiplas queries.  
**Ferramenta sugerida**: `symbol_search({kind, name, path, exactMatch})`  
**Benefício**: Busca contextual mais precisa.

### 2.8 Gerenciamento de Estado de Arquitetura (Prioridade: Média)
**Problema**: Não há tool para inspecionar barrel exports, camadas violadas ou módulos órfãos.  
**Impacto**: Dívida arquitetural cresce sem detecção automática.  
**Ferramentas sugeridas**:
- `arch_check_barrels(dirPath)` — barrel exports consistentes?
- `arch_check_layers()` — violações de camada (ex.: presentation chamando infra)
- `arch_find_orphans()` — módulos não importados por ninguém

### 2.9 Snapshot e Rollback de Arquivo (Prioridade: Média)
**Problema**: `git` tools existem, mas não há snapshot fino por arquivo antes de edição arriscada.  
**Impacto**: Rollback requer conhecimento de git pelo usuário.  
**Ferramenta sugerida**: `file_snapshot(path)` + `file_rollback(path, snapshotId)`  
**Benefício**: Segurança operacional para mudanças experimentais.

### 2.10 Operações em Lote de Arquivos (Prioridade: Baixa)
**Problema**: Não há tool para aplicar mesma ação (formatação, lint, substituição de padrão) em múltiplos arquivos.  
**Impacto**: Trabalho repetitivo em massa.  
**Ferramenta sugerida**: `file_batch({action, paths, params})`  
**Benefício**: Automação de rotinas repetitivas.

---

## 3. Roadmap Proposto (Fases e Subfases)

### Fase 1 — Segurança Estrutural (Crítica)
**Objetivo**: Eliminar risco de refatorações quebradas.

#### Subfase 1.1 — Refatoração Semântica
- Implementar `refactor_rename_symbol` com detecção de escopo (local vs export)
- Integrar com `find_symbol_usages` para atualizar todos os referentes
- Adicionar dry-run mode antes de aplicar mudanças

#### Subfase 1.2 — Dependências e Barrels
- Implementar `deps_find_orphans` escaneando imports de `src/copilot`
- Implementar `deps_update_imports` com validação de existência pós-mudança
- Criar relatório de barrel consistency por módulo

#### Subfase 1.3 — Validação
- Testes unitários para cada nova tool
- Smoke test: renomear símbolo em módulo pequeno, validar sem quebras
- Documentação de uso e limitações

---

### Fase 2 — Velocidade de Ciclo (Alta)
**Objetivo**: Reduzir latência entre mudança e validação.

#### Subfase 2.1 — Testes Filtrados
- Implementar `run_tests_filter` aceitando regex de arquivo ou módulo
- Integrar com `workspace_scope_find_symbol` para mapear arquivos afetados
- Cache de resultados por arquivo para re-execução seletiva

#### Subfase 2.2 — Diff Estruturado
- Implementar `diff_structured` parseando JS e gerando diff por símbolo
- Comparar exports, assinaturas de função e alterações de tipo
- Integrar com `git_diff` como fallback textual

#### Subfase 2.3 — Busca Semântica
- Expandir `workspace_symbol_search` com filtros de `kind` e `path`
- Adicionar busca por tipo de export (named vs default)
- Implementar cache de escopo por sessão

---

### Fase 3 — Governança Contínua (Média)
**Objetivo**: Detecção automática de dívida arquitetural.

#### Subfase 3.1 — Análise de Arquitetura
- Implementar `arch_check_barrels` — barrel exports consistentes?
- Implementar `arch_check_layers` — violações de dependência entre camadas
- Implementar `arch_find_orphans` — módulos mortos

#### Subfase 3.2 — Performance e Bundle
- Implementar `perf_analyze_bundle` usando `madge`/`depcruise` via `run_node_file`
- Implementar `perf_hotspots` — módulos com mais dependências reversas
- Agregar métricas em relatório periódico

#### Subfase 3.3 — Validação de Configuração
- Implementar `config_validate` com schemas canônicos
- Aplicar em `.env*`, `config.json`, `dynamic_rules.json`
- Integrar como pré-condição de boot

---

### Fase 4 — Conforto Operacional (Baixa/Média)
**Objetivo**: Automatizar rotinas repetitivas e aumentar autonomia.

#### Subfase 4.1 — Snapshot e Rollback
- Implementar `file_snapshot` salvando hash + conteúdo antes de edição
- Implementar `file_rollback` com validação de integridade
- Integrar com `patch_file` e `write_file_content`

#### Subfase 4.2 — Operações em Lote
- Implementar `file_batch` com ações: `format`, `lint:fix`, `replace_pattern`, `chmod`
- Adicionar dry-run e confirmação obrigatória para ações destrutivas

#### Subfase 4.3 — Documentação e Observabilidade
- Gerar module map automático de `src/copilot`
- Atualizar `docs/STRUCTURE.md` a cada mudança estrutural
- Adicionar métricas de uso das novas tools no `get_telemetry`

---

## 4. Critérios de Sucesso

1. **Cobertura**: 100% das operações comuns de refatoração suportadas por tools canônicas
2. **Segurança**: Todas as tools destrutivas têm dry-run + confirmação
3. **Performance**: Execução de `run_tests_filter` < 30s para módulo médio
4. **Observabilidade**: Uso de cada nova tool é rastreável via telemetria
5. **Documentação**: Cada nova tool tem JSDoc robusto + exemplo de uso

---

## 5. Riscos e Mitigações

| Risco | Probabilidade | Impacto | Mitigação |
|-------|--------------|---------|-----------|
| Refatoração semântica quebra código | Média | Alto | Dry-run + testes automáticos antes de aplicar |
| Aumento de superfície de ataque (file_snapshot/rollback) | Baixa | Médio | Validação de caminho + permissão_mode_selective |
| Performance em busca semântica em codebase grande | Média | Baixo | Cache de escopo + índice L2 |
| Dívida de manutenção das próprias tools | Alta | Médio | Testes unitários + documentação JSDoc obrigatória |

---

## 6. Ação Imediata Sugerida

**Próximo passo**: Implementar `deps_find_orphans` como prova de conceito da Fase 1.2.  
**Critério de sucesso**: identificar e reportar orphans reais em `src/copilot` em até 1 execução.

---

*Documento gerado por análise do toolkit atual (105 tools) vs necessidades de `src/copilot`.*
