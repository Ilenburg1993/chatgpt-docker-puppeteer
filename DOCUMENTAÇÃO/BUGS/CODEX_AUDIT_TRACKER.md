# CODEX_AUDIT_TRACKER

- Ultima atualizacao: 2026-02-22T04:58:05Z
- Status: ativo (governanca continua)
- Politica: bug-first (`P0/P1` no canal primario)
- Canonico: `DOCUMENTAÇÃO/BUGS/CODEX_AUDIT_TRACKER.md`
- Alias solicitado: `DOCUMENTAÇÃO/bugs/CODEX_AUDIT_TRACKER.md`

## Objetivo
Tracker vivo para auditoria gradual, correcoes, aprimoramentos e upgrades no codigo inteiro.

## Rodada Atual
- Onda: Wave TYP-21 — Zeragem total do typecheck (`typecheck:full`) + hardening estrutural de tipagem
- Bug IDs da onda: `CODX-TYP21-001` a `CODX-TYP21-030`
- Snapshot da rodada: `DOCUMENTAÇÃO/BUGS/rodadas/CODEX_AUDIT_2026-02-22_01-57.md`

## Estado PM2/MCP/RAG/LSP
### Baseline de inicio (Wave TYP-21)
- PM2: saudavel (3/3 online)
- MCP: saudavel (`ok=true`, `tools_count=14`)
- RAG: saudavel (`ok=true`, `available=true`)
- LSP: funcional (`ok=true`)

### Baseline de fim (Wave TYP-21)
- PM2: saudavel (mantido)
- MCP: saudavel (mantido)
- RAG: saudavel (mantido)
- LSP: funcional (mantido)

## Top 5 Achados Ativos (Wave TYP-21)
1. `CODX-TYP21-001` | `P0` | `typecheck:node` com 262 erros em múltiplos domínios (`unknown/{}` sem narrowing).
   - Status: corrigido (`typecheck:node` -> `0`).
2. `CODX-TYP21-002` | `P0` | `typecheck:browser` com 138 erros (Vue/Vite ambient + browser globals incompletos).
   - Status: corrigido (`typecheck:browser` -> `0`).
3. `CODX-TYP21-003` | `P1` | Declaração `#core/constants` desatualizada mascarando exports reais (`DRIVER_NAMES`, `ERROR_NAMES`, `DRIVER_DOMAINS`).
   - Status: corrigido em `src/types/core/augmentations.d.ts`.
4. `CODX-TYP21-004` | `P1` | Mismatch de contratos SADI -> `FrameNavigator` (array vs string em `framePath`) no `ChatGPTDriver`.
   - Status: corrigido com adapter `toFrameNavProtocol(...)`.
5. `CODX-TYP21-005` | `P1` | Tipagem de `name` em hierarquia `TargetDriver -> BaseDriver -> ChatGPTDriver` inferindo literais incompatíveis.
   - Status: corrigido com widening explícito (`string`) nos níveis base.

## Correcoes Aplicadas Nesta Rodada
1. Fundação de tipagem/ambient (Node + Browser)
- `src/dashboard-ui/src/env.d.ts` e `src/dashboard-ui/src/shims-vue.d.ts` adicionados.
- `tsconfig.browser.json` ampliado para incluir `src/types/**/*.d.ts` e `.d.ts` do dashboard.
- `src/types/guards.js` expandido com `isRecord`, `asRecord`, `isActorLike`.
- `package.json` imports: alias `#types/*` + stub runtime `src/types/driver/contracts.js`.
2. Hotspots Node (domínio/controle/bridge)
- `src/agent/task_state_projector.js`
- `src/agent/mission_execution_service.js`
- `src/server/domain/task_control_service.js`
- `src/server/domain/mission_control_service.js`
- `src/server/dashboard-api/task_sync_bridge.js`
- `src/server/api/controllers/dashboard_tasks.js`
- `src/server/api/controllers/dashboard_missions.js`
- `src/server/api/controllers/rag.js`
- `src/server/middleware/schema_guard.js`
3. Core/infra/shared typing hardening
- `src/core/boot_resilience_manager.js`
- `src/core/context/engine/context_engine.js`
- `src/core/schemas/{schema_core,dna_schema,task_schema_v5}.js`
- `src/core/validators/prerequisite_validator.js`
- `src/infra/browser_pool/{pool_manager,PageLifecycleMonitor,puppeteer_guard}.js`
- `src/shared/page_stability/stabilizer.js`
- `src/shared/biomechanics/human.js`
4. Driver cluster (fechamento final do typecheck)
- `src/driver/core/{TargetDriver,BaseDriver}.js`
- `src/driver/factory.js`
- `src/driver/targets/ChatGPTDriver.js`
- `src/driver/modules/{triage,frame_navigator,input_resolver}.js`
- `src/core/constants/index.js` + `src/types/core/augmentations.d.ts`

## Testes Executados e Resultado
1. Baseline de triagem (antes da correção)
- `typecheck:node` -> **262 erros**
- `typecheck:browser` -> **138 erros**
2. Gates finais de tipagem
- `npm run typecheck:node` -> **OK (0 erros)**
- `npm run typecheck:browser` -> **OK (0 erros)**
- `npm run typecheck:full` -> **OK**
3. Qualidade e parse
- `npm run lint -- --quiet` -> **OK**
- `node --check` nos arquivos alterados da rodada -> **OK**

## Risco Residual
1. Base agora está com `typecheck:full` zerado, mas ainda sem `strict: true` global (intencional nesta onda).
2. Há casts localizados em fronteiras difíceis (drivers/bridges), mas centralizados e sem `@ts-ignore`.
3. Próxima onda pode promover endurecimento incremental (`noUncheckedIndexedAccess`/subset strict) por domínio.

## Rollback
1. Rollback por cluster (tipos compartilhados -> domínio -> core/infra -> drivers -> UI).
2. Preservar ambient declarations (`env.d.ts`, `shims-vue.d.ts`) e correções de alias `#types/*`.
3. Não reintroduzir `@ts-ignore` como estratégia de reversão.

## Proxima Onda (Escopo Fechado)
1. Endurecimento incremental de tipagem (strictness por domínio) com prioridade em `driver/*` e `server/domain/*`.
2. Criar contratos de auditoria para regressão de tipagem (`typecheck` por hotspot/top offenders).
3. Rodar regressões funcionais sensíveis aos arquivos tocados (driverpool/browserpool/dashboard realtime) para validar que o hardening de tipo não alterou comportamento.

## Rodada Anterior
- Onda: Wave 22 — Gate P1 canônico + normalização de scripts de teste
- Snapshot: `DOCUMENTAÇÃO/BUGS/rodadas/CODEX_AUDIT_2026-02-22_04-17.md`

## Playbook e Instrucoes Locais
- Playbook: `DOCUMENTAÇÃO/BUGS/CODEX_AUDIT_PLAYBOOK.md`
- Delta de instrucoes do agente: `DOCUMENTAÇÃO/BUGS/CODEX_DEFAULT_INSTRUCTIONS_DELTA.md`

---

# Wave AUD-TYP-AQ1 (2026-02-22)

## Resumo
Implementação inicial (funcional e integrada) do upgrade de auditoria com `collect-quality` dedicado, `audit:quick` smart-hybrid, engine de cobertura JSDoc v2 (AST/TypeScript) e telemetria estruturada de execução de quality gates.

## Top 5 Achados Ativos
1. `audit:quick` em working tree muito sujo continua pesado quando o smart-hybrid cai para `full` (ex.: mudança em `package.json` -> lint/typecheck/prettier full).
2. `quality.jsdoc_delta` ainda gera volume alto de findings em branches com muitas alterações (mitigado com cap no quick, mas ainda expressivo).
3. Contratos v3 específicos de quality gates (`lint/typecheck/prettier/jsdoc/ts-ignore`) ainda não foram registrados nesta rodada.
4. `audit:quality` é wrapper operacional útil, porém ainda não executa somente a fase quality (usa runner quick com flags conservadoras).
5. Caching/paralelismo/deduplicação de findings entre `quality` e `static` ainda não foram implementados.

## Correções Aplicadas Nesta Rodada
1. Novo engine JSDoc v2 com TypeScript Compiler API:
- `scripts/analysis/jsdoc_coverage_engine.mjs`
- `scripts/analysis/jsdoc_coverage_cli.mjs`
- `audit-jsdoc-coverage.mjs` (wrapper compat)
2. Novo collector de quality gates:
- `scripts/audit/collectors/quality.mjs`
- gates: `node_check`, `entrypoint_import_smoke`, `lint`, `typecheck_node`, `typecheck_browser`, `prettier_check`, `jsdoc_delta|full`, `ts_ignore_scan`
3. Smart-hybrid / classificador de impacto:
- `scripts/audit/lib/quality_targets.mjs`
- `scripts/audit/lib/impact_classifier.mjs`
4. Runner integrado com nova fase `collect-quality` + telemetria/report:
- `scripts/audit/runner.mjs`
- `quality_gates` expandido
- `quality_execution` persistido no JSON
- flags novas: `--quality-mode`, `--quality-jsdoc`, `--quality-prettier`
5. Fases/eventos/schema/static/scripts atualizados:
- `scripts/audit/lib/event_types.mjs`
- `scripts/audit/lib/phase_plan.mjs`
- `scripts/audit/lib/schema.mjs`
- `scripts/audit/collectors/static.mjs` (delegação para evitar duplicidade)
- `package.json` (`audit:quick:full`, `audit:quick:changed`, `audit:quality`, `jsdoc:*`)
6. Hardening adicional do quick:
- remoção de `shell:true` no step de Prettier (sem warning depreciação)
- cap de findings em `quality.jsdoc_delta` no quick (50)
- correção de parse do flag `--triage false` no runner

## Testes Executados e Resultado
1. Sintaxe/parse de audit:
- `node --check scripts/audit/collectors/quality.mjs scripts/audit/lib/impact_classifier.mjs scripts/audit/lib/quality_targets.mjs`
- `node --check scripts/audit/runner.mjs scripts/audit/lib/phase_plan.mjs scripts/audit/lib/event_types.mjs scripts/audit/collectors/static.mjs scripts/audit/lib/schema.mjs`
- Resultado: **OK**
2. Qualidade/tipagem:
- `npm run typecheck:full` -> **OK**
- `npm run lint -- --quiet` -> **OK**
3. Audit quick (integração end-to-end):
- `WAVE_AUDIT_QUICK_2026-02-22T06-10-51-881Z` -> **OK**, `quality_execution` persistido, smart fallback para full (config change)
- `WAVE_AUDIT_QUICK_2026-02-22T06-14-28-367Z` -> **OK**, sem warning `shell:true`, JSDoc delta cap aplicado (findings reduzidos)
- `WAVE_AUDIT_QUICK_2026-02-22T06-20-14-598Z` (`--quality-mode off --triage false`) -> **OK**, validando parse de `--triage false`

## Próxima Onda (escopo fechado)
1. Contracts v3 de quality gates (`warn` -> calibração -> `p1`) e integração em `contracts/domains/*`.
2. `audit:deep` com `quality.jsdoc_full` + thresholds/coverage report estruturado.
3. Caching/paralelismo/deduplicação no `collect-quality`.
4. `audit:quality` fase-only (ou preset composicional de runner) e testes unit/integration do collector/classificador/parsers.

## Rollback
1. Se houver regressão no runner, rollback por blocos:
- `collect-quality` integration (runner/phase plan/schema)
- collector `quality`
- engine JSDoc v2 (mantendo wrapper compat)
- scripts npm novos
2. Preservar sempre telemetria e evidência da rodada (tracker + snapshots).

---

# Wave AQ2 (2026-02-22) — Contratos v3 de Quality + JSDoc Full Threshold

## Resumo
Evolução da onda anterior (`AUD-TYP-AQ1`) com contratos v3 de quality gates (fase `warn`), vínculo de findings do `collect-quality` a `contract_id`s e telemetria JSDoc expandida (incluindo threshold para `jsdoc_full` no `audit:deep/nightly`).

## Top 5 Achados Ativos
1. `audit:quick` continua pesado em branch sujo com fallback `full` (mudança em `package.json`/configs -> lint/typecheck/prettier full), embora agora com telemetria clara e contratos cobrindo os findings.
2. `quality.jsdoc_delta` ainda gera muito finding em delta amplo; cap no quick mitiga triagem, mas backlog segue alto enquanto a branch estiver extensa.
3. `check:forbidden` (DSL estático) continua com ruído/regexs frágeis em contratos antigos (`security/sql-injection`, etc.); fora do escopo desta onda.
4. Threshold de `jsdoc_full` foi implementado no collector, mas ainda não validado em um `audit:deep` completo nesta rodada (validado indiretamente via engine full + código compilando).
5. Contracts de quality estão em `warn`; rollout para `p1/block` depende de calibração e limpeza de baseline (prettier/jsdoc no quick/deep).

## Correções Aplicadas Nesta Rodada
1. Novo domínio de contratos `quality` (v3 DSL, `warn`):
- `contracts/domains/quality.json` (10 contratos)
- `contracts/registry.json` atualizado para incluir o domínio
2. `collect-quality` agora emite findings com `contract_id`/`owner`/`enforcement_state` para quality gates:
- Node syntax
- entrypoint import smoke
- lint
- typecheck node/browser
- prettier
- jsdoc delta/full
- ts-ignore scan
3. `collect-quality` recebeu telemetria JSDoc expandida:
- `quality_execution.jsdoc.delta_coverage_pct`
- `quality_execution.jsdoc.full_coverage_pct`
- `quality_execution.jsdoc.threshold_pct`
4. Threshold agregado para `jsdoc_full` implementado no collector:
- gera finding `CONTRACT-QUALITY-JSDOC-FULL-COVERAGE-THRESHOLD` quando cobertura global ficar abaixo do threshold (default `80%`)
5. Runner com flag de calibragem:
- `--quality-jsdoc-full-threshold-pct`

## Testes Executados e Resultado
1. Registry/contratos:
- `npm run check:forbidden -- --json --contracts-mode hybrid --parity-mode`
- Resultado: **registry.errors=[]**, `contracts_loaded=59` (inclui domínio `quality`)
2. Qualidade/tipagem:
- `npm run typecheck:full` -> **OK**
- `npm run lint -- --quiet` -> **OK**
3. Audit quick (integração + cobertura de contracts quality):
- `WAVE_AUDIT_QUICK_2026-02-22T06-27-05-348Z` -> **OK**
- `contract_coverage.quality = { total: 10, covered_by_run: 10, violated: 2 }`
- `contract_drift` sem `stale_contracts`/`unowned_critical`
4. Engine JSDoc full (baseline para `audit:deep`):
- `npm run jsdoc:coverage:json` -> **OK**
- coverage global observado: **32.3%** (threshold default 80% ainda ficaria abaixo em deep/nightly, como esperado nesta fase `warn`)

## Risco Residual
1. Baseline de qualidade em working tree atual tem muitas violações de `prettier` e `jsdoc_delta`; contratos estão em `warn` por isso.
2. Falta calibração de thresholds de JSDoc por domínio/pasta (hoje threshold global único no collector deep/nightly).
3. Falta cache/paralelismo/deduplicação no `collect-quality` para reduzir custo do quick em fallback full.
4. Falta suíte de testes unit/integration dedicada aos novos componentes (`quality collector`, `impact classifier`, `jsdoc engine v2`).

## Próxima Onda (Escopo Fechado)
1. `AQ3`: caching/paralelismo/deduplicação de findings no `collect-quality`.
2. `AQ3`: testes unit/integration do `quality collector`, parsers e `impact_classifier`.
3. `AQ3`: rollout de contracts quality para `p1` seletivo (Node syntax, typecheck, ts-ignore) com baseline limpa.
4. `AQ3`: presets/composição de perfil (`audit:quality` phase-only ou `audit:profile`) para tuning operacional.

## Rollback
1. Se regressão surgir, rollback por bloco:
- domínio `quality` no registry
- vínculo `contract_id` no collector `quality`
- threshold JSDoc full e telemetria JSDoc no runner
2. Preservar `collect-quality` e engine JSDoc v2 (onda anterior) como base estável.

---

# Wave AQ3 (2026-02-22) — Cache + Paralelismo + Dedup no `collect-quality`

## Resumo
Fechamento da próxima onda natural após `AQ2`: implementação de cache local por step, paralelismo controlado e deduplicação de findings no `collect-quality`, com telemetria serializada no `audit_report` para comprovação de ganho operacional.

## Top 5 Achados Ativos
1. Cache foi implementado no collector, mas invalidado por mudanças amplas em branch suja com frequência (esperado; ainda há espaço para granularidade melhor).
2. `quality.jsdoc_delta` continua gerando backlog alto em delta amplo; cache reduz custo, mas não reduz volume de findings (por design).
3. `static.forbidden` ainda domina parte relevante do tempo do quick e segue fora do cache de quality (fora do escopo desta onda).
4. Deduplicação de findings foi adicionada no `collect-quality`, porém baseline atual não apresentou duplicatas removidas (`removed=0`).
5. Faltam testes unit/integration específicos do `quality collector` / `impact_classifier` / parsers para estabilizar futuras evoluções.

## Correções Aplicadas Nesta Rodada
1. Cache local por step no `collect-quality` (`artifacts/audit/cache/quality`)
- Implementado hashing determinístico por step/config/arquivos (`sha256(stableJson(...))`).
- Steps cacheados: `lint`, `typecheck_node`, `typecheck_browser`, `prettier_check`, `jsdoc_delta`, `jsdoc_full`, `ts_ignore_scan`.
- Cache hit preserva telemetria/progresso do runner via marker step (`*-cache-hit`), sem perder observabilidade.
2. Paralelismo controlado no `collect-quality`
- Grupo `quick-smoke`: `quality.node_check` + `quality.entrypoint_import_smoke`
- Grupo `delta-docs-scan`: `quality.jsdoc_delta` + `quality.ts_ignore_scan`
- Respeita modo `serial` por flag (`--quality-parallelism serial`) para rollback/tuning.
3. Deduplicação de findings no collector
- Fingerprint por `source_tool|file|line|rule|evidence`.
- Telemetria `quality_execution.dedup` adicionada.
4. Telemetria expandida de execução quality (report JSON)
- `quality_execution.cache`
- `quality_execution.parallelism`
- `quality_execution.dedup`
- Patch no `runner` para serializar esses blocos (incluindo `fatal-fallback` shape compatível).
5. Schema atualizado (aditivo) para suportar campos novos da telemetria quality.

## Testes Executados e Resultado
1. Parse/check
- `node --check scripts/audit/collectors/quality.mjs scripts/audit/runner.mjs scripts/audit/lib/schema.mjs` -> **OK**
2. Qualidade
- `npm run typecheck:full` -> **OK**
- `npm run lint -- --quiet` -> **OK**
3. `audit:quick` (evidência de AQ3)
- Run A (cache miss após mudança no collector): `WAVE_AUDIT_QUICK_2026-02-22T06-34-33-596Z`
  - `duration_ms_total=97190`
  - `quality_execution.duration_ms_by_step.lint=34543`
  - `typecheck_node=6659`, `typecheck_browser=3472`, `prettier=26894`
- Run B (cache hit, antes do patch de serialização extra): `WAVE_AUDIT_QUICK_2026-02-22T06-36-54-581Z`
  - `duration_ms_total=23645`
  - marcadores `quality-*-cache-hit` observados no log
- Run C (após patch no runner; cache reenchido): `WAVE_AUDIT_QUICK_2026-02-22T06-38-06-108Z`
  - `duration_ms_total=99870`
  - `quality_execution.cache={hits:0, misses:6, writes:6}` serializado
  - `quality_execution.parallelism.groups` serializado
  - `quality_execution.dedup={before:900, after:900, removed:0}` serializado
- Run D (prova final com cache hit + telemetria no report): `WAVE_AUDIT_QUICK_2026-02-22T06-39-58-895Z`
  - `duration_ms_total=23091`
  - `quality_execution.cache={hits:6, misses:0, writes:0}`
  - `quality_execution.parallelism.mode=auto`
  - `contract_coverage.quality={total:10, covered_by_run:10, violated:2}`

## Risco Residual
1. Cache atual depende fortemente de `changedFiles`; qualquer alteração no delta invalida steps caros (seguro, mas menos eficiente).
2. Sem cache/dedup cross-phase (`quality` vs `static` vs `runtime`) ainda há custo residual relevante.
3. Não há testes automatizados específicos da AQ3; validação foi operacional/integrada.

## Próxima Onda (Escopo Fechado)
1. Testes unit/integration do `collect-quality`, `impact_classifier`, parsers e engine JSDoc v2.
2. Rollout seletivo de contratos quality para `p1` (`node syntax`, `typecheck_*`, `ts-ignore`) com baseline limpa.
3. `audit:deep` com validação explícita de `jsdoc_full` + threshold e report de cobertura.
4. Evolução de cache (granularidade/config hash) e dedup cross-phase.

## Rollback
1. Se houver regressão de performance/telemetria:
- desativar cache via `--quality-cache false`
- forçar serial via `--quality-parallelism serial`
2. Reverter apenas bloco AQ3:
- `collect-quality` cache/paralelismo/dedup
- serialização extra no `runner`
- schema aditivo (se necessário)
3. Preservar AQ1/AQ2 (fase `collect-quality`, engine JSDoc v2 e contratos quality) como base.

---

# Wave AQ4 (2026-02-22) — Testes de AQ + Operação (`Makefile`/`package.json`) + Skills

## Resumo
Próximo passo natural após `AQ3`: criar testes automatizados para os componentes novos de auditoria (classificador de impacto, engine JSDoc v2 e collector `quality` em cenário leve), expor comandos operacionais no `package.json`/`Makefile` e atualizar skills existentes para refletir o fluxo `collect-quality` + smart-hybrid.

## Decisão sobre Skills (avaliação)
1. **Sem necessidade de skill nova nesta rodada**.
2. Cobertura funcional adequada com atualização de skills existentes:
- `audit-runbook-observability`
- `audit-contracts-v3-ops`
- `typing-node24-esm-tsserver`
3. Reavaliar criação de skill dedicada (`audit-quality-smart-hybrid`) apenas se a superfície de tuning (cache/paralelismo/dedup/parsers) crescer mais uma onda.

## Top 5 Achados Ativos
1. Ainda faltam testes unit/integration para parsers específicos de `quality` (`eslint/prettier/typecheck`) e fallback rules do collector.
2. `audit:quality` continua sendo wrapper de runner (não fase-only real); útil, mas sem isolamento completo por perfil.
3. Contratos quality críticos ainda estão em `warn` (rollout seletivo para `p1` pendente).
4. `static.forbidden` segue como custo relevante do quick e fora do cache do `collect-quality`.
5. `jsdoc_full` threshold já existe, mas falta validação explícita via `audit:deep` nesta linha de AQ.

## Correções Aplicadas Nesta Rodada
1. Testes unitários novos (AQ4)
- `tests/unit/audit/test_impact_classifier_scope_matrix.spec.js`
- `tests/unit/audit/test_jsdoc_coverage_engine_exports_detection.spec.js`
- `tests/unit/audit/test_jsdoc_coverage_engine_tag_validation.spec.js`
- `tests/unit/audit/test_quality_collector_smart_plan_resolution.spec.js`
2. `package.json` (scripts operacionais de AQ)
- `audit:quick:serial`
- `audit:quick:cache-off`
- `audit:deep:jsdoc`
- `lint:json`
- `test:unit:audit-quality`
3. `Makefile` (targets e help alinhados)
- `audit-quick-serial`
- `audit-quick-cache-off`
- `audit-deep-jsdoc`
- `jsdoc-coverage`
- `jsdoc-delta`
- `test-audit-quality`
4. Skills atualizados
- `.codex/skills/audit-runbook-observability/SKILL.md`
- `.codex/skills/audit-contracts-v3-ops/SKILL.md`
- `.codex/skills/typing-node24-esm-tsserver/SKILL.md`

## Testes Executados e Resultado
1. Testes unitários novos de AQ/JSDoc/collector
- `npm run -s test:unit:audit-quality` -> **OK (9/9)**
2. Qualidade global
- `npm run -s typecheck:full` -> **OK**
- `npm run -s lint -- --quiet` -> **OK**
3. Parse/check
- `node --check scripts/audit/lib/impact_classifier.mjs scripts/analysis/jsdoc_coverage_engine.mjs scripts/audit/collectors/quality.mjs` -> **OK**
4. Makefile smoke (targets novos)
- `make -n audit-quick-serial`
- `make -n audit-quick-cache-off`
- `make -n audit-deep-jsdoc`
- `make -n test-audit-quality`
- Resultado: **OK** (`make-targets-ok`)

## Risco Residual
1. Cobertura de testes ainda não inclui cache-hit/cache-miss do `collect-quality` via stubs controlados.
2. Ainda faltam testes de parser (`eslint JSON`, `prettier --check`, `tsc output`) desacoplados.
3. Atualização de skills foi incremental; uma skill dedicada de `audit-quality` pode fazer sentido se o fluxo ficar mais complexo.

## Próxima Onda (Escopo Fechado)
1. Testes de parser/fallback do `collect-quality` (`eslint`, `prettier`, `typecheck`, timeout/fallback`).
2. Rollout seletivo de contracts quality para `p1` (Node syntax + typecheck + ts-ignore).
3. `audit:deep` de validação com `jsdoc_full` threshold + cobertura reportada no tracker.
4. Ajuste de `audit:quality` para modo fase-only/preset composicional (se o runner suportar sem regressão).

## Rollback
1. Reverter apenas artefatos de AQ4:
- testes unitários novos
- scripts `package.json`
- targets `Makefile`
- updates de skills
2. Preservar AQ1–AQ3 (collector `quality`, contracts quality, cache/paralelismo/dedup) como base estável.

---

# Wave AQ5 (2026-02-22) — Parsers/Fallbacks de `quality` + Rollout seletivo `p1` (contracts)

## Resumo
Continuação natural da trilha de AQ: cobertura de testes para parsers/fallbacks do `collect-quality` e promoção seletiva de contratos quality críticos para `p1`, mantendo `prettier/jsdoc` em `warn`.

## Correções/Upgrades Aplicados Nesta Rodada
1. `scripts/audit/collectors/quality.mjs`
- Parsers internos exportados para teste unitário:
  - `parseTypecheckOutput`
  - `parsePrettierCheckOutput`
  - `parseEslintJsonOutput`
  - `parseJSDocCoverageReport`
  - `parseJSDocCoverageFindingsFromReport`
  - `parseTsIgnoreFindings`
2. Novos testes unitários (parsers + fallback do collector)
- `tests/unit/audit/test_quality_parsers_eslint_json.spec.js`
- `tests/unit/audit/test_quality_parsers_prettier_check.spec.js`
- `tests/unit/audit/test_quality_collector_fallback_rules.spec.js`
3. Script de teste agregado atualizado
- `package.json` -> `test:unit:audit-quality` agora cobre 7 arquivos de teste AQ/JSDoc/quality (14 testes)
4. Rollout seletivo de contracts quality para `p1` (`contracts/domains/quality.json`)
- Promovidos para `p1`:
  - `CONTRACT-QUALITY-NODE-SYNTAX`
  - `CONTRACT-QUALITY-TYPECHECK-NODE`
  - `CONTRACT-QUALITY-TYPECHECK-BROWSER`
  - `CONTRACT-QUALITY-TS-IGNORE-FORBIDDEN`
- Mantidos em `warn`:
  - `entrypoint import smoke`
  - `lint`
  - `prettier`
  - `jsdoc_*`

## Testes Executados e Resultado
1. Testes unitários AQ/quality/JSDoc
- `npm run -s test:unit:audit-quality` -> **OK (14/14)**
2. Registry/paridade de contratos
- `check:forbidden --contracts-mode hybrid --parity-mode` -> **registry_errors=[]**, `parity_mismatches=0`
3. Qualidade global
- `npm run -s typecheck:full` -> **OK**
- `npm run -s lint -- --quiet` -> **OK**
4. Audit quick após rollout seletivo `p1`
- `WAVE_AUDIT_QUICK_2026-02-22T06-54-14-816Z` -> **OK**
- `gate_blocking=false`, `shadow_would_block=false`
- `quality_gates` críticos promovidos:
  - `node_check_ok=true`
  - `typecheck_node_ok=true`
  - `typecheck_browser_ok=true`
  - `ts_ignore_ok=true`
- Violações restantes continuam em `warn` (sem bloquear): `prettier`, `jsdoc_delta`

## Risco Residual
1. `lint` permaneceu em `warn` apesar de estar verde no baseline, para evitar bloqueio prematuro em branches sujas com escopo amplo.
2. `entrypoint import smoke` ainda em `warn`; pode ser promovido depois de mais uma rodada de estabilidade.
3. Falta validação explícita de `audit:deep:jsdoc` nesta sequência (threshold `jsdoc_full` já implementado, mas ainda sem baseline registrado nesta onda).

## Próxima Onda (Escopo Fechado)
1. Rodar `audit:deep:jsdoc` e registrar baseline de `jsdoc_full` + threshold no tracker.
2. Testes adicionais de timeout/fallback e parsing degradado do `collect-quality`.
3. Considerar promoção de `lint` para `p1` após baseline repetível em branch de trabalho típica.
4. Avaliar `audit:quality` fase-only/preset composicional no runner.

## Rollback
1. Se surgir regressão, rebaixar apenas contracts quality promovidos para `warn`.
2. Preservar testes/parsers exportados (AQ5) e base AQ1–AQ4.
