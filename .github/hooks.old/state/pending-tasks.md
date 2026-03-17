# Pending Tasks — Hooks

> Backlog derivado do roadmap de modularização (F0→F6).

## Alta Prioridade

- [x] **[alta] F0 — Congelar baseline comportamental dos hooks**: capturar matriz de eventos esperados, regras críticas (askQuestions/Template F/close_key) e snapshot de contratos. Evidência: `DOCUMENTAÇÃO/PLANOS/F0_BASELINE_CONTRATOS_HOOKS_2026-03-15.md` + smoke 244/244 PASS <!-- auto:20260315 phase:F0 -->
- [x] **[alta] F1 — Extrair runtime/contexto transacional**: criar API única para leitura/escrita com lock obrigatório e migrar hooks automáticos para wrappers comuns <!-- auto:20260315 phase:F1 -->
- [x] **[alta] F2 — Consolidar policy engine**: centralizar regras de autorização/continuidade/fechamento em módulos de policy e remover drift entre pre/post/stop <!-- auto:20260315 phase:F2 -->

## Média Prioridade

- [x] **[media] F3 — Fatiar session-start/session-end**: separar lifecycle mínimo de briefing/reporting/analytics com tolerância a falha em jobs auxiliares (subfases F3.0→F3.6 concluídas no roadmap) <!-- auto:20260315 phase:F3 -->
- [x] **[media] F4 — Completar modularização do agent-stop**: extrair blocos remanescentes (stop-block/subturn) e reduzir lógica inline do entrypoint (subfases F4.0→F4.4 concluídas) <!-- auto:20260315 phase:F4 -->

## Backlog Livre

- [x] **[backlog] F5 — Reestruturar suíte de smoke**: F5.1/F5.2/F5.3 concluídas (suítes por domínio + agregador compatível + matriz de cobertura) <!-- auto:20260315 phase:F5 -->
- [x] **[backlog] F6 — Rollout controlado e corte de legado**: F6.1/F6.2/F6.3 concluídas (feature flag + medição + plano de estabilização/corte) <!-- auto:20260315 phase:F6 -->

## Nova trilha de refatoração rigorosa (F7→F12)

### Alta Prioridade

- [x] **[alta] F7.0 — Consolidação estrutural inicial + Script↔Lib obrigatório**: classificar scripts (auto/manual-runtime/manual-user/manutenção), mapear todo script para ao menos uma lib relacionada e abrir gaps com owner/prazo. <!-- auto:20260316 phase:F7.0 done:20260316 -->
- [x] **[alta] F7.1 — Inventário sistêmico de dependências**: mapear chamadas entre scripts/libs/contracts com foco em hotspots (`smoke-test.sh`, `agent-stop-lib.sh`, `common.sh`). <!-- auto:20260316 phase:F7.1 done:20260316 owner:hooks-architecture -->
- [x] **[alta] F7.2 — Matriz de acoplamento por domínio**: classificar acoplamentos e severidade (P0/P1/P2) para orientar a decomposição. <!-- auto:20260316 phase:F7.2 done:20260316 owner:hooks-architecture -->
- [x] **[alta] F7.4 — Criar libs dedicadas para scripts órfãos**: garantir 100% de cobertura Script↔Lib com wrappers iniciais e plano de migração por arquivo. <!-- auto:20260316 phase:F7.4 done:20260316 -->
- [x] **[alta] F7.5 — Estruturar subpastas canônicas em hooks-lib**: criar `runtime/context/policy/lifecycle/audit/maintenance/testing` e migrar módulos por domínio com compatibilidade incremental. <!-- auto:20260316 phase:F7.5 done:20260316 -->
- [x] **[alta] F7.7 — Migrar módulos legados no root de hooks-lib**: mover `common/config/policy/session-*` para subpastas de domínio, mantendo shims compatíveis durante transição. Concluído com inversão root->shim e validação `legacy_root_modules_unmapped_count=0`. <!-- auto:20260316 phase:F7.7 done:20260316 owner:hooks-runtime -->
- [x] **[alta] F7.8 — Índice machine-readable Script↔Lib**: publicar artefato versionado com mapeamento `script/lib/domínio/owner` em `.github/hooks/state/f7-script-lib-index.json`. <!-- auto:20260316 phase:F7.8 done:20260316 owner:hooks-quality -->
- [x] **[alta] F8.1 — Versionar contratos executáveis de policy/stop**: contratos e critérios formalizados em `contracts/contract-registry.json`, `contracts/stop-decision.schema.json` e `contracts/CONTRACT_VERSIONING_POLICY.md`. <!-- auto:20260316 phase:F8.1 done:20260316 -->
- [x] **[alta] F8.2 — Cobertura contratual no smoke**: checks explícitos adicionados em `scripts/smoke-test.sh` e `scripts/smoke-domains/smoke-policy.sh` para reason codes obrigatórios e payload mínimo de stop block. <!-- auto:20260316 phase:F8.2 done:20260315 owner:hooks-policy -->
- [ ] **[alta] F10.1 — Decompor agent-stop-lib por domínio**: separar `stop-block`, `stop-auth`, `stop-subturn`, `stop-observability`. <!-- auto:20260316 phase:F10.1 -->

### Média Prioridade

- [x] **[media] F7.3 — Backlog técnico priorizado com owners**: transformar diagnóstico em backlog executável por fases. Owners: P0=`hooks-policy`, P1=`hooks-runtime`, P2=`hooks-ops`. <!-- auto:20260316 phase:F7.3 done:20260316 ownerMap:P0-hooks-policy,P1-hooks-runtime,P2-hooks-ops -->
- [x] **[media] F7.6 — Verificador estrutural Script↔Lib**: automatizar detecção de script sem lib relacionada e de lib fora da taxonomia de subpastas. <!-- auto:20260316 phase:F7.6 done:20260316 owner:hooks-quality -->
- [x] **[media] F7.9 — Governança de diretórios e naming**: padronizar `README` por subpasta e regras de nomenclatura para wrappers/helpers em `hooks-lib/README.md` e `hooks-lib/*/README.md`. <!-- auto:20260316 phase:F7.9 done:20260316 owner:hooks-ops -->
- [ ] **[media] F7.10 — Integrar gate estrutural ao fluxo padrão**: incluir `verify-script-lib-coverage.sh` na rotina canônica de validação local/CI. <!-- auto:20260316 phase:F7.10 owner:hooks-quality -->
- [ ] **[media] F8.3 — Validar compatibilidade retroativa de contratos**: assegurar campos legados e payloads top-level. <!-- auto:20260316 phase:F8.3 -->
- [ ] **[media] F9.1 — Split fino dos checks V90/AS por domínio**: reduzir ruído e acelerar diagnóstico de regressão. <!-- auto:20260316 phase:F9.1 -->
- [ ] **[media] F9.2 — Harness padrão de fixtures/sandbox**: padronizar cenários de teste comportamental dos hooks. <!-- auto:20260316 phase:F9.2 -->
- [ ] **[media] F10.2 — Decompor common.sh por responsabilidade**: separar runtime/context/recovery/subturn em módulos menores. <!-- auto:20260316 phase:F10.2 -->
- [ ] **[media] F10.3 — Padronização final de APIs internas/JSDoc**: consolidar contratos internos para manutenção segura. <!-- auto:20260316 phase:F10.3 -->

### Backlog Livre

- [ ] **[backlog] F9.3 — Relatório de triagem por domínio**: produzir saída orientada à causa provável por suite. <!-- auto:20260316 phase:F9.3 -->
- [ ] **[backlog] F11.1 — Definir KPIs/SLOs da refatoração**: estabelecer métricas canônicas de qualidade operacional. <!-- auto:20260316 phase:F11.1 -->
- [ ] **[backlog] F11.2 — Persistir histórico de métricas**: registrar evolução por janela para auditoria contínua. <!-- auto:20260316 phase:F11.2 -->
- [ ] **[backlog] F11.3 — Relatório periódico de tendência**: disponibilizar acompanhamento de regressões e melhoria. <!-- auto:20260316 phase:F11.3 -->
- [ ] **[backlog] F12.1 — Janela final de estabilização com gates**: executar transição com critérios de entrada/saída e rollback. <!-- auto:20260316 phase:F12.1 -->
- [ ] **[backlog] F12.2 — Corte/depreciação de legado residual**: remover caminhos antigos após estabilidade comprovada. <!-- auto:20260316 phase:F12.2 -->
- [ ] **[backlog] F12.3 — Governança contínua ROADMAP/PLANO/backlog**: institucionalizar atualização sincronizada dos três artefatos. <!-- auto:20260316 phase:F12.3 -->

## Pacote de convergência lib-first para hooks automáticos (F13→F16)

### Alta Prioridade

- [x] **[alta] F13.1 — Contrato canônico de entrypoint para hooks automáticos**: publicado em `DOCUMENTAÇÃO/HOOKS/F13-1-CONTRATO-ENTRYPOINT-HOOKS-AUTOMATICOS.md` com padrão script-orquestrador + lib dedicada para os 9 hooks do `copilot-hooks.json`. <!-- auto:20260315 phase:F13.1 done:20260315 owner:hooks-architecture -->
- [x] **[alta] F13.2 — Matriz hook->script->libs->owner**: mapeamento completo publicado em `DOCUMENTAÇÃO/HOOKS/F13-2-MATRIZ-HOOK-SCRIPT-LIB-OWNER-2026-03-15.md` e `.github/hooks/state/f13-hook-script-lib-owner.json`. <!-- auto:20260315 phase:F13.2 done:20260315 owner:hooks-architecture -->
- [x] **[alta] F14.1 — Criar libs dedicadas faltantes para hooks automáticos**: libs criadas em `hooks-lib/lifecycle/*-lib.sh` e `hooks-lib/policy/*-lib.sh`; status consolidado em `.github/hooks/state/f14-auto-hook-entry-lib-status.json`. <!-- auto:20260315 phase:F14.1 done:20260315 owner:hooks-runtime -->
- [x] **[alta] F14.2 — Migrar regras de negócio para libs dedicadas**: migração concluída para os 8 hooks automáticos aplicáveis (`sessionStart`, `userPromptSubmitted`, `preToolUse`, `postToolUse`, `subagentStart`, `subagentStop`, `preCompact`, `sessionEnd`), mantendo `agentStop` como referência com entry-lib já existente. <!-- auto:20260315 phase:F14.2 done:20260315 owner:hooks-runtime -->

### Média Prioridade

- [x] **[media] F13.3 — Critério de script fino**: limite objetivo de responsabilidade inline publicado em `DOCUMENTAÇÃO/HOOKS/F13-3-CRITERIO-SCRIPT-FINO-2026-03-15.md` + `.github/hooks/state/f13-script-fino-rubric.json`. <!-- auto:20260315 phase:F13.3 done:20260315 owner:hooks-architecture -->
- [x] **[media] F14.3 — Padronizar dispatch único por hook automático**: dispatch único consolidado nos scripts automáticos orquestradores, com `session-end.sh` ajustado para padrão de entrypoint fino. <!-- auto:20260315 phase:F14.3 done:20260315 owner:hooks-runtime -->
- [ ] **[media] F15.1 — Consolidar padrão lib-first nos 8 hooks não-Stop**: completar convergência antes da quebra da lib do Stop. <!-- auto:20260315 phase:F15.1 owner:hooks-runtime -->
- [ ] **[media] F15.2 — Modularização interna de agent-stop-lib.sh**: separar `stop-auth`, `stop-block`, `stop-subturn`, `stop-observability` (fase posterior, sem tocar entrypoint). <!-- auto:20260315 phase:F15.2 owner:hooks-policy -->

### Backlog Livre

- [ ] **[backlog] F15.3 — Preservar estabilidade contratual de agent-stop.sh** durante decomposição da lib. <!-- auto:20260315 phase:F15.3 owner:hooks-policy -->
- [ ] **[backlog] F16.1 — Enforcement estrutural para auto hooks** no `verify-script-lib-coverage.sh`. <!-- auto:20260315 phase:F16.1 owner:hooks-quality -->
- [ ] **[backlog] F16.2 — Cobertura smoke de aderência lib-first (legacy+domains)** para todos os hooks automáticos. <!-- auto:20260315 phase:F16.2 owner:hooks-quality -->
- [ ] **[backlog] F16.3 — Gate integrado local/CI com métrica de aderência** por rodada. <!-- auto:20260315 phase:F16.3 owner:hooks-quality -->

## Pacote de modularização aprofundada file-by-file (F17)

### Alta Prioridade

- [x] **[alta] F17.0 — Planejamento transversal file-by-file**: plano detalhado publicado em `DOCUMENTAÇÃO/HOOKS/F17-PLANO-MODULARIZACAO-LIBS-FILE-BY-FILE-2026-03-15.md` + índice machine-readable em `.github/hooks/state/f17-file-by-file-modularization-plan.json`. <!-- auto:20260315 phase:F17.0 done:20260315 owner:hooks-architecture -->
- [x] **[alta] F17.1 — Executar modularização de `sessionStart`**: slices concluídos com extrações modulares e montagem final de briefing em helper dedicado. <!-- auto:20260315 phase:F17.1 done:20260315 owner:hooks-runtime -->
- [ ] **[alta] F17.2 — Executar modularização de `userPromptSubmitted`** (`log-prompt`): consolidar reset/privacidade/auditoria na entry-lib. <!-- auto:20260316 phase:F17.2 owner:hooks-runtime -->
- [ ] **[alta] F17.3 — Executar modularização de `preToolUse`**: consolidar guardas e policy compartilhável no domínio `policy/`. <!-- auto:20260316 phase:F17.3 owner:hooks-policy -->
- [ ] **[alta] F17.4 — Executar modularização de `postToolUse`**: consolidar fluxo de resultado/askQuestions/KEY no domínio `policy/`. <!-- auto:20260316 phase:F17.4 owner:hooks-policy -->

### Média Prioridade

- [ ] **[media] F17.5 — Executar modularização de `agentStop` (lib interna)**: decomposição profunda da `agent-stop-lib.sh` por subdomínio. <!-- auto:20260316 phase:F17.5 owner:hooks-policy -->
- [ ] **[media] F17.6 — Executar modularização de `subagentStart`**: padronização de correlação e contador em lifecycle compartilhado. <!-- auto:20260316 phase:F17.6 owner:hooks-runtime -->
- [ ] **[media] F17.7 — Executar modularização de `subagentStop`**: padronização de encerramento/correlação em lifecycle compartilhado. <!-- auto:20260316 phase:F17.7 owner:hooks-runtime -->
- [ ] **[media] F17.8 — Executar modularização de `preCompact`**: consolidar checkpoint/recovery com persistência transacional única. <!-- auto:20260316 phase:F17.8 owner:hooks-runtime -->

### Backlog Livre

- [ ] **[backlog] F17.9 — Executar modularização de `sessionEnd`**: consolidar fechamento crítico + pós-processamento modular em fronteira explícita. <!-- auto:20260316 phase:F17.9 owner:hooks-lifecycle -->
