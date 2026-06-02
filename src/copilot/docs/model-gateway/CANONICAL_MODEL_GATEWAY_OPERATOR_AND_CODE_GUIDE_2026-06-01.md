# Canonical Model Gateway Operator And Code Guide - 2026-06-01

Este documento e o guia canonico transversal do `src/copilot/model-gateway`. Ele explica como o sistema esta
organizado, como humano ou LLM devem opera-lo, quais comandos sao seguros, quais comandos podem gastar quota, quais
camadas persistem dados, e como evoluir o runtime automatico sem voltar a quebrar as fundacoes.

Documentos ativos relacionados:

- `src/copilot/docs/model-gateway/CANONICAL_MODEL_GATEWAY_TERMINAL_AUTO_RUNTIME_ROADMAP_2026-06-01.md`
- `src/copilot/docs/model-gateway/CANONICAL_MODEL_GATEWAY_OPERATOR_RUNTIME_PLAYBOOK_2026-06-01.md`
- `scripts/model-gateway/README.md`
- `src/copilot/model-gateway/README.md`

## 1. Objetivo Operacional

O objetivo pratico e dar ao operador humano ou LLM um gateway BYOK universal, normalizado para schema OpenAI, capaz de:

- descobrir providers e modelos;
- normalizar metadados em catalogo canonico;
- manter overlays operacionais sem contaminar metadados;
- escolher rotas pre-runtime sem gastar tokens;
- aplicar policy auto explicita no terminal;
- trocar modelo dentro da mesma boundary quando permitido;
- preparar novo boot SDK quando provider/perfil mudar;
- replanejar apos falha BYOK;
- manter uma lista grande de LLMs substitutas prontas;
- registrar tudo em SQLite auditavel;
- testar o mesmo fluxo enfrentado pelo operador no terminal real.

## 2. Invariantes

- O catalogo canonico nao guarda falhas temporarias, quota temporaria, cooldown ou resultado de live turn.
- Runtime health, route decisions, automation decisions, effects, recovery attempts, handoffs, confirmations e live
  scenario runs sao overlays operacionais.
- Comandos read-only nao chamam provider, nao mutam terminal e nao consomem quota.
- Provider call real exige flag explicita ou comando terminal explicitamente mutante.
- Ollama/local/private e suportado, mas nao entra em default automatico.
- Quota SDK Copilot nao e quota BYOK.
- Segredos nunca devem aparecer em docs, logs, SQLite payloads, JSON de comandos ou artefatos live.
- Todo efeito aplicado precisa apontar para uma automation decision.
- Todo handoff precisa apontar para uma automation decision.
- Toda confirmation `session.model_changed` deve tentar se correlacionar com handoff/effect.
- Todo post-turn recovery deve aparecer como decision/effect e como recovery attempt dedicado.

## 3. Mapa De Codigo

### 3.1 Catalogo

Arquivos principais:

- `src/copilot/model-gateway/catalog/contracts.js`
- `src/copilot/model-gateway/catalog/normalizers.js`
- `src/copilot/model-gateway/catalog/openai-schema.js`
- `src/copilot/model-gateway/catalog/json-catalog-store.js`
- `src/copilot/model-gateway/catalog/sqlite-schema.js`
- `src/copilot/model-gateway/catalog/sqlite-catalog-store.js`
- `src/copilot/model-gateway/catalog/default-importers.js`
- `src/copilot/model-gateway/catalog/importers/`

Responsabilidade:

- transformar fontes heterogeneas em registros canonicos;
- preservar evidencias e fontes;
- projetar modelos para schema OpenAI-compatible;
- materializar snapshot JSON e SQLite;
- manter import runs, refresh logs, raw payload refs e conflitos.

Regra de evolucao:

- novo provider deve ter arquivo proprio em `providers/endpoints`, `providers/specs` quando aplicavel, e importer proprio;
- importers nao devem misturar metadados estaveis com saude runtime;
- dados externos incertos devem carregar source/evidence/confidence.

### 3.2 Account, Key E Quota

Arquivos principais:

- `src/copilot/model-gateway/account-access/`
- `src/copilot/model-gateway/health/`
- `src/copilot/model-gateway/probes/backoff-planner.js`

Responsabilidade:

- separar limite de conta/key de falha de modelo;
- representar cooldown, reset windows, rate-limit, insufficient credits e access denied;
- derivar overlays de runtime health ja observado;
- impedir tentativas obvias quando a key nao tem acesso ou a conta esta em bloqueio temporario conhecido.

Regra de evolucao:

- erro temporario deve ter freshness/reset;
- erro duro de acesso deve virar overlay operacional com escopo correto;
- nenhuma dessas informacoes remove modelo do catalogo canonico.

### 3.3 Eligibility E Selecao Pre-Runtime

Arquivos principais:

- `src/copilot/model-gateway/eligibility/`
- `src/copilot/model-gateway/routing/candidate-builder.js`
- `src/copilot/model-gateway/routing/selection-audit.js`
- `src/copilot/model-gateway/routing/policy-engine.js`
- `src/copilot/model-gateway/routing/local-provider-opt-in.js`

Responsabilidade:

- montar candidatos sem provider call;
- aplicar preferencias de perfil/task;
- bloquear local/private por default;
- juntar overlays account/key/runtime ja observados;
- explicar cada descarte e cada selecao.

Regra de evolucao:

- selecao pre-runtime nao executa modelo;
- vision nao deve ser criterio automaticamente excludente;
- primeiro filtro e acesso/funcionamento basico conhecido ou inferido;
- runtime proof e etapa posterior, nao substituto da coleta de metadados.

### 3.4 Runtime Selector

Arquivos principais:

- `src/copilot/model-gateway/routing/runtime-selector.js`
- `scripts/model-gateway/model-gateway-runtime-selector.mjs`

Responsabilidade:

- transformar selecao em plano de rota executavel;
- respeitar fallback profiles;
- limitar tentativas por provider;
- permitir probe apenas com opt-in;
- registrar route decisions e runtime probe/health quando executado explicitamente.

Regra de evolucao:

- dry-run deve ser seguro;
- `--execute` e `--allow-probe` devem continuar explicitos;
- resultado runtime deve alimentar overlays operacionais, nao catalogo.

### 3.5 Automacao

Arquivos principais:

- `src/copilot/model-gateway/automation/policy.js`
- `src/copilot/model-gateway/automation/decision.js`
- `src/copilot/model-gateway/automation/controller.js`
- `src/copilot/terminal/byok/gateway-auto.js`

Responsabilidade:

- carregar policy efetiva;
- produzir decision pura;
- produzir controller step;
- executar efeitos permitidos pelo terminal;
- persistir decisions, policy snapshots, effects, recovery attempts e handoffs.

Regra de evolucao:

- core de automacao permanece puro;
- terminal adapter e o unico lugar que aplica efeitos de terminal;
- policy desligada por default;
- `allow-live-set-model` e `allow-new-session` sao opt-ins separados.

### 3.6 Terminal

Arquivos principais:

- `src/copilot/terminal/commands/byok.js`
- `src/copilot/terminal/dialog/engine.js`
- `src/copilot/terminal/events/sdk-session-events.js`
- `src/copilot/terminal/frontend/`

Responsabilidade:

- expor cockpit intuitivo via `/byok gateway ...` e `/byok auto ...`;
- rodar pre-turn auto quando policy esta ligada;
- rodar post-turn recovery quando falha BYOK ocorre;
- mostrar linha curta de modelo vivo, handoff preparado, recovery e blockers;
- correlacionar `session.model_changed`.

Regra de evolucao:

- todo comando novo de operador deve aparecer no inventario canonico;
- comando mutante deve ser explicitamente nomeado como apply/switch/on/off/refresh/build;
- comando diagnostico deve ser seguro para humano e LLM rodarem sem medo.

## 4. SQLite Operacional

Schema atual: `MODEL_GATEWAY_SQLITE_SCHEMA_VERSION = 10`.

Tabelas operacionais principais:

- `copilot_model_gateway_route_decisions`
- `copilot_model_gateway_automation_decisions`
- `copilot_model_gateway_automation_policy_snapshots`
- `copilot_model_gateway_automation_effect_applications`
- `copilot_model_gateway_recovery_attempts`
- `copilot_model_gateway_sdk_session_handoffs`
- `copilot_model_gateway_sdk_session_confirmations`
- `copilot_model_gateway_live_scenario_runs`
- `copilot_model_gateway_runtime_probe_runs`
- `copilot_model_gateway_runtime_probe_results`
- `copilot_model_gateway_health_observations`

Regras:

- operational retention deve preservar as linhas mais recentes por tabela;
- payloads passam por redaction operacional;
- diagnostics deve expor contagens e ultimo registro relevante;
- live test run deve ser persistido com `criteriaTotal`, `criteriaFailed`, artefatos e status final.

## 5. Comandos Canonicos

Inventario atual: 144 comandos.

Distribuicao por fase:

- orientation: 6
- validate: 5
- prebuild: 8
- metadata: 35
- pre-runtime: 13
- selection: 17
- live-readiness: 20
- automation: 39
- runtime-probes: 1

Comandos de orientacao:

```bash
npm run model-gateway:commands
npm run model-gateway:commands:json
npm run model-gateway:ops
```

Comandos de saude read-only:

```bash
npm run model-gateway:auto:ready
npm run model-gateway:auto:doctor
npm run model-gateway:auto:proof-plan
npm run model-gateway:auto:standby
npm run model-gateway:auto:scenarios
npm run model-gateway:sqlite:diagnostics
npm run model-gateway:runtime-health:clear -- --provider=zai --model=glm-4.5-flash --profile=repo_agent
```

Quando `auto:ready` ou a decisao de automacao bloquear uma rota por falta de prova runtime, health bloqueada,
rota ausente ou prova falha, o primeiro proximo passo canonico deve ser `model-gateway:auto:proof-plan` ou
`/byok auto proof-plan`. Isso preserva a separacao entre selecao por metadados, prova runtime planejada e chamada
real de provider.

Quando a pergunta for "quais modelos ficam de prontidao para substituir o atual?", o caminho canonico e
`model-gateway:auto:standby` ou `/byok auto standby`. Essa saida lista rota selecionada e alternativas utilizaveis
com comandos separados para prova descartavel, troca live no mesmo provider, provider/persist e novo boot SDK.

Quando uma quota/cooldown resetar, ou quando uma fixture antiga tiver contaminado health real, o caminho canonico e
`model-gateway:runtime-health:clear` em preview e depois com `--apply`, ou `/byok health clear ...` no terminal.
Quando a propria decisao auto estiver em `wait_for_reset` por health/cooldown, os `nextCommands` devem incluir o
preview escopado de `runtime-health:clear` e o comando terminal equivalente, sempre usando `providerModel` da rota de
health e nao necessariamente o `selectorSyntax` usado para aplicar o modelo vivo.

Comandos de ledgers:

```bash
npm run model-gateway:auto:handoffs
npm run model-gateway:auto:confirmations
npm run model-gateway:auto:recoveries
npm run model-gateway:live:runs
```

Comandos terminal equivalentes:

```text
/byok gateway commands
/byok auto policy
/byok auto status profile:repo_agent
/byok auto doctor profile:repo_agent
/byok auto explain profile:repo_agent
/byok auto history 10
/byok auto handoffs 10
/byok auto confirmations 10
/byok auto proof-plan profile:repo_agent 12
/byok auto standby profile:repo_agent 12
/byok auto recovery-fixture profile:repo_agent provider:zai model:glm-4.5-flash failure:rate-limit
/byok health clear provider:zai model:glm-4.5-flash profile:repo_agent
/byok probe agent provider:zai model:glm-4.5-flash timeout:20000
/byok auto recoveries 10
```

## 6. Defaults E Configuracao

Default seguro:

- auto desligado;
- local/private bloqueado;
- provider calls bloqueadas;
- live set-model bloqueado;
- new session handoff bloqueado.

Opt-in para live model na mesma boundary:

```text
/byok auto on profile:repo_agent allow-live-set-model
```

Opt-in para nova sessao quando provider/perfil muda:

```text
/byok auto on profile:repo_agent allow-live-set-model allow-new-session
```

Variaveis principais:

- `COPILOT_BYOK_GATEWAY_AUTO`
- `COPILOT_BYOK_GATEWAY_AUTO_POLICY`
- `COPILOT_BYOK_GATEWAY_AUTO_PROFILES`
- `COPILOT_BYOK_GATEWAY_AUTO_ALLOW_LIVE_SET_MODEL`
- `COPILOT_BYOK_GATEWAY_AUTO_ALLOW_NEW_SESSION`
- `COPILOT_BYOK_GATEWAY_AUTO_ALLOW_PROVIDER_PROBES`
- `COPILOT_BYOK_GATEWAY_AUTO_ALLOW_LOCAL_PRIVATE`
- `COPILOT_BYOK_GATEWAY_AUTO_ACCOUNT_WIDE_FAILURE_KINDS`

## 7. Fluxo Diario Do Operador

1. Rodar `npm run model-gateway:ops`.
2. Rodar `npm run model-gateway:auto:ready`.
3. Rodar `npm run model-gateway:auto:doctor`.
4. No terminal, rodar `/byok gateway commands`.
5. No terminal, rodar `/byok auto doctor profile:repo_agent`.
6. Se houver blocker, corrigir a camada apontada.
7. Se quiser auto, usar `/byok auto on ...`.
8. Antes de BYOK real, validar recovery sem provider call com `/byok auto recovery-fixture profile:repo_agent provider:zai model:glm-4.5-flash failure:rate-limit`; por padrao a health gravada e sintetica (`model-gateway-fixture:*`), e rota real exige `real-health`.
9. Se uma falha BYOK ocorrer, consultar `/byok auto recoveries 10` e `/byok gateway health sqlite`.
10. Antes de BYOK real, rodar live control e fixture.

## 8. Escada De Testes Live

Read-only:

```bash
npm run model-gateway:auto:ready
npm run model-gateway:auto:doctor
npm run model-gateway:auto:scenarios
npm run model-gateway:live:readiness
npm run model-gateway:live:plan
```

Terminal real sem turno:

```bash
npm run model-gateway:live:auto-probe
npm run model-gateway:live:llm-b -- --no-pr --timeout-ms=180000
```

Fixture BYOK:

```bash
npm run model-gateway:live:llm-b -- --byok-probe --byok-fixture --no-pr --timeout-ms=240000
```

BYOK real no-PR, somente apos gates verdes e decisao consciente de gastar quota:

```bash
npm run model-gateway:live:llm-b -- --byok-real --byok-real-route-profile=repo_agent --byok-real-route-fallback-profiles=code,tool_agent --byok-real-route-selection-policy=prefer_runtime_proved --byok-real-route-execute --byok-real-route-allow-probe --byok-real-route-temporary-failure-cooldown-ms=900000 --byok-real-route-max-attempts=8 --byok-real-route-max-attempts-per-provider=4 --byok-real-route-timeout-ms=20000 --no-pr --timeout-ms=240000
```

BYOK real full, somente apos no-PR real passar:

```bash
npm run model-gateway:live:llm-b -- --byok-real --byok-real-route-profile=repo_agent --byok-real-route-fallback-profiles=code,tool_agent --byok-real-route-selection-policy=prefer_runtime_proved --byok-real-route-execute --byok-real-route-allow-probe --byok-real-route-temporary-failure-cooldown-ms=900000 --byok-real-route-max-attempts=8 --byok-real-route-max-attempts-per-provider=4 --byok-real-route-timeout-ms=20000 --timeout-ms=900000
```

## 9. Evidencia Atual

Validado nesta linha:

- `npm run model-gateway:commands:json`: 144 comandos.
- `npm run model-gateway:auto:recoveries`: PASS, read-only, rows=7, recovery fixture `rate-limit` aplicada.
- `npm run model-gateway:auto:doctor`: PASS operacional de leitura; gate auto pode ficar bloqueado quando health/cooldown operacional pedir prova ou limpeza.
- `npm run model-gateway:auto:proof-plan`: PASS, read-only, gerou comandos explicitos `/byok probe ... provider:<id> model:<id>`.
- `npm run model-gateway:auto:standby`: PASS, read-only, lista rotas de prontidao e comandos de substituicao sem chamar provider.
- `npm run model-gateway:auto:scenarios`: PASS, 12 cenarios, `auto_standby` ok, sem provider call.
- `npx vitest run --config vitest.copilot.config.js tests/unit/copilot/model-gateway/test_model_gateway_contracts.spec.js`: 215 PASS.
- `npx vitest run --config vitest.copilot.config.js tests/unit/copilot/terminal/test_commands_byok.spec.js`: 101 PASS.
- `npm run model-gateway:live:auto-probe`: PASS, incluindo `/byok auto standby`.
- Artefato live: `artifacts/terminal-live/2026-06-02T00-21-42-083Z/summary.md`.
- `npm run model-gateway:live:runs`: ultimo run `terminal-live:2026-06-02T00-21-42-091Z:auto_probe`, `criteriaTotal=30`, `criteriaFailed=0`.
- `/byok auto status` e `/byok auto doctor` agora mostram resumo de alternativas: usable/evaluated, quantidade de providers e principais blockers.
- `/byok auto status` e `/byok auto doctor` agora sugerem comandos `provar:` para promover candidatos bloqueados por agent probe ausente/nao verificado.
- `/byok auto recovery-fixture ... provider:zai model:glm-4.5-flash failure:rate-limit` gravou recovery, runtime health sintetica e espelho SQLite sem chamada ao provider.
- `/byok probe agent provider:<provider> model:<provider-model> timeout:20000` prova rota explicita do selector e alimenta o runtime health usado por `repo_agent`/`tool_agent`.
- `npm run model-gateway:lint`: PASS.

## 10. Proximas Lacunas De Alto Retorno

- Expandir fixture live de post-turn failure/cooldown/fallback para mais failure kinds e fallback profiles.
- Resolver a lacuna estrutural revelada pelo auto-probe: `repo_agent` pode ficar com `usable=0/78` quando exige agent-probe verificado e muitas rotas ainda estao `agent_probe_missing` ou `agent_probe_not_verified`.
- Criar fixture live de pre-turn apply dentro da mesma boundary.
- Criar fixture live de `session.model_changed` correlacionada com handoff.
- Criar cockpit visual preparado/live/confirmed mais explicito.
- Fortalecer redaction audit especifico para todos os ledgers operacionais novos.
- Rodar BYOK real no-PR apenas depois dos fixtures acima.
- Evoluir selector para explicar account-wide exclusions e recovery scopes na mesma tela.

## 11. Como Evoluir Sem Regressao

Checklist para cada mudanca:

- [ ] O comando novo entrou em `canonical-commands.js`.
- [ ] O comando novo entrou em `package.json` ou `Makefile` quando aplicavel.
- [ ] O comando terminal equivalente existe quando for operavel por humano.
- [ ] O script vive em `scripts/model-gateway/`.
- [ ] O barril `scripts/model-gateway/index.mjs` foi atualizado.
- [ ] A camada SQLite tem retention e diagnostics quando persistir dados.
- [ ] Tests focados cobrem schema/store/terminal.
- [ ] Live probe cobre a UX quando o operador precisa ver o comando no terminal.
- [ ] Documentos ativos foram atualizados.
- [ ] Segredos continuam redigidos.
