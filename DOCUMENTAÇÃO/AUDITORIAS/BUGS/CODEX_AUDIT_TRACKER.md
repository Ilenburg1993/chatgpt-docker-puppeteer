# CODEX_AUDIT_TRACKER

- Ultima atualizacao: 2026-02-22T12:42:10Z
- Status: ativo (governanca continua)
- Politica: bug-first (`P0/P1` no canal primario)
- Canonico: `DOCUMENTAÇÃO/AUDITORIAS/BUGS/CODEX_AUDIT_TRACKER.md`
- Alias solicitado: `DOCUMENTAÇÃO/AUDITORIAS/BUGS/CODEX_AUDIT_TRACKER.md`

## Iniciativa Nova (Audit Agent LLM em Background)

- Plano mestre canônico: `DOCUMENTAÇÃO/AUDITORIAS/BUGS/CODEX_AUDIT_AGENT_MASTER_PLAN.md`
- Alias compatível: `DOCUMENTAÇÃO/AUDITORIAS/BUGS/CODEX_AUDIT_AGENT_MASTER_PLAN.md`
- Status: implementação em andamento (`F0/F1` concluídas; `F2/F3/F4/F5/F6/F7/F8/F9` parciais
  implementadas)
- Progresso recente:
  - `Inference Gateway` runtime mínimo funcional (`generate/embed/listModels`) com `clientTag`
    obrigatório
  - `ollama-host-supervisor` implementado (skeleton funcional com polling/circuit)
  - `server/main` agora registra `ollama_host` no readiness via probe pontual (`ready/degraded`)
  - `audit-agent` evoluiu para loop mínimo com jobs em memória + HTTP local (`/health`, `/metrics`,
    `/jobs`)
  - `dashboard` ganhou endpoints de leitura `/api/dashboard/inference/{runtime,metrics,models}`
  - `triage_llm` integrado ao `Audit Agent` via `Inference Gateway` (behind flag) com preflight de
    policy/profile (`/v1/validate/generate`)
  - `dashboard_audit` agora expõe `llm_triage_summary` em list/detail de jobs (read-model compacto)
  - wrappers de dashboard para mutações `AUDIT_*` e `INFERENCE_*` via control plane (sem terminal)
  - `ecosystem.config.cjs` recebeu processos opcionais (`audit-agent`, `inference-gateway`,
    `ollama-host-supervisor`) sob `ENABLE_AUDIT_AGENT_PM2_PROCESSES=true`
- Decisão de arquitetura: `Audit Agent` + `Inference Gateway` + `Ollama host WSL` + `supervisor`
  sidecar, com SSOT/control-plane obrigatório.
- Observação anti-confusão: separar papéis entre `Audit Agent`, `Audit Runner`, `MCP`,
  `LSP/TSServer`, `RAG` e LLMs externas do editor.

### Rodada Atual (Audit Agent contínuo)

- Escopo desta rodada: patch detail read-model + preflight de `audit_agent_patch` + guardrails de
  branch/path no `AUDIT_PATCH_APPLY`
- Gates executados:
  - `node --test` (patch-author runtime + control-plane persistence guards) -> **8/8 pass**
  - `node --check` (arquivos alterados) -> **OK**
  - `npm run typecheck:full` -> **OK**
  - `eslint` direcionado -> **OK**
  - `npm run audit:quick -- --triage false --progress false --eta false` -> **success**
    - Run: `WAVE_AUDIT_QUICK_2026-02-22T12-41-54-404Z`
    - `errors=0`, `warnings=0`, `partial=false`
    - observação: cache miss em `quality.lint`/`quality.prettier_check` aumentou duração (~117s),
      sem quebrar gates
- Próxima sequência natural:
  1. read-model detalhado de `llm_patch_author` por job
  2. schema/output mode mais estrito no `patch_author_llm`
  3. esqueleto de apply real (`AUDIT_PATCH_APPLY`) com validação de branch limpa/dirty, ainda
     blocked-by-default

## Objetivo

Tracker vivo para auditoria gradual, correcoes, aprimoramentos e upgrades no codigo inteiro.

## Rodada Atual

- Onda: Wave TYP-21 — Zeragem total do typecheck (`typecheck:full`) + hardening estrutural de
  tipagem
- Bug IDs da onda: `CODX-TYP21-001` a `CODX-TYP21-030`
- Snapshot da rodada: `DOCUMENTAÇÃO/ARQUIVO_MORTO/BUGS_RODADAS/CODEX_AUDIT_2026-02-22_01-57.md`

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

1. `CODX-TYP21-001` | `P0` | `typecheck:node` com 262 erros em múltiplos domínios (`unknown/{}` sem
   narrowing).
   - Status: corrigido (`typecheck:node` -> `0`).
2. `CODX-TYP21-002` | `P0` | `typecheck:browser` com 138 erros (Vue/Vite ambient + browser globals
   incompletos).
   - Status: corrigido (`typecheck:browser` -> `0`).
3. `CODX-TYP21-003` | `P1` | Declaração `#core/constants` desatualizada mascarando exports reais
   (`DRIVER_NAMES`, `ERROR_NAMES`, `DRIVER_DOMAINS`).
   - Status: corrigido em `src/types/core/augmentations.d.ts`.
4. `CODX-TYP21-004` | `P1` | Mismatch de contratos SADI -> `FrameNavigator` (array vs string em
   `framePath`) no `ChatGPTDriver`.
   - Status: corrigido com adapter `toFrameNavProtocol(...)`.
5. `CODX-TYP21-005` | `P1` | Tipagem de `name` em hierarquia
   `TargetDriver -> BaseDriver -> ChatGPTDriver` inferindo literais incompatíveis.
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

1. Base agora está com `typecheck:full` zerado, mas ainda sem `strict: true` global (intencional
   nesta onda).
2. Há casts localizados em fronteiras difíceis (drivers/bridges), mas centralizados e sem
   `@ts-ignore`.
3. Próxima onda pode promover endurecimento incremental (`noUncheckedIndexedAccess`/subset strict)
   por domínio.

## Rollback

1. Rollback por cluster (tipos compartilhados -> domínio -> core/infra -> drivers -> UI).
2. Preservar ambient declarations (`env.d.ts`, `shims-vue.d.ts`) e correções de alias `#types/*`.
3. Não reintroduzir `@ts-ignore` como estratégia de reversão.

## Proxima Onda (Escopo Fechado)

1. Endurecimento incremental de tipagem (strictness por domínio) com prioridade em `driver/*` e
   `server/domain/*`.
2. Criar contratos de auditoria para regressão de tipagem (`typecheck` por hotspot/top offenders).
3. Rodar regressões funcionais sensíveis aos arquivos tocados (driverpool/browserpool/dashboard
   realtime) para validar que o hardening de tipo não alterou comportamento.

## Rodada Anterior

- Onda: Wave 22 — Gate P1 canônico + normalização de scripts de teste
- Snapshot: `DOCUMENTAÇÃO/ARQUIVO_MORTO/BUGS_RODADAS/CODEX_AUDIT_2026-02-22_04-17.md`

## Playbook e Instrucoes Locais

- Playbook: `DOCUMENTAÇÃO/AUDITORIAS/BUGS/CODEX_AUDIT_PLAYBOOK.md`
- Delta de instrucoes do agente: `DOCUMENTAÇÃO/AUDITORIAS/BUGS/CODEX_DEFAULT_INSTRUCTIONS_DELTA.md`

---

# Wave AUD-TYP-AQ1 (2026-02-22)

## Resumo

Implementação inicial (funcional e integrada) do upgrade de auditoria com `collect-quality`
dedicado, `audit:quick` smart-hybrid, engine de cobertura JSDoc v2 (AST/TypeScript) e telemetria
estruturada de execução de quality gates.

## Top 5 Achados Ativos

1. `audit:quick` em working tree muito sujo continua pesado quando o smart-hybrid cai para `full`
   (ex.: mudança em `package.json` -> lint/typecheck/prettier full).
2. `quality.jsdoc_delta` ainda gera volume alto de findings em branches com muitas alterações
   (mitigado com cap no quick, mas ainda expressivo).
3. Contratos v3 específicos de quality gates (`lint/typecheck/prettier/jsdoc/ts-ignore`) ainda não
   foram registrados nesta rodada.
4. `audit:quality` é wrapper operacional útil, porém ainda não executa somente a fase quality (usa
   runner quick com flags conservadoras).
5. Caching/paralelismo/deduplicação de findings entre `quality` e `static` ainda não foram
   implementados.

## Correções Aplicadas Nesta Rodada

1. Novo engine JSDoc v2 com TypeScript Compiler API:

- `scripts/analysis/jsdoc_coverage_engine.mjs`
- `scripts/analysis/jsdoc_coverage_cli.mjs`
- `audit-jsdoc-coverage.mjs` (wrapper compat)

2. Novo collector de quality gates:

- `scripts/audit/collectors/quality.mjs`
- gates: `node_check`, `entrypoint_import_smoke`, `lint`, `typecheck_node`, `typecheck_browser`,
  `prettier_check`, `jsdoc_delta|full`, `ts_ignore_scan`

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

- `WAVE_AUDIT_QUICK_2026-02-22T06-10-51-881Z` -> **OK**, `quality_execution` persistido, smart
  fallback para full (config change)
- `WAVE_AUDIT_QUICK_2026-02-22T06-14-28-367Z` -> **OK**, sem warning `shell:true`, JSDoc delta cap
  aplicado (findings reduzidos)
- `WAVE_AUDIT_QUICK_2026-02-22T06-20-14-598Z` (`--quality-mode off --triage false`) -> **OK**,
  validando parse de `--triage false`

## Próxima Onda (escopo fechado)

1. Contracts v3 de quality gates (`warn` -> calibração -> `p1`) e integração em
   `contracts/domains/*`.
2. `audit:deep` com `quality.jsdoc_full` + thresholds/coverage report estruturado.
3. Caching/paralelismo/deduplicação no `collect-quality`.
4. `audit:quality` fase-only (ou preset composicional de runner) e testes unit/integration do
   collector/classificador/parsers.

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

Evolução da onda anterior (`AUD-TYP-AQ1`) com contratos v3 de quality gates (fase `warn`), vínculo
de findings do `collect-quality` a `contract_id`s e telemetria JSDoc expandida (incluindo threshold
para `jsdoc_full` no `audit:deep/nightly`).

## Top 5 Achados Ativos

1. `audit:quick` continua pesado em branch sujo com fallback `full` (mudança em
   `package.json`/configs -> lint/typecheck/prettier full), embora agora com telemetria clara e
   contratos cobrindo os findings.
2. `quality.jsdoc_delta` ainda gera muito finding em delta amplo; cap no quick mitiga triagem, mas
   backlog segue alto enquanto a branch estiver extensa.
3. `check:forbidden` (DSL estático) continua com ruído/regexs frágeis em contratos antigos
   (`security/sql-injection`, etc.); fora do escopo desta onda.
4. Threshold de `jsdoc_full` foi implementado no collector, mas ainda não validado em um
   `audit:deep` completo nesta rodada (validado indiretamente via engine full + código compilando).
5. Contracts de quality estão em `warn`; rollout para `p1/block` depende de calibração e limpeza de
   baseline (prettier/jsdoc no quick/deep).

## Correções Aplicadas Nesta Rodada

1. Novo domínio de contratos `quality` (v3 DSL, `warn`):

- `contracts/domains/quality.json` (10 contratos)
- `contracts/registry.json` atualizado para incluir o domínio

2. `collect-quality` agora emite findings com `contract_id`/`owner`/`enforcement_state` para quality
   gates:

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

- gera finding `CONTRACT-QUALITY-JSDOC-FULL-COVERAGE-THRESHOLD` quando cobertura global ficar abaixo
  do threshold (default `80%`)

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
- coverage global observado: **32.3%** (threshold default 80% ainda ficaria abaixo em deep/nightly,
  como esperado nesta fase `warn`)

## Risco Residual

1. Baseline de qualidade em working tree atual tem muitas violações de `prettier` e `jsdoc_delta`;
   contratos estão em `warn` por isso.
2. Falta calibração de thresholds de JSDoc por domínio/pasta (hoje threshold global único no
   collector deep/nightly).
3. Falta cache/paralelismo/deduplicação no `collect-quality` para reduzir custo do quick em fallback
   full.
4. Falta suíte de testes unit/integration dedicada aos novos componentes (`quality collector`,
   `impact classifier`, `jsdoc engine v2`).

## Próxima Onda (Escopo Fechado)

1. `AQ3`: caching/paralelismo/deduplicação de findings no `collect-quality`.
2. `AQ3`: testes unit/integration do `quality collector`, parsers e `impact_classifier`.
3. `AQ3`: rollout de contracts quality para `p1` seletivo (Node syntax, typecheck, ts-ignore) com
   baseline limpa.
4. `AQ3`: presets/composição de perfil (`audit:quality` phase-only ou `audit:profile`) para tuning
   operacional.

## Rollback

1. Se regressão surgir, rollback por bloco:

- domínio `quality` no registry
- vínculo `contract_id` no collector `quality`
- threshold JSDoc full e telemetria JSDoc no runner

2. Preservar `collect-quality` e engine JSDoc v2 (onda anterior) como base estável.

---

# Wave AQ3 (2026-02-22) — Cache + Paralelismo + Dedup no `collect-quality`

## Resumo

Fechamento da próxima onda natural após `AQ2`: implementação de cache local por step, paralelismo
controlado e deduplicação de findings no `collect-quality`, com telemetria serializada no
`audit_report` para comprovação de ganho operacional.

## Top 5 Achados Ativos

1. Cache foi implementado no collector, mas invalidado por mudanças amplas em branch suja com
   frequência (esperado; ainda há espaço para granularidade melhor).
2. `quality.jsdoc_delta` continua gerando backlog alto em delta amplo; cache reduz custo, mas não
   reduz volume de findings (por design).
3. `static.forbidden` ainda domina parte relevante do tempo do quick e segue fora do cache de
   quality (fora do escopo desta onda).
4. Deduplicação de findings foi adicionada no `collect-quality`, porém baseline atual não apresentou
   duplicatas removidas (`removed=0`).
5. Faltam testes unit/integration específicos do `quality collector` / `impact_classifier` / parsers
   para estabilizar futuras evoluções.

## Correções Aplicadas Nesta Rodada

1. Cache local por step no `collect-quality` (`artifacts/audit/cache/quality`)

- Implementado hashing determinístico por step/config/arquivos (`sha256(stableJson(...))`).
- Steps cacheados: `lint`, `typecheck_node`, `typecheck_browser`, `prettier_check`, `jsdoc_delta`,
  `jsdoc_full`, `ts_ignore_scan`.
- Cache hit preserva telemetria/progresso do runner via marker step (`*-cache-hit`), sem perder
  observabilidade.

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

- `node --check scripts/audit/collectors/quality.mjs scripts/audit/runner.mjs scripts/audit/lib/schema.mjs`
  -> **OK**

2. Qualidade

- `npm run typecheck:full` -> **OK**
- `npm run lint -- --quiet` -> **OK**

3. `audit:quick` (evidência de AQ3)

- Run A (cache miss após mudança no collector): `WAVE_AUDIT_QUICK_2026-02-22T06-34-33-596Z`
  - `duration_ms_total=97190`
  - `quality_execution.duration_ms_by_step.lint=34543`
  - `typecheck_node=6659`, `typecheck_browser=3472`, `prettier=26894`
- Run B (cache hit, antes do patch de serialização extra):
  `WAVE_AUDIT_QUICK_2026-02-22T06-36-54-581Z`
  - `duration_ms_total=23645`
  - marcadores `quality-*-cache-hit` observados no log
- Run C (após patch no runner; cache reenchido): `WAVE_AUDIT_QUICK_2026-02-22T06-38-06-108Z`
  - `duration_ms_total=99870`
  - `quality_execution.cache={hits:0, misses:6, writes:6}` serializado
  - `quality_execution.parallelism.groups` serializado
  - `quality_execution.dedup={before:900, after:900, removed:0}` serializado
- Run D (prova final com cache hit + telemetria no report):
  `WAVE_AUDIT_QUICK_2026-02-22T06-39-58-895Z`
  - `duration_ms_total=23091`
  - `quality_execution.cache={hits:6, misses:0, writes:0}`
  - `quality_execution.parallelism.mode=auto`
  - `contract_coverage.quality={total:10, covered_by_run:10, violated:2}`

## Risco Residual

1. Cache atual depende fortemente de `changedFiles`; qualquer alteração no delta invalida steps
   caros (seguro, mas menos eficiente).
2. Sem cache/dedup cross-phase (`quality` vs `static` vs `runtime`) ainda há custo residual
   relevante.
3. Não há testes automatizados específicos da AQ3; validação foi operacional/integrada.

## Próxima Onda (Escopo Fechado)

1. Testes unit/integration do `collect-quality`, `impact_classifier`, parsers e engine JSDoc v2.
2. Rollout seletivo de contratos quality para `p1` (`node syntax`, `typecheck_*`, `ts-ignore`) com
   baseline limpa.
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

Próximo passo natural após `AQ3`: criar testes automatizados para os componentes novos de auditoria
(classificador de impacto, engine JSDoc v2 e collector `quality` em cenário leve), expor comandos
operacionais no `package.json`/`Makefile` e atualizar skills existentes para refletir o fluxo
`collect-quality` + smart-hybrid.

## Decisão sobre Skills (avaliação)

1. **Sem necessidade de skill nova nesta rodada**.
2. Cobertura funcional adequada com atualização de skills existentes:

- `audit-runbook-observability`
- `audit-contracts-v3-ops`
- `typing-node24-esm-tsserver`

3. Reavaliar criação de skill dedicada (`audit-quality-smart-hybrid`) apenas se a superfície de
   tuning (cache/paralelismo/dedup/parsers) crescer mais uma onda.

## Top 5 Achados Ativos

1. Ainda faltam testes unit/integration para parsers específicos de `quality`
   (`eslint/prettier/typecheck`) e fallback rules do collector.
2. `audit:quality` continua sendo wrapper de runner (não fase-only real); útil, mas sem isolamento
   completo por perfil.
3. Contratos quality críticos ainda estão em `warn` (rollout seletivo para `p1` pendente).
4. `static.forbidden` segue como custo relevante do quick e fora do cache do `collect-quality`.
5. `jsdoc_full` threshold já existe, mas falta validação explícita via `audit:deep` nesta linha de
   AQ.

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

- `.github/skills/audit-runbook-observability/SKILL.md`
- `.github/skills/audit-contracts-v3-ops/SKILL.md`
- `.github/skills/typing-node24-esm-tsserver/SKILL.md`

## Testes Executados e Resultado

1. Testes unitários novos de AQ/JSDoc/collector

- `npm run -s test:unit:audit-quality` -> **OK (9/9)**

2. Qualidade global

- `npm run -s typecheck:full` -> **OK**
- `npm run -s lint -- --quiet` -> **OK**

3. Parse/check

- `node --check scripts/audit/lib/impact_classifier.mjs scripts/analysis/jsdoc_coverage_engine.mjs scripts/audit/collectors/quality.mjs`
  -> **OK**

4. Makefile smoke (targets novos)

- `make -n audit-quick-serial`
- `make -n audit-quick-cache-off`
- `make -n audit-deep-jsdoc`
- `make -n test-audit-quality`
- Resultado: **OK** (`make-targets-ok`)

## Risco Residual

1. Cobertura de testes ainda não inclui cache-hit/cache-miss do `collect-quality` via stubs
   controlados.
2. Ainda faltam testes de parser (`eslint JSON`, `prettier --check`, `tsc output`) desacoplados.
3. Atualização de skills foi incremental; uma skill dedicada de `audit-quality` pode fazer sentido
   se o fluxo ficar mais complexo.

## Próxima Onda (Escopo Fechado)

1. Testes de parser/fallback do `collect-quality` (`eslint`, `prettier`, `typecheck`,
   timeout/fallback`).
2. Rollout seletivo de contracts quality para `p1` (Node syntax + typecheck + ts-ignore).
3. `audit:deep` de validação com `jsdoc_full` threshold + cobertura reportada no tracker.
4. Ajuste de `audit:quality` para modo fase-only/preset composicional (se o runner suportar sem
   regressão).

## Rollback

1. Reverter apenas artefatos de AQ4:

- testes unitários novos
- scripts `package.json`
- targets `Makefile`
- updates de skills

2. Preservar AQ1–AQ3 (collector `quality`, contracts quality, cache/paralelismo/dedup) como base
   estável.

---

# Wave AQ5 (2026-02-22) — Parsers/Fallbacks de `quality` + Rollout seletivo `p1` (contracts)

## Resumo

Continuação natural da trilha de AQ: cobertura de testes para parsers/fallbacks do `collect-quality`
e promoção seletiva de contratos quality críticos para `p1`, mantendo `prettier/jsdoc` em `warn`.

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

- `package.json` -> `test:unit:audit-quality` agora cobre 7 arquivos de teste AQ/JSDoc/quality (14
  testes)

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

- `check:forbidden --contracts-mode hybrid --parity-mode` -> **registry_errors=[]**,
  `parity_mismatches=0`

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

1. `lint` permaneceu em `warn` apesar de estar verde no baseline, para evitar bloqueio prematuro em
   branches sujas com escopo amplo.
2. `entrypoint import smoke` ainda em `warn`; pode ser promovido depois de mais uma rodada de
   estabilidade.
3. Falta validação explícita de `audit:deep:jsdoc` nesta sequência (threshold `jsdoc_full` já
   implementado, mas ainda sem baseline registrado nesta onda).

## Próxima Onda (Escopo Fechado)

1. Rodar `audit:deep:jsdoc` e registrar baseline de `jsdoc_full` + threshold no tracker.
2. Testes adicionais de timeout/fallback e parsing degradado do `collect-quality`.
3. Considerar promoção de `lint` para `p1` após baseline repetível em branch de trabalho típica.
4. Avaliar `audit:quality` fase-only/preset composicional no runner.

## Rollback

1. Se surgir regressão, rebaixar apenas contracts quality promovidos para `warn`.
2. Preservar testes/parsers exportados (AQ5) e base AQ1–AQ4.

---

# Wave AQ6 (2026-02-22) — Baseline `audit:deep:jsdoc` (`jsdoc_full` + threshold)

## Resumo

Execução da próxima fase natural após `AQ5`: `audit:deep:jsdoc` para registrar baseline explícito de
`jsdoc_full` e validar o contrato de threshold de cobertura JSDoc em `deep`.

## Resultado principal (JSDoc Full)

1. Run: `WAVE_AUDIT_DEEP_2026-02-22T06-59-05-811Z`
2. `quality_execution.jsdoc.full_coverage_pct = 32.7`
3. `quality_execution.jsdoc.threshold_pct = 80`
4. Contrato de threshold acionado (esperado nesta fase):

- `CONTRACT-QUALITY-JSDOC-FULL-COVERAGE-THRESHOLD`
- Evidência: `Cobertura global JSDoc 32.7% abaixo do threshold 80%`

## Estado da Execução

1. `run_outcome=partial` (não bloqueante para este objetivo)
2. Causa de parcial:

- falha em `collect-tests -> tests.unit` durante `audit:deep`

3. `collect-quality` foi concluído com sucesso antes da falha de testes e entregou o baseline de
   `jsdoc_full`.

## Evidências relevantes

1. `quality_gates.jsdoc_full_ok = false` (esperado, cobertura abaixo do threshold)
2. `contract_coverage.quality = { total: 10, covered_by_run: 10, violated: 3 }`
3. `shadow_would_block = false`
4. `gate_blocking = false` (enforcement do deep em `warn`)

## Risco Residual

1. `full_coverage_pct` ainda muito abaixo do threshold global (`32.7%` vs `80%`).
2. `tests.unit` no `audit:deep` está falhando em ambiente atual; precisa triagem dedicada para
   remover parcial do pipeline deep.
3. `ts_ignore` também apareceu como violação no deep (scan full), indicando divergência entre quick
   delta e full-scope.

## Próxima Onda (Escopo Fechado)

1. Triagem da falha `tests.unit` observada no `audit:deep` (para remover `partial` do deep).
2. Plano incremental de subida de cobertura JSDoc por domínio prioritário (`entrypoints/core`,
   `server/domain`, `driver/shared`).
3. Definir threshold progressivo (temporário) por perfil/domínio ou manter global `80%` em `warn`
   até baseline subir.

## Rollback

1. Sem rollback de código nesta rodada (execução/medição apenas).
2. Manter contratos JSDoc em `warn` e baseline documentado.

---

# Wave AAG-F6/F9 (2026-02-22) — Audit Agent + Inference Gateway (avanço acelerado)

## Resumo

Implementação contínua de múltiplas fases do plano do `Audit Agent`, com foco em:

1. `control_command_service` (comandos mínimos `AUDIT_*`/`INFERENCE_*`)
2. `dashboard /api/dashboard/audit/*` (read-only V0)
3. robustez de testes/proxy local para `audit-agent`

## Correções / Implementações

1. `src/server/domain/control_command_service.js`

- adicionados comandos:
  - `AUDIT_JOB_CREATE`
  - `AUDIT_JOB_RUN`
  - `AUDIT_JOB_CANCEL`
  - `AUDIT_JOB_RETRY`
  - `INFERENCE_PROFILE_VALIDATE`
- proxy local para `audit-agent` (create/run/cancel/retry)
- validação local de policy/route de inferência com `resolveInferencePolicy` +
  `validateInferenceRoute`

2. `src/server/api/controllers/dashboard_audit.js` (novo)

- endpoints V0:
  - `/audit/runtime`
  - `/audit/jobs`
  - `/audit/jobs/:id`
  - `/audit/jobs/:id/findings` (placeholder)
  - `/audit/jobs/:id/patches` (placeholder)
  - `/audit/watch-rules` (placeholder)

3. `src/server/api/controllers/dashboard.js`

- mount do `dashboardAuditRouter`

4. `src/audit_agent/server.js`

- `GET /jobs/:id` adicionado

## Testes e Gates Executados

1. `node --test tests/unit/audit_agent/test_audit_agent_server.spec.js tests/unit/server/test_control_command_service_audit_inference.spec.js`
   -> **5/5 pass**
2. `npx eslint --quiet` (arquivos alterados) -> **OK**
3. `npm run typecheck:full` -> **OK**
4. `node --test tests/regression/test_wave20b_server_main_import_pm2_env_no_boot.spec.js tests/regression/test_wave20b_main_import_daemon_env_no_boot.spec.js`
   -> **2/2 pass**
5. `npm run audit:quick -- --triage false --progress false --eta false` -> **success**

- Run: `WAVE_AUDIT_QUICK_2026-02-22T11-07-37-415Z`
- `errors=0`, `warnings=0`, `partial=false`

## Riscos Ativos

1. `audit-agent` ainda em memória (sem DB `audit_jobs/*`)
2. `/api/dashboard/audit/*` com placeholders para findings/patches/watch-rules
3. `AUDIT_PATCH_*` e `INFERENCE_*` avançados ainda não implementados no control plane

## Próxima Rodada (escopo fechado)

1. Persistência `audit_jobs`/`audit_job_runs` (Fase 4 parcial)
2. `AUDIT_PATCH_*`/`AUDIT_WATCH_RULE_*` mínimos (stubs auditáveis) + `INFERENCE_*` persistidos
3. `audit-agent` job manual real consumindo `Inference Gateway` + MCP (`lsp_*`/`rag_*`)

---

# Wave AAG-F4/F3 (2026-02-22) — Persistência SQLite (`audit_jobs/*` + `inference_*` mínimos)

## Resumo

Rodada acelerada de base de persistência para o `Audit Agent` e configuração avançada de inferência:

1. migration v7 com tabelas `audit_jobs`, `audit_job_runs` e `inference_*` mínimos
2. repos iniciais
3. persistência SQLite opcional integrada ao runtime do `audit-agent`
4. fallback de leitura em `/api/dashboard/audit/jobs*`

## Implementado

1. `src/infra/db/migrations.js`

- migration `v7: audit_agent_and_inference_config`

2. Repositórios novos

- `src/infra/db/audit_job_repo.js`
- `src/infra/db/audit_job_run_repo.js`
- `src/infra/db/inference_profile_repo.js`
- `src/infra/db/inference_client_policy_repo.js`

3. `audit-agent` persistência mínima

- `src/audit_agent/db_store.js`
- `src/audit_agent/runtime.js` (save job snapshots + run start/finish)
- `src/audit_agent/main.js` (store SQLite por padrão, com fallback em memória)

4. `dashboard_audit` fallback

- `src/server/api/controllers/dashboard_audit.js`
- fallback para DB quando `audit-agent` local estiver indisponível

## Gates / Evidências

1. `node --test tests/unit/audit_agent/*.spec.js tests/unit/inference/*.spec.js tests/unit/server/test_control_command_service_audit_inference.spec.js`
   -> **22/22 pass**
2. `npm run typecheck:full` -> **OK**
3. `npm run audit:quick -- --triage false --progress false --eta false` -> **success**

- Run: `WAVE_AUDIT_QUICK_2026-02-22T11-20-35-842Z`
- `errors=0`, `warnings=0`, `partial=false`

## Riscos Ativos

1. `audit-agent` ainda não faz hidratação de jobs persistidos no startup
2. `audit_job_findings` / `audit_patch_proposals` / `audit_watch_rules` ainda sem schema/repos
3. `Inference Gateway` ainda não consome policies persistidas (`inference_client_policies`) em
   runtime

## Próxima Rodada (escopo fechado)

1. hidratação opcional de `audit_jobs` no startup do `audit-agent`
2. schema/repos `audit_job_findings` + `audit_patch_proposals`
3. job manual real com `Inference Gateway` + MCP (`lsp_*`, `rag_*`) em `read_only/propose_only`

---

# Wave AAG-F3/F4/F6/F9 (2026-02-22) — Policies DB-backed + Comandos de Patch/Watch/Inference + Dashboard Read APIs

## Resumo

Rodada de integração vertical do `Audit Agent` com:

1. persistência de findings/patches/watch-rules
2. `Inference Gateway` recarregando policies do SQLite
3. expansão do `control_command_service` para `AUDIT_PATCH_*`, `AUDIT_WATCH_RULE_*` e `INFERENCE_*`
4. endpoints de dashboard consumindo dados reais do domínio (`audit_*` e `inference_*`)

## Correções / Implementações

1. **Schema + repos (`audit_*`)**

- `src/infra/db/migrations.js` (migration `v8`)
- `src/infra/db/audit_finding_repo.js`
- `src/infra/db/audit_patch_repo.js`
- `src/infra/db/audit_watch_rule_repo.js`
- `audit_patch_repo` com `updateAuditPatchProposal()`
- `audit_watch_rule_repo` com `getAuditWatchRuleById()`

2. **`audit-agent` persistência ampliada**

- `src/audit_agent/runtime.js`
  - persistência de findings e patch proposals
  - `hydrateFromStore()`
  - suporte a `contextBuilder.collectQuickContext()`
- `src/audit_agent/main.js` (hydration opcional)
- `src/audit_agent/context_builder.js` (read-only probe V0: MCP/RAG/LSP + Inference Gateway)

3. **`Inference Gateway` DB-backed**

- `src/inference_gateway/persistence.js`
- `src/inference_gateway/gateway.js`
  - `setPolicies()`, `getPolicySummary()`
  - profile herdado de `clientPolicy.profile_name`
- `src/inference_gateway/server.js`
  - `GET /v1/policies`
  - `POST /v1/policies/reload`
- `src/inference_gateway/main.js` faz reload inicial do SQLite

4. **Control Plane (`AUDIT_*` + `INFERENCE_*`)**

- `src/server/domain/control_command_service.js`
- comandos novos implementados:
  - `AUDIT_PATCH_APPROVE`
  - `AUDIT_PATCH_REJECT`
  - `AUDIT_WATCH_RULE_UPSERT`
  - `AUDIT_WATCH_RULE_TOGGLE`
  - `INFERENCE_PROFILE_UPSERT`
  - `INFERENCE_CLIENT_POLICY_UPSERT`
- reload do `Inference Gateway` após `INFERENCE_*`
- bug corrigido: import dinâmico de socket hub (`#server/engine/socket` vs `socket.js.js`)

5. **Dashboard APIs**

- `src/server/api/controllers/dashboard_audit.js`
  - findings/patches/watch-rules saíram de placeholder e passaram a ler repos reais
- `src/server/api/controllers/dashboard_inference.js`
  - `GET /inference/profiles`
  - `GET /inference/client-policies`
  - `GET /inference/policies/summary`

## Testes e Gates Executados

1. `env -u NO_COLOR node --test tests/unit/inference/*.spec.js tests/unit/server/test_control_command_service_audit_inference.spec.js tests/unit/server/test_control_command_service_audit_persistence.spec.js`
   -> **15/15 pass**
2. `npm run typecheck:full` -> **OK**
3. `eslint` direcionado (arquivos alterados) -> **OK**
4. `npm run audit:quick -- --triage false --progress false --eta false` -> **success**

- Run: `WAVE_AUDIT_QUICK_2026-02-22T11-39-17-917Z`
- `errors=0`, `warnings=0`, `partial=false`

## Riscos Ativos

1. `AUDIT_PATCH_APPLY` ainda não implementado (somente approve/reject).
2. `context_builder` ainda em modo probe/health; falta uso direto de MCP `lsp_*`/`rag_*`.
3. `inference_backends/models` ainda sem repos/gestão operacional completa.
4. PM2 dos processos novos segue atrás de flags seguras (não ativado por default).

## Próxima Rodada (escopo fechado)

1. Primeiro job manual real do `audit-agent` com MCP `lsp_*`/`rag_*` (read-only).
2. `AUDIT_PATCH_APPLY` guardado (sem fake apply) + dry-run/approval checks.
3. Repos/gestão mínima de `inference_backends` e `inference_models`.

---

# Wave AAG-F5/F7/F6 (2026-02-22) — `context_builder` MCP-aware + `AUDIT_PATCH_APPLY` guardado

## Resumo

Rodada focada em avançar o `Audit Agent` para um contexto semântico mais real (MCP tools) sem abrir
superfície de mutação insegura:

1. `context_builder` passou a chamar MCP `lsp_*` e `rag_search` em modo read-only
2. runtime agora passa o `job`/escopo ao `contextBuilder`
3. `AUDIT_PATCH_APPLY` foi adicionado ao control plane com guardrails e bloqueio explícito em
   `propose_only`

## Correções / Implementações

1. `src/audit_agent/context_builder.js`

- helper `callMcpTool()` via `/api/mcp` (`tools/call`)
- probes MCP reais:
  - `lsp_diagnostics`
  - `lsp_definition`
  - `rag_search`
- modo `read_only_mcp_v1` quando MCP tools são invocados
- findings de falha para `lsp_diagnostics`/`rag_search`

2. `src/audit_agent/runtime.js`

- `collectQuickContext(job)` passa o `job` para o `contextBuilder`
- permite contexto orientado a escopo (`filePath`, `query`, `line`, `character`)

3. `src/server/domain/control_command_service.js`

- novo comando `AUDIT_PATCH_APPLY`
- guardrails:
  - exige patch aprovado
  - exige `dry_run_result_json.ok === true`
  - bloqueia por default em `propose_only`
  - `AUDIT_AGENT_PATCH_APPLY_ENABLE_UNSAFE_LOCAL=true` como gate explícito (ainda não implementa
    apply)
- comportamento atual: erro explícito/auditável (`disabled`/`not_implemented`), sem fake apply

4. Testes

- `tests/unit/audit_agent/test_audit_agent_runtime.spec.js`
  - valida passagem do `job` ao `contextBuilder`
- `tests/unit/server/test_control_command_service_audit_persistence.spec.js`
  - cobre bloqueios de `AUDIT_PATCH_APPLY`

## Testes e Gates Executados

1. `env -u NO_COLOR node --test tests/unit/audit_agent/test_audit_agent_runtime.spec.js tests/unit/server/test_control_command_service_audit_persistence.spec.js`
   -> **4/4 pass**
2. `npm run typecheck:full` -> **OK**
3. `eslint` direcionado (arquivos alterados) -> **OK**
4. `npm run audit:quick -- --triage false --progress false --eta false` -> **success**

- Run: `WAVE_AUDIT_QUICK_2026-02-22T11-48-38-596Z`
- `errors=0`, `warnings=0`, `partial=false`

## Riscos Ativos

1. `context_builder` usa MCP tools reais, mas ainda sem enriquecimento profundo (`rag_expand`,
   refs/symbols`) e sem budgets por etapa.
2. `AUDIT_PATCH_APPLY` permanece guardado (sem execução real), como planejado.
3. Falta realtime específico de `audit_jobs/findings/patches`.

## Próxima Rodada (escopo fechado)

1. Enriquecer `context_builder` com `rag_expand` e `lsp_references`/`lsp_document_symbols` sob
   budget.
2. Repos mínimos para `inference_backends` / `inference_models` + endpoints dashboard de leitura.
3. Preparar dry-run TTL/metadata para futura implementação segura de `AUDIT_PATCH_APPLY`.

---

# Wave AAG-F7/F3/F9 (2026-02-22) — `context_builder` budgeted MCP enrich + `inference_backends/models`

## Resumo

Rodada de avanço em duas frentes:

1. enriquecimento semântico do `context_builder` com chamadas MCP adicionais sob budget
2. base persistente/API de `inference_backends` e `inference_models` para configuração avançada da
   LLM local

## Correções / Implementações

1. `src/audit_agent/context_builder.js`

- orçamento MCP simples (`mcp_budget` / `AUDIT_AGENT_CONTEXT_MCP_BUDGET`)
- novas chamadas MCP read-only sob budget:
  - `rag_expand`
  - `lsp_references`
  - `lsp_document_symbols`
- `mcp_tools.budget` (limit/used/remaining)
- `mcp_tool_payloads` com payloads brutos dos tools adicionais
- findings informativos quando enriquecimento falha (`rag_expand`, `lsp_references`)

2. Repos novos `inference_*`

- `src/infra/db/inference_backend_repo.js`
- `src/infra/db/inference_model_repo.js`

3. `src/server/api/controllers/dashboard_inference.js`

- `GET /api/dashboard/inference/backends`
- `GET /api/dashboard/inference/models-db`

4. `src/server/domain/control_command_service.js`

- `INFERENCE_BACKEND_UPSERT`
- `INFERENCE_MODEL_UPSERT`
- reload explícito do `Inference Gateway` após mutações

5. Testes

- `tests/unit/audit_agent/test_audit_job_repo_and_db_store.spec.js` (repos
  `inference_backends/models`)
- `tests/unit/server/test_control_command_service_audit_persistence.spec.js` (upserts backend/model)

## Testes e Gates Executados

1. `env -u NO_COLOR node --test tests/unit/audit_agent/test_audit_job_repo_and_db_store.spec.js tests/unit/server/test_control_command_service_audit_persistence.spec.js`
   -> **6/6 pass**
2. `npm run typecheck:full` -> **OK**
3. `eslint` direcionado (arquivos alterados) -> **OK**
4. `npm run audit:quick -- --triage false --progress false --eta false` -> **success**

- Run: `WAVE_AUDIT_QUICK_2026-02-22T11-54-44-679Z`
- `errors=0`, `warnings=0`, `partial=false`

## Riscos Ativos

1. `context_builder` agora coleta mais payload; falta truncation/token budget formal para prompts
   LLM.
2. `inference_backends/models` ainda sem validação profunda de capabilities/schema e sem
   toggle/disable dedicado via command específico.
3. `AUDIT_PATCH_APPLY` continua guardado (sem execução real), conforme planejado.

## Próxima Rodada (escopo fechado)

1. Formalizar TTL/metadata de dry-run em `audit_patch_proposals` e endurecer `AUDIT_PATCH_APPLY` com
   validação temporal.
2. Expandir dashboard inference com summary/capabilities de `backends/models`.
3. Preparar job manual do `audit-agent` que use contexto MCP enriquecido para findings/patch
   proposal (sem apply).

---

# Wave AAG-F6/F9/F8 (2026-02-22) — Toggles `INFERENCE_*` + Dashboard Inference Summary/Capabilities + `dry_run_state`

## Resumo

Rodada de consolidação operacional em três frentes:

1. fechar o ciclo de gestão de inferência com toggles (`backend/model`) via control plane
2. dar visibilidade real no dashboard (`summary` + capabilities normalizadas)
3. explicitar estado de dry-run dos patches de auditoria (`missing/pending/fresh/stale/...`)

## Correções / Implementações

1. `src/server/domain/control_command_service.js`

- novos comandos:
  - `INFERENCE_BACKEND_TOGGLE`
  - `INFERENCE_MODEL_TOGGLE`
- mantém reload explícito do `Inference Gateway` após mutações
- `AUDIT_PATCH_APPLY` endurecido com validação temporal:
  - timestamp obrigatório (`validated_at_ms`/`ts`)
  - TTL válido (`ttl_ms` ou `AUDIT_PATCH_DRY_RUN_MAX_AGE_MS`)
  - rejeita dry-run expirado

2. `src/infra/db/inference_backend_repo.js`

- `setInferenceBackendEnabled(...)`

3. `src/infra/db/inference_model_repo.js`

- `setInferenceModelEnabled(...)`

4. `src/server/api/controllers/dashboard_inference.js`

- `GET /api/dashboard/inference/models-db`
  - agora retorna `capabilities_summary` e `policy_flags`
- novo `GET /api/dashboard/inference/summary`
  - counts + agregados por backend + totais de capability

5. `src/server/api/controllers/dashboard_audit.js`

- `GET /api/dashboard/audit/jobs/:id/patches`
  - adiciona `dry_run_state`
  - metadata com summary por `status` e estado de dry-run

6. `src/audit_agent/runtime.js`

- patch draft default enriquecido com `context_signals`, `context_budget`, `rag_anchor`
- `dry_run_result_json` default passa a ser explícito (`pending/required`)

7. Testes

- `tests/unit/audit_agent/test_audit_job_repo_and_db_store.spec.js`
  - toggle de `inference_backends/models` + patch summary/dry-run pending
- `tests/unit/server/test_control_command_service_audit_persistence.spec.js`
  - `INFERENCE_BACKEND_TOGGLE` e `INFERENCE_MODEL_TOGGLE`

## Testes e Gates Executados

1. `env -u NO_COLOR node --test tests/unit/audit_agent/test_audit_job_repo_and_db_store.spec.js tests/unit/server/test_control_command_service_audit_persistence.spec.js`
   -> **6/6 pass**
2. `node --check src/server/domain/control_command_service.js src/server/api/controllers/dashboard_inference.js src/server/api/controllers/dashboard_audit.js src/infra/db/inference_backend_repo.js src/infra/db/inference_model_repo.js`
   -> **OK**
3. `npm run typecheck:full` -> **OK**
4. `eslint` direcionado (arquivos alterados) -> **OK**
5. `npm run audit:quick -- --triage false --progress false --eta false` -> **success**

- Run: `WAVE_AUDIT_QUICK_2026-02-22T12-06-10-486Z`
- `errors=0`, `warnings=0`, `partial=false`

## Riscos Ativos

1. `AUDIT_PATCH_APPLY` ainda não aplica patch real (guardado por design), apesar de já validar
   approval + dry-run freshness.
2. `context_builder` MCP enriched precisa de truncation/token-budget formal antes do pipeline LLM de
   patch.
3. Faltam endpoints/fluxo de mutação no dashboard para operar `INFERENCE_*` sem terminal (API de
   leitura já existe).

## Próxima Rodada (escopo fechado)

1. Job manual `patch_suggest/bug_hunt` end-to-end com findings e patch proposal enriquecidos
   persistidos e visíveis no dashboard.
2. Base de metadados de dry-run para futura implementação de apply real (ainda sem habilitar apply).
3. Wrappers de dashboard/control para `INFERENCE_BACKEND_TOGGLE`/`INFERENCE_MODEL_TOGGLE` e
   `INFERENCE_PROFILE_VALIDATE`.

---

# Wave AAG-F9/F6 (2026-02-22) — Wrappers de Dashboard para `AUDIT_*` / `INFERENCE_*` + Fluxo manual `patch_suggest`

## Resumo

Rodada de usabilidade e integração:

1. dashboard ganhou wrappers de mutação para `AUDIT_*` e `INFERENCE_*` via control plane
2. fluxo manual `patch_suggest` via `AUDIT_JOB_CREATE` + `AUDIT_JOB_RUN` ficou coberto por teste
3. pipeline do projeto permaneceu verde

## Correções / Implementações

1. `src/server/api/controllers/dashboard_audit.js`

- wrappers novos:
  - `POST /api/dashboard/audit/jobs` (`run_now` opcional)
  - `POST /api/dashboard/audit/jobs/:id/run`
  - `POST /api/dashboard/audit/jobs/:id/cancel`
  - `POST /api/dashboard/audit/patches/:id/approve`
  - `POST /api/dashboard/audit/patches/:id/reject`
  - `POST /api/dashboard/audit/patches/:id/apply`
  - `POST /api/dashboard/audit/watch-rules`
  - `POST /api/dashboard/audit/watch-rules/:id/toggle`
- todos usando `executeCommand(...)` (sem bypass)

2. `src/server/api/controllers/dashboard_inference.js`

- wrappers novos:
  - `POST /api/dashboard/inference/profiles/validate`
  - `POST /api/dashboard/inference/backends`
  - `POST /api/dashboard/inference/backends/:id/toggle`
  - `POST /api/dashboard/inference/models`
  - `POST /api/dashboard/inference/models/:id/toggle`

3. `tests/unit/server/test_control_command_service_audit_inference.spec.js`

- novo teste de proxy `patch_suggest`:
  - cria job
  - executa run
  - valida status `WAITING_APPROVAL`

## Testes e Gates Executados

1. `env -u NO_COLOR node --test tests/unit/server/test_control_command_service_audit_inference.spec.js`
   -> **4/4 pass**
2. `node --check src/server/api/controllers/dashboard_audit.js src/server/api/controllers/dashboard_inference.js tests/unit/server/test_control_command_service_audit_inference.spec.js`
   -> **OK**
3. `npm run typecheck:full` -> **OK**
4. `eslint` direcionado (arquivos alterados) -> **OK**
5. `npm run audit:quick -- --triage false --progress false --eta false` -> **success**

- Run: `WAVE_AUDIT_QUICK_2026-02-22T12-12-41-055Z`
- `errors=0`, `warnings=0`, `partial=false`

## Riscos Ativos

1. Wrappers de dashboard existem, mas faltam telas/composables para operar o fluxo sem requests
   manuais.
2. `AUDIT_PATCH_APPLY` segue guardado (sem apply real), por design.
3. Pipeline LLM real do `Audit Agent` ainda pendente; patch proposal atual é skeleton enriquecido
   por contexto MCP.

## Próxima Rodada (escopo fechado)

1. Integrar primeiro passo real de pipeline LLM via `Inference Gateway` (`audit_agent_triage`) com
   budgets/fallback.
2. Expor wrappers adicionais de `INFERENCE_PROFILE_UPSERT` / `INFERENCE_CLIENT_POLICY_UPSERT`.
3. Preparar endpoint/dashboard para execução manual `patch_suggest` com preview de `dry_run_state`.

---

# Wave AAG-F8/F9 (2026-02-22) — `triage_llm` via Inference Gateway + Wrappers `INFERENCE_*` adicionais

## Resumo

Rodada de avanço no pipeline LLM e na operação via dashboard:

1. primeiro passo real de `triage_llm` integrado ao runtime do `Audit Agent` (via
   `Inference Gateway`, read-only, behind flag)
2. wrappers de dashboard para `INFERENCE_PROFILE_UPSERT` e `INFERENCE_CLIENT_POLICY_UPSERT`
3. pipeline e gates do projeto mantidos verdes

## Correções / Implementações

1. `src/audit_agent/triage_llm.js` (novo)

- client HTTP para `Inference Gateway` (`POST /v1/generate`)
- `clientTag = audit_agent_triage`
- prompt de triage baseado em sinais MCP/LSP/RAG do `context_builder`
- parsing JSON tolerante (`summary`, `risk_level`, `next_actions`)
- flag de ativação: `AUDIT_AGENT_TRIAGE_LLM_ENABLED`

2. `src/audit_agent/runtime.js`

- novo passo `triage_llm` no fluxo de job
- resultado persistido em `job.result_json.llm_triage`
- findings informativos de sucesso/falha (não bloqueante)

3. `src/audit_agent/main.js`

- wiring opcional de `triageClient` no runtime
- fallback seguro se módulo não carregar

4. `src/server/api/controllers/dashboard_inference.js`

- wrappers adicionais:
  - `POST /api/dashboard/inference/profiles` (`INFERENCE_PROFILE_UPSERT`)
  - `POST /api/dashboard/inference/client-policies` (`INFERENCE_CLIENT_POLICY_UPSERT`)

5. Testes

- `tests/unit/audit_agent/test_audit_agent_runtime.spec.js`
  - novo teste com stub de `triageClient` validando persistência de `llm_triage`

## Testes e Gates Executados

1. `env -u NO_COLOR node --test tests/unit/audit_agent/test_audit_agent_runtime.spec.js tests/unit/server/test_control_command_service_audit_inference.spec.js`
   -> **8/8 pass**
2. `node --check src/audit_agent/triage_llm.js src/audit_agent/runtime.js src/audit_agent/main.js src/server/api/controllers/dashboard_inference.js`
   -> **OK**
3. `npm run typecheck:full` -> **OK**
4. `eslint` direcionado (arquivos alterados) -> **OK**
5. `npm run audit:quick -- --triage false --progress false --eta false` -> **success**

- Run: `WAVE_AUDIT_QUICK_2026-02-22T12-18-04-697Z`
- `errors=0`, `warnings=0`, `partial=false`

## Riscos Ativos

1. `triage_llm` está integrado, mas desabilitado por padrão até calibrar policy/model/budgets no
   ambiente real.
2. Ainda não há patch author LLM real; patch proposal continua skeleton enriquecido por MCP.
3. Dashboard ainda não tem visão dedicada de `llm_triage` (fica em `job.result_json` / findings).

## Próxima Rodada (escopo fechado)

1. Expor resumo de `llm_triage` no detail de job (read-model/dashboard).
2. Validar preflight de policy/profile (`audit_agent_triage`) antes da chamada LLM, com fallback
   explícito.
3. Criar teste de integração do `triage_llm` com `Inference Gateway` HTTP stubado.

---

# Wave AAG-F6/F9 (2026-02-22) — `AUDIT_PATCH_APPLY_VALIDATE` + endpoints de readiness de apply

## Resumo

Rodada de hardening de governança para patch apply:

1. criação de comando canônico read-only para validar readiness de apply
   (`AUDIT_PATCH_APPLY_VALIDATE`)
2. reutilização dos mesmos guardrails do `AUDIT_PATCH_APPLY` (sem drift)
3. exposição de endpoints no dashboard para UI/API consumirem readiness sem mutação

## Correções / Implementações

1. `src/server/domain/control_command_service.js`

- novo comando `AUDIT_PATCH_APPLY_VALIDATE`
- helper central de readiness: avaliação de aprovação + dry-run TTL/freshness + guards
  branch/path/worktree + modo (`propose_only`/`unsafe_local_enabled`)
- `AUDIT_PATCH_APPLY` passou a usar a avaliação centralizada e retorna `details` estruturados em
  erros de bloqueio

2. `src/server/api/controllers/dashboard_audit.js`

- novos endpoints:
  - `GET /api/dashboard/audit/patches/:id/apply-readiness`
  - `POST /api/dashboard/audit/patches/:id/apply/validate`
- ambos retornam `patch` enriquecido + `validation`

3. `tests/unit/server/test_control_command_service_audit_persistence.spec.js`

- cobertura de `AUDIT_PATCH_APPLY_VALIDATE`
- asserts de readiness incluindo bloqueio esperado por `propose_only`

## Gates Executados

1. `env -u NO_COLOR node --test tests/unit/server/test_control_command_service_audit_persistence.spec.js`
   -> **1/1 pass**
2. `node --check src/server/domain/control_command_service.js src/server/api/controllers/dashboard_audit.js tests/unit/server/test_control_command_service_audit_persistence.spec.js`
   -> **OK**
3. `npm run typecheck:full` -> **OK**
4. `eslint` direcionado (arquivos alterados) -> **OK**
5. `npm run audit:quick -- --triage false --progress false --eta false` -> **success**

- Run: `WAVE_AUDIT_QUICK_2026-02-22T12-56-03-672Z`
- `errors=0`, `warnings=0`, `partial=false`

## Riscos Ativos

1. `AUDIT_PATCH_APPLY` segue sem apply real (501/blocked), por design V1.
2. UI ainda não consome os endpoints de readiness (API pronta; faltam telas/composables).
3. Backlog de findings de `prettier` permanece no audit quick (não bloqueante nesta rodada).

## Próxima Rodada (escopo fechado)

1. Incluir `apply_readiness` no read-model de patch detail/list (quando solicitado via query flag ou
   summary leve).
2. Preparar esqueleto de apply real (ainda blocked-by-default) consumindo a readiness centralizada.
3. Endurecer `patch_author_llm` com schema/output mode mais estrito via `Inference Gateway`.
