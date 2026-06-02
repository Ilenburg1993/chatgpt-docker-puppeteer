# Canonical Model Gateway Operational And Code Reference - 2026-06-02

Este documento e a referencia canonica atual para operar, entender, testar e evoluir o `src/copilot/model-gateway`.
Ele consolida o que antes estava espalhado em roadmaps, playbooks e notas de migracao. Os documentos anteriores continuam
como historico, mas este arquivo deve ser o primeiro ponto de leitura para operador humano, LLM operadora e engenheiro que
precise alterar codigo.

## 1. Objetivo

O model-gateway existe para dar ao terminal BYOK uma camada universal de metadados, selecao e operacao de modelos. Ele
normaliza providers diferentes para uma superficie compativel com OpenAI, preserva metadados canonicos, separa fatos de
runtime, prepara rotas substitutas, e oferece comandos intuitivos para trocar, provar e recuperar modelos.

O resultado esperado e:

- um banco de metadados rico e normalizado;
- uma camada de account/key/quota/rate-limit separada do catalogo;
- selecao pre-runtime antes de qualquer chamada real;
- selecao runtime baseada em provas e falhas ja observadas;
- standby list persistivel para substituicao rapida;
- operador humano e LLM usando os mesmos comandos;
- testes live no mesmo ambiente do operador;
- defaults que nao selecionam Ollama/local privado salvo pedido explicito;
- logs, ledgers e artifacts suficientes para diagnostico sem expor segredos.

## 2. Escopo De Codigo

O escopo primario e `src/copilot/model-gateway/`.

O escopo de integracao direta inclui:

- `src/copilot/terminal/byok/`
- `src/copilot/terminal/commands/byok.js`
- `scripts/model-gateway/`
- `tests/unit/copilot/model-gateway/`
- `tests/unit/copilot/terminal/test_commands_byok.spec.js`
- `src/copilot/docs/model-gateway/`

Mudancas fora desses caminhos devem ser tratadas como suspeitas ate haver motivo claro. O model-gateway nao deve
reescrever o SDK, nem criar um runtime paralelo. Ele decide, explica e projeta provider/model; a sessao SDK continua
sendo a fronteira de criacao, retomada e execucao do dialogo.

## 3. Principios

1. Metadados canonicos nao sao runtime.
2. Runtime health nao altera metadados canonicos.
3. Account/key/quota/rate-limit sao overlays operacionais.
4. Provider calls exigem opt-in claro.
5. Comandos read-only nao chamam provider e nao mutam terminal.
6. Ollama/local privado e suportado, mas nunca selecionado por default.
7. Troca live de modelo so e segura dentro da mesma boundary BYOK.
8. Troca de provider, profile ou boundary exige preparacao de nova sessao SDK.
9. Toda decisao automatica deve ser explicavel antes de aplicar efeito.
10. Toda aplicacao de efeito deve gerar ledger operacional.
11. Toda falha de turno deve virar health/recovery operacional, nao apagamento de catalogo.
12. Todo comando operador-facing deve estar no inventario canonico.
13. Scripts internos devem ser acessados por runner/barrel, nao por caminhos fisicos soltos.
14. Segredos nunca podem aparecer em stdout, docs, artifacts ou payload SQLite.

## 4. Camadas

```text
provider importers
  -> canonical catalog JSON
  -> normalized SQLite catalog projection
  -> account/key overlays
  -> quota/rate-limit/runtime health overlays
  -> pre-runtime selection
  -> runtime selector
  -> standby plan
  -> automation decision
  -> terminal controller effects
  -> SDK session/model boundary
  -> probes/live turn
  -> post-turn health and recovery
  -> persisted ledgers and live artifacts
```

### 4.1 Catalogo Canonico

O catalogo canonico e o estado normalizado de providers/modelos. Ele vive em JSON e pode ser espelhado para SQLite.
Ele contem evidencias, projections, route options, account overlays e decisoes de eligibility. Ele nao deve conter
falhas temporarias de runtime.

Arquivos principais:

- `catalog/contracts.js`
- `catalog/importers/`
- `catalog/normalizers.js`
- `catalog/openai-schema.js`
- `catalog/json-catalog-store.js`
- `catalog/sqlite-catalog-store.js`
- `catalog/sqlite-schema.js`

### 4.2 Importers

Cada provider deve ter importer proprio quando houver endpoint, documento ou fonte distinta. O objetivo e coletar o maximo
de metadados possivel antes de runtime. Providers com OpenAI-compatible endpoint tambem precisam registrar wire API,
base URL, selector syntax, route layer, pricing, limits, modalities, tools, reasoning e status de acesso quando disponivel.

Importers nao devem executar probes. Eles coletam metadados e, quando autenticados, podem coletar account/key facts que
continuam separados do runtime.

### 4.3 Account, Key, Quota E Rate Limit

Account/key e um plano volatil. O operador pode ter chave valida hoje e sem credito amanha. O catalogo pode listar um
modelo excelente, mas a selecao deve exclui-lo antes do runtime se a key atual nao tiver acesso, estiver sem credito ou
estiver em cooldown.

Arquivos principais:

- `account-access/limits.js`
- `account-access/reset-windows.js`
- `account-access/runtime-overlays.js`
- `account-access/sdk-quota.js`
- `account-access/resolver.js`
- `account-access/explain.js`

### 4.4 Pre-Runtime Selection

Pre-runtime selection usa catalogo, eligibility, account overlays e policy. Ela nao roda modelos. Ela responde: "o que
vale tentar?". O runtime vem depois.

Arquivos principais:

- `routing/policy-engine.js`
- `routing/selection-audit.js`
- `routing/candidate-builder.js`
- `routing/task-profiles.js`

### 4.5 Runtime Selector

Runtime selector usa a selecao efetiva e runtime health ja observado para escolher rota operacional. Ele tambem produz
alternativas e standby.

Arquivos principais:

- `routing/runtime-selector.js`
- `routing/health-routing.js`
- `health/provider-health.js`
- `health/runtime-health-diff.js`

Contratos importantes:

- `buildModelGatewayRuntimeSelectorPlan`
- `buildModelGatewayRuntimeStandbyRoutes`
- `buildModelGatewayRuntimeStandbyPlan`
- `executeModelGatewayRuntimeSelectorPlanWithFallbacks`

### 4.6 Standby Plan

Standby plan e a fila operacional de substitutos. Ele contem rota selecionada e alternativas, com comandos explicitos
para provar, trocar modelo no mesmo provider, persistir provider/model e preparar novo boot SDK.

O standby pode ser:

- gerado agora sem persistir;
- persistido no SQLite operacional;
- lido depois sem recalcular selector.

Comandos:

```bash
npm run model-gateway:auto:standby -- --profile=repo_agent --limit=12
npm run model-gateway:auto:standby -- --profile=repo_agent --limit=12 --write-sqlite
npm run model-gateway:auto:standby -- --profile=repo_agent --read-sqlite --json
```

Terminal:

```text
/byok auto standby profile:repo_agent 12
/byok auto standby persisted profile:repo_agent 12
```

Tabela SQLite:

```text
copilot_model_gateway_standby_plans
```

### 4.7 Automation Decision

A decisao automatica e pura. Ela nao muta env, nao chama provider e nao toca a sessao SDK. Ela decide se o proximo passo
e manter, trocar modelo live, preparar nova sessao, esperar reset ou pedir intervencao manual.

Arquivos principais:

- `automation/decision.js`
- `automation/controller.js`
- `automation/policy.js`
- `terminal/byok/gateway-auto.js`

Comandos:

```bash
npm run model-gateway:auto:status -- --profile=repo_agent
npm run model-gateway:auto:status -- --profile=repo_agent --write-sqlite
```

Terminal:

```text
/byok auto status profile:repo_agent
/byok auto record profile:repo_agent
/byok auto apply profile:repo_agent allow-live-set-model
/byok auto switch profile:repo_agent
```

## 5. SQLite

SQLite tem duas funcoes:

1. Projecao normalizada do catalogo.
2. Historico operacional para runtime, automacao, recoveries, handoffs, confirmations, standby e live runs.

Schema atual: `MODEL_GATEWAY_SQLITE_SCHEMA_VERSION = 11`.

Tabelas operacionais importantes:

- `copilot_model_gateway_runtime_probe_runs`
- `copilot_model_gateway_runtime_probe_results`
- `copilot_model_gateway_health_observations`
- `copilot_model_gateway_route_decisions`
- `copilot_model_gateway_automation_decisions`
- `copilot_model_gateway_automation_policy_snapshots`
- `copilot_model_gateway_automation_effect_applications`
- `copilot_model_gateway_recovery_attempts`
- `copilot_model_gateway_sdk_session_handoffs`
- `copilot_model_gateway_sdk_session_confirmations`
- `copilot_model_gateway_standby_plans`
- `copilot_model_gateway_live_scenario_runs`
- `copilot_model_gateway_refresh_log_events`

Comandos:

```bash
npm run model-gateway:sqlite:diagnostics -- --json
npm run model-gateway:sqlite:retention -- --json
npm run model-gateway:sqlite:retention:apply -- --json
```

Retencao operacional nao deve apagar catalogo canonico ativo.

## 6. Comandos Canônicos

O inventario canonico vive em:

```text
src/copilot/model-gateway/commands/canonical-commands.js
```

Para listar:

```bash
npm run model-gateway:commands
npm run model-gateway:commands:json
npm run model-gateway:scripts
```

Os scripts fisicos vivem em `scripts/model-gateway/commands/`, mas consumidores devem preferir:

```bash
node scripts/model-gateway/run.mjs <script-id> [args...]
npm run model-gateway:<nome>
make model-gateway-<nome>
```

## 7. Cockpits

### 7.1 Ops

```bash
npm run model-gateway:ops
```

Mostra database, readiness, automacao e inventario. E read-only.

### 7.2 Operator Ready

```bash
npm run model-gateway:operator-ready
/byok gateway operator-ready profile:repo_agent
```

Agrega SQLite diagnostics, auto-ready, runtime selector, standby, standby persistido, runtime health diff e live scenario
runs recentes. Deve ser o primeiro comando para operador humano ou LLM. O JSON separa `nextSafeCommands` de
`liveCommands`, porque alguns comandos live podem consumir provider/quota. O caminho package evita chamar `ops` por
dentro para nao duplicar readiness e automacao.

### 7.3 Auto Doctor

```bash
npm run model-gateway:auto:doctor -- --profile=repo_agent
/byok auto doctor profile:repo_agent
```

Explica policy efetiva, decision, ledgers e proximos passos.

## 8. Configuracao

### 8.1 Env Principal

O arquivo operacional esperado e `.env.local`. Scripts usam `scripts/model-gateway/lib/env.mjs` quando precisam carregar
env local.

### 8.2 Profiles

Profiles descrevem tarefa, nao vendor. Exemplos:

- `repo_agent`
- `code`
- `tool_agent`
- `local_private`
- `local_private_strict`

Provider/preset nao deve virar profile implicito.

### 8.3 Ollama/Local

Ollama/local privado e suportado. Ele nao deve ser selecionado por default. Entra apenas por pedido explicito do operador,
como profile local, filtro local ou opt-in equivalente.

### 8.4 Policy De Automacao

Defaults sao conservadores. Efeitos reais exigem autorizacao.

Variaveis e arquivo de policy sao lidos por:

- `readModelGatewayRuntimeAutomationEffectivePolicy`
- `explainModelGatewayRuntimeAutomationPolicySources`
- `validateModelGatewayRuntimeAutomationPolicy`

Terminal:

```text
/byok auto on profile:repo_agent allow-live-set-model
/byok auto on profile:repo_agent allow-live-set-model allow-new-session
/byok auto off
```

## 9. Fluxo Operacional Recomendado

### 9.1 Antes De Qualquer Runtime

```bash
npm run model-gateway:operator-ready
npm run model-gateway:auto:scenarios -- --profile=repo_agent --json
npm run model-gateway:runtime-selector -- --fail --profile=repo_agent
npm run model-gateway:auto:standby -- --profile=repo_agent --limit=12
```

### 9.2 Persistir Standby

```bash
npm run model-gateway:auto:standby -- --profile=repo_agent --limit=12 --write-sqlite
npm run model-gateway:auto:standby -- --profile=repo_agent --read-sqlite --json
```

### 9.3 Provar Candidato

```text
/byok auto proof-plan profile:repo_agent 12
/byok probe agent provider:<provider> model:<model> timeout:20000
```

### 9.4 Aplicar Troca

Mesmo provider/boundary:

```text
/byok auto apply profile:repo_agent allow-live-set-model
```

Nova sessao SDK:

```text
/session sdk next new
/byok provider <preset> <model>
/byok persist provider
```

### 9.5 Falha Ou Quota

```text
/byok auto recovery-fixture profile:repo_agent provider:<provider> model:<model> failure:rate-limit
/byok health clear provider:<provider> model:<model> profile:repo_agent
```

CLI equivalente:

```bash
npm run model-gateway:runtime-health:diff -- --write-snapshot --fail-on-regression
npm run model-gateway:runtime-health:clear -- --provider=<provider> --model=<model> --profile=repo_agent
npm run model-gateway:runtime-health:clear -- --provider=<provider> --model=<model> --profile=repo_agent --apply
```

## 10. Live Tests

Live tests devem usar o mesmo ambiente do operador. Nao devem depender de caminhos antigos.

Runner atual:

```bash
npm run model-gateway:live:llm-b -- --no-pr --timeout-ms=180000
```

Planos e readiness:

```bash
npm run model-gateway:live:readiness -- --fail
npm run model-gateway:live:plan
npm run model-gateway:auto:scenarios -- --profile=repo_agent --json
```

`model-gateway:auto:scenarios` executa gates read-only independentes em paralelo e deve permanecer abaixo de 60s no
ambiente de operador para continuar utilizavel por LLMs. Em 2026-06-02, apos a paralelizacao, rodou em cerca de 34s.

Cenarios:

```bash
npm run model-gateway:live:llm-b -- --no-pr --timeout-ms=180000
npm run model-gateway:live:llm-b -- --byok-probe --byok-fixture --no-pr --timeout-ms=240000
npm run model-gateway:live:auto-probe
```

Real provider deve vir depois dos gates read-only e fixture:

```bash
npm run model-gateway:live:llm-b -- --byok-real --byok-real-route-profile=repo_agent --byok-real-route-fallback-profiles=code,tool_agent --byok-real-route-selection-policy=prefer_runtime_proved --byok-real-route-execute --byok-real-route-allow-probe --byok-real-route-temporary-failure-cooldown-ms=900000 --byok-real-route-max-attempts=8 --byok-real-route-max-attempts-per-provider=4 --byok-real-route-timeout-ms=20000 --no-pr --timeout-ms=240000
```

## 11. Validadores

Validadores focados devem ser preferidos durante desenvolvimento:

```bash
npm run model-gateway:lint
npm run model-gateway:test:contracts
npm run model-gateway:test:terminal
```

Typecheck strict global ainda inclui areas MCP/Cloudflare fora do model-gateway. Quando rodado, diferencie erros nos
arquivos tocados de erros legados fora do escopo.

## 12. Testes Unitarios Importantes

- `tests/unit/copilot/model-gateway/test_model_gateway_contracts.spec.js`
- `tests/unit/copilot/terminal/test_commands_byok.spec.js`

Esses testes protegem:

- inventario canonico;
- barrels e runner;
- SQLite schema/store;
- standby plan;
- terminal BYOK;
- comandos operator-ready;
- leitura persistida de standby.

## 13. Evidencias E Artifacts

Live artifacts ficam em:

```text
artifacts/terminal-live/
```

Live runs podem ser consultados por:

```bash
npm run model-gateway:live:runs
```

O cockpit deve, progressivamente, apontar artifact paths relevantes para operador e LLM.

`model-gateway:ops`, `model-gateway:operator-ready` e `/byok gateway operator-ready` devem mostrar:

- total de live runs persistidos;
- ultimo scenario kind/status;
- artifact `summary.md` recente;
- lista curta dos lives mais recentes;
- comandos live canonicos separados dos comandos read-only seguros.

Evidencias recentes desta sessao:

- [x] 2026-06-02T02:44:38.197Z - `npm run model-gateway:live:auto-probe` passou, exibiu cockpit, standby,
  recovery fixture, ledger, SSE e error tracker limpo.
- [x] Artifact: `artifacts/terminal-live/2026-06-02T02-44-38-191Z/summary.md`.
- [x] 2026-06-02T02:45:10.607Z - `npm run model-gateway:live:llm-b -- --no-pr --timeout-ms=180000`
  passou como controle terminal sem turno.
- [x] Artifact: `artifacts/terminal-live/2026-06-02T02-45-10-607Z/summary.md`.
- [x] 2026-06-02T02:45:29.927Z - `npm run model-gateway:live:llm-b -- --byok-probe --byok-fixture --no-pr --timeout-ms=240000`
  passou com fixture OpenAI-compatible, troca de perfil/modelo e redacao de secrets.
- [x] Artifact: `artifacts/terminal-live/2026-06-02T02-45-29-920Z/summary.md`.
- [x] 2026-06-02T02:45:55.246Z - `npm run model-gateway:live:llm-b -- --byok-real ... --no-pr`
  passou com rota `repo_agent -> kilo-code:kilo-auto/free`, chat, streaming, JSON, agent e shortlist agent OK.
- [x] Artifact: `artifacts/terminal-live/2026-06-02T02-45-55-239Z/summary.md`.
- [x] O probe vision real registrou falha HTTP 400 como capacidade especifica nao provada, sem degradar chat/agent.
- [x] O evento `quota.warning` do side-channel GitHub Copilot apareceu em SSE e metrics, mas foi classificado como
  historico/nao-BYOK quando BYOK estava ativo.

## 14. Bugs E Lacunas Atuais

- Presets `operator_manual`, `llm_operator_guarded`, `auto_same_boundary` e `auto_prepare_new_session` ainda precisam ser
  consolidados como policy clara.
- Standby ainda precisa de fluxo manual por rank/item para aplicar ou preparar troca.
- Fallback selected after failure ainda precisa ser registrado de forma mais rica nos ledgers.
- Confirmacao de novo boot SDK ainda precisa ser melhor correlacionada com handoff.
- Cockpit ainda deve mostrar resetAt/nextRetry por rota bloqueada.
- Live real com turno completo ainda precisa ser executado depois que o fluxo de fallback em falha real estiver fechado.
- Capabilities como vision devem continuar como dimensoes de health/capability, sem virar criterio excludente universal.
- `auto:scenarios` agrega muitos gates e passou de 60s no ambiente atual; vale reduzir latencia sem perder cobertura.

## 15. Checklist Para Alteracoes Futuras

- [ ] Atualizar este documento quando comandos ou camadas mudarem.
- [ ] Atualizar inventario canonico para todo comando operador-facing.
- [ ] Atualizar scripts README quando runner ou IDs mudarem.
- [ ] Adicionar teste unitario focado para contratos novos.
- [ ] Rodar lint focado.
- [ ] Rodar teste terminal ou model-gateway quando tocar nesses fluxos.
- [ ] Rodar live readiness antes de live real.
- [ ] Nao promover local/Ollama para defaults.
- [ ] Nao misturar runtime health com catalogo canonico.
- [ ] Nao expor segredos.
