# Canonical Model Gateway Operator Runtime Playbook - 2026-06-01

Este arquivo e o playbook operacional para humano ou LLM operar o `src/copilot/model-gateway` no terminal. Ele nao
substitui o roadmap de implementacao; ele transforma a arquitetura atual em fluxo claro de uso, diagnostico, selecao,
automacao e teste live.

Roadmap ativo de implementacao:

- `src/copilot/docs/model-gateway/CANONICAL_MODEL_GATEWAY_TERMINAL_AUTO_RUNTIME_ROADMAP_2026-06-01.md`
- `src/copilot/docs/model-gateway/CANONICAL_MODEL_GATEWAY_OPERATOR_AND_CODE_GUIDE_2026-06-01.md`

Guias historicos:

- `src/copilot/docs/model-gateway/CANONICAL_MODEL_GATEWAY_BYOK_NEXT_GUIDE_2026-05-26.md`
- `src/copilot/docs/model-gateway/CANONICAL_MODEL_GATEWAY_BYOK_UNIVERSAL_GUIDE_2026-05-25.md`
- `src/copilot/docs/model-gateway/CANONICAL_MODEL_GATEWAY_AUTO_RUNTIME_OPERABILITY_ROADMAP_2026-06-01.md`
- `src/copilot/docs/model-gateway/CANONICAL_MODEL_GATEWAY_OPERATIONAL_AUTOMATION_ROADMAP_2026-06-01.md`
- `src/copilot/docs/model-gateway/CANONICAL_MODEL_GATEWAY_RUNTIME_AUTOMATION_ROADMAP_2026-06-01.md`

## 1. Objetivo

O objetivo pratico e permitir que o operador humano ou outra LLM tenha um sistema pronto para:

- descobrir e normalizar metadados de providers/modelos;
- manter um banco canonico sem contaminacao por falhas temporarias;
- manter overlays operacionais de account/key/quota/rate-limit/runtime health;
- escolher uma rota pre-runtime sem gastar tokens;
- preparar uma rota runtime sem executar o modelo por acidente;
- ativar automacao terminal com policy explicita;
- trocar modelo dentro da mesma boundary quando permitido;
- preparar novo boot SDK quando provider/perfil mudar;
- replanejar apos falhas de BYOK;
- evitar repetir imediatamente uma rota quebrada;
- registrar decisions, effects, recovery attempts, handoffs e confirmations;
- testar tudo em escada, primeiro sem PR, depois com fixture, depois com BYOK real.

## 2. Principios

- O catalogo canonico e sobre fatos relativamente estaveis de providers/modelos.
- Runtime health e quota sao fatos operacionais temporarios, nao metadados canonicos.
- Read-only deve ser read-only de verdade: sem provider call, sem terminal mutation, sem catalog commit.
- Runtime real so acontece com flag explicita ou comando terminal que o operador escolheu.
- Ollama/local/private e suportado, mas nao e selecionado por default.
- Quota do GitHub Copilot SDK nao e quota BYOK.
- Uma failure BYOK nao deve consumir Premium Request do SDK Copilot.
- Segredos devem aparecer apenas como referencias/redactions, nunca em logs, docs ou SQLite.
- Toda troca automatica precisa ser explicavel antes de ser aplicada.
- Toda aplicacao de efeito precisa apontar para uma automation decision.
- Toda confirmation de `session.model_changed` deve tentar se correlacionar com handoff/effect.

## 3. Camadas

### 3.1 Metadata DB

Responsavel por:

- provider records;
- model records;
- sources;
- evidence;
- projections;
- OpenAI-compatible schema;
- import runs;
- refresh logs;
- catalog integrity.

Comandos principais:

```bash
npm run model-gateway:metadata:build:plan
npm run model-gateway:metadata:build:preview
npm run model-gateway:metadata:build
npm run model-gateway:refresh:plan -- --provider=openrouter --force
npm run model-gateway:refresh -- --provider=openrouter --force
npm run model-gateway:catalog:integrity
```

Regra: runtime, quota e falhas temporarias nunca devem alterar o catalogo canonico.

### 3.2 Operational SQLite

Responsavel por:

- catalog snapshot materializado;
- route decisions;
- runtime health;
- runtime probes ja observadas;
- account/key overlays;
- automation decisions;
- automation effect applications;
- post-turn recovery attempts;
- automation policy snapshots;
- SDK session handoffs;
- SDK model-change confirmations.
- live scenario runs.

Comandos principais:

```bash
npm run model-gateway:sqlite:diagnostics
npm run model-gateway:runtime-health:mirror
npm run model-gateway:runtime-health:diff
npm run model-gateway:sqlite:retention -- --json
npm run model-gateway:sqlite:retention:apply -- --json
npm run model-gateway:live:runs
```

Regra: tabelas operacionais podem expirar, sofrer retention e refletir janelas de reset. O catalogo nao.

### 3.3 Pre-runtime Selection

Responsavel por escolher candidatos antes de rodar modelo:

- acesso configurado por env/profile;
- provider readiness;
- bloqueios local/private;
- overlays account/key;
- cooldown/reset windows;
- runtime proof ja existente, se policy exigir;
- custo, capacidade, contexto, safety e perfil.

Comandos principais:

```bash
npm run model-gateway:selection:audit
npm run model-gateway:selection:effective
npm run model-gateway:selection:effective:trace
npm run model-gateway:selection:trace-diff
npm run model-gateway:runtime-selector
```

Regra: selecao pre-runtime nao deve chamar provider.

### 3.4 Runtime Selector

Responsavel por montar o plano que o terminal ou runner live pode executar:

- profile primario;
- fallback profiles;
- max attempts;
- max attempts per provider;
- cooldown temporario;
- selection policy;
- opt-in de probe;
- handoff env completo;
- efeitos pretendidos.

Comando base:

```bash
npm run model-gateway:runtime-selector
```

Comando real somente quando intencional:

```bash
npm run model-gateway:runtime-selector -- --execute --allow-probe
```

Regra: `--execute` e `--allow-probe` devem ser escolhas explicitas.

### 3.5 Automation

Responsavel por converter selecao em decisao e depois em efeitos:

- pure automation decision;
- controller step;
- terminal effect executor;
- policy snapshots;
- effect ledger;
- handoff ledger.

Comandos principais:

```bash
npm run model-gateway:auto:status
npm run model-gateway:auto:ready
npm run model-gateway:auto:doctor
npm run model-gateway:auto:explain
npm run model-gateway:auto:handoffs
npm run model-gateway:auto:confirmations
npm run model-gateway:auto:recoveries
npm run model-gateway:auto:proof-plan
npm run model-gateway:auto:standby
npm run model-gateway:auto:scenarios
npm run model-gateway:runtime-health:clear -- --provider=zai --model=glm-4.5-flash --profile=repo_agent
npm run model-gateway:live:runs
```

Regra: `auto:status`, `auto:ready`, `auto:doctor`, `auto:explain`, `auto:handoffs`, `auto:confirmations`,
`auto:recoveries`, `auto:proof-plan`, `auto:standby` e `auto:scenarios` nao devem chamar provider nem mutar terminal.

Regra de bloqueio: quando a decisao auto encontra `runtime_proof_required`, rota bloqueada, health runtime falha
ou candidato sem selecao, os `nextCommands` devem apontar primeiro para `model-gateway:auto:proof-plan` e para
`/byok auto proof-plan`, antes de qualquer prova live explicita.

Regra de prontidao: `model-gateway:auto:standby` e `/byok auto standby` mostram substitutos ja derivados do selector,
separando comandos de prova, troca live no mesmo provider, provider/persist e novo boot SDK.

Regra de limpeza: `model-gateway:runtime-health:clear` e `/byok health clear` removem apenas health operacional, nao
metadados canônicos. O script package e dry-run por padrao; `--apply` e obrigatorio para mutar.
Regra de decisao: quando `auto:status`, `auto:doctor` ou o cockpit terminal produzirem `wait_for_reset`, os
`nextCommands` devem listar `runtime-health:diff`, o preview escopado de `runtime-health:clear`, o equivalente
`/byok health clear ...` e entao o selector. Isso torna reset de quota/cooldown uma acao visivel, nao uma suposicao.

### 3.6 Terminal

Responsavel pela experiencia viva do operador:

```text
/byok gateway commands
/byok auto policy
/byok auto status profile:repo_agent
/byok auto doctor profile:repo_agent
/byok auto explain profile:repo_agent
/byok auto record profile:repo_agent
/byok auto apply profile:repo_agent allow-live-set-model
/byok auto switch profile:repo_agent
/byok auto handoffs 10
/byok auto confirmations 10
/byok auto proof-plan profile:repo_agent 12
/byok auto standby profile:repo_agent 12
/byok auto recovery-fixture profile:repo_agent provider:zai model:glm-4.5-flash failure:rate-limit
/byok health clear provider:zai model:glm-4.5-flash profile:repo_agent
/byok probe agent provider:zai model:glm-4.5-flash timeout:20000
/byok auto recoveries 10
/byok auto off
```

Regra: `apply` e `switch` so aplicam o que a policy permite. Troca live de modelo fica dentro da mesma boundary BYOK.
Troca de provider/perfil exige novo boot SDK.

## 4. Default Auto

O default operacional seguro e:

- policy desligada;
- comandos read-only liberados;
- Ollama/local/private bloqueado para selecao automatica;
- live set-model desligado ate opt-in;
- new-session handoff desligado ate opt-in;
- provider calls somente com flags explicitas.

Para permitir troca live dentro da mesma boundary:

```text
/byok auto on profile:repo_agent allow-live-set-model
```

Para permitir tambem novo boot SDK quando provider/perfil mudar:

```text
/byok auto on profile:repo_agent allow-live-set-model allow-new-session
```

O operador deve verificar:

```text
/byok auto policy
/byok auto doctor profile:repo_agent
```

## 5. Escada Canonica Antes De Live Real

### 5.1 Read-only fora do terminal

```bash
npm run model-gateway:commands
npm run model-gateway:ops
npm run model-gateway:auto:ready
npm run model-gateway:auto:doctor
npm run model-gateway:auto:scenarios
```

Resultado esperado:

- readiness sem blockers;
- doctor com policy explicada;
- scenarios com ladder completa;
- nenhum provider call;
- nenhum consumo de quota.

### 5.2 Plano live sem executar modelo

```bash
npm run model-gateway:live:readiness
npm run model-gateway:live:plan
npm run model-gateway:live:auto-probe
```

Resultado esperado:

- catalog integrity ok;
- SQLite parity ok;
- selection audit ok;
- plano com prerequisitos e fases.

### 5.3 Terminal control no-PR

```bash
npm run model-gateway:live:llm-b -- --no-pr --timeout-ms=180000
```

Esse probe abre o terminal real, coleta `/usage`, `/activity`, `/session`, `/metrics`, `/events`, `/errors` e fecha com
`/quit`. Ele nao abre turno explicito de modelo.

Evidencia em 2026-06-01:

- status: PASS;
- artefato: `artifacts/terminal-live/2026-06-01T22-00-26-580Z/summary.md`;
- erros rastreados: 0;
- tools locais prontas: sim;
- MCP server externo indisponivel: tolerado no modo standalone;
- quota warning SDK apareceu como side-channel, sem turno explicito.

### 5.4 BYOK fixture no-PR

```bash
npm run model-gateway:live:llm-b -- --byok-probe --byok-fixture --no-pr --timeout-ms=240000
```

Esse probe valida o control-plane BYOK com fixture local OpenAI-compatible. Ele verifica:

- `/byok`;
- `/byok env`;
- `/byok providers`;
- `/byok health`;
- `/byok profiles`;
- `/byok models refresh`;
- `/byok recommend`;
- `/byok use codex-fixture`;
- `/byok model fixture/model-b`;
- `/byok provider openai-compatible fixture/model-c <fixtureBaseUrl>`;
- `/byok use sdk`;
- `/events`;
- `/errors`;
- redaction de bearer token.

Evidencia em 2026-06-01:

- status: PASS;
- artefato: `artifacts/terminal-live/2026-06-01T22-02-19-576Z/summary.md`;
- duracao: 14652ms;
- erros rastreados: 0;
- criterios PASS: 31;
- fixture bearer token nao vazou;
- discovery `/models` fixture funcionou;
- troca de profile/model/provider funcionou no estado preparado do processo;
- retorno para SDK funcionou.

### 5.5 Auto cockpit no-PR

```bash
npm run model-gateway:live:auto-probe
```

Esse probe abre o terminal real e valida o cockpit de auto-mode:

- `/byok gateway commands`;
- `/byok auto policy`;
- `/byok auto status profile:repo_agent`;
- `/byok auto doctor profile:repo_agent`;
- `/byok auto explain profile:repo_agent`;
- `/byok gateway auto profile:repo_agent`;
- `/byok auto history 10`;
- `/byok auto handoffs 10`;
- `/byok auto confirmations 10`;
- `/byok auto recovery-fixture profile:repo_agent provider:zai model:glm-4.5-flash failure:rate-limit`;
- `/byok probe agent provider:zai model:glm-4.5-flash timeout:20000`;
- `/byok auto recoveries 10`;
- `/events`;
- `/errors`.

Ele nao abre turno explicito de modelo e nao chama provider.

Evidencia em 2026-06-01:

- status: PASS;
- artefato inicial: `artifacts/terminal-live/2026-06-01T22-10-32-162Z/summary.md`;
- artefato com ledger SQLite final: `artifacts/terminal-live/2026-06-01T22-57-46-528Z/summary.md`;
- artefato com recovery fixture final: `artifacts/terminal-live/2026-06-01T23-49-06-502Z/summary.md`;
- artefato com standby/fixture sintetica final: `artifacts/terminal-live/2026-06-02T00-21-42-083Z/summary.md`;
- duracao mais recente: 21043ms;
- erros rastreados: 0;
- criterios PASS mais recentes: 30;
- inventario canonico exibiu 144 comandos apos recovery fixture, proof-plan, standby, health clear e prova explicita por provider/model;
- `/byok auto policy` funcionou;
- `/byok auto status profile:repo_agent` funcionou e mostrou resumo de alternativas usaveis/bloqueadas;
- `/byok auto doctor profile:repo_agent` funcionou e mostrou resumo de alternativas usaveis/bloqueadas;
- `/byok auto proof-plan profile:repo_agent 12` agora existe como fila read-only de probes por provider/model;
- `/byok auto standby profile:repo_agent 12` agora existe como fila read-only de substitutos e comandos de troca/prova;
- o cockpit passou a sugerir `/byok probe agent provider:<provider> model:<provider-model> timeout:20000` quando alternativas carecem de agent probe;
- `/byok auto explain profile:repo_agent` funcionou;
- `/byok auto recovery-fixture profile:repo_agent provider:zai model:glm-4.5-flash failure:rate-limit` gravou recovery account-wide, runtime health sintetica e espelho SQLite sem chamada ao provider;
- ledgers history/handoffs/confirmations/recoveries renderizaram corretamente;
- ledger de live scenarios gravou `terminal-live:2026-06-02T00-21-42-091Z:auto_probe`;
- `npm run model-gateway:live:runs` confirmou `criteriaTotal=30` no ultimo auto-probe;
- achado estrutural: depois dos overlays de health, `repo_agent` pode mostrar `usable=0/78` porque exige agent-probe verificado; isso e bloqueio correto, nao falha do cockpit.

### 5.6 BYOK real no-PR

Somente depois dos gates acima:

```bash
npm run model-gateway:live:llm-b -- --byok-real --byok-real-route-profile=repo_agent --byok-real-route-fallback-profiles=code,tool_agent --byok-real-route-selection-policy=prefer_runtime_proved --byok-real-route-execute --byok-real-route-allow-probe --byok-real-route-temporary-failure-cooldown-ms=900000 --byok-real-route-max-attempts=8 --byok-real-route-max-attempts-per-provider=4 --byok-real-route-timeout-ms=20000 --no-pr --timeout-ms=240000
```

Esse probe pode chamar provider e pode tocar quota BYOK, mas ainda nao abre o turno final de PR.

### 5.7 BYOK real full

Somente depois de `byok-real-no-pr` passar:

```bash
npm run model-gateway:live:llm-b -- --byok-real --byok-real-route-profile=repo_agent --byok-real-route-fallback-profiles=code,tool_agent --byok-real-route-selection-policy=prefer_runtime_proved --byok-real-route-execute --byok-real-route-allow-probe --byok-real-route-temporary-failure-cooldown-ms=900000 --byok-real-route-max-attempts=8 --byok-real-route-max-attempts-per-provider=4 --byok-real-route-timeout-ms=20000 --timeout-ms=900000
```

Esse e o teste de turno real. Ele pode consumir quota BYOK e deve ser tratado como teste caro.

## 6. Quota SDK Versus Quota BYOK

Durante probes no terminal, o SDK pode emitir `quota.warning` para `premium_interactions`. Isso e telemetria do SDK
Copilot. Nao significa que a rota BYOK esta sem credito, e nao deve ser usada como exclusao automatica de modelo BYOK.

Regras:

- `AssistantUsageQuotaSnapshot` e eventos equivalentes pertencem ao plano/conta SDK Copilot.
- BYOK quota deve vir de provider errors, headers, endpoint proprio do provider ou health/probe result.
- Falha BYOK classificada como quota/rate-limit deve virar overlay operacional com freshness e reset/cooldown.
- Quota SDK esgotada pode bloquear caminhos SDK-native, mas nao deve bloquear caminho BYOK valido.
- Quando BYOK esta ativo, falha BYOK deve ser classificada no gateway, nao como consumo de Premium Request.

## 7. Operacao Diaria

### 7.1 Diagnostico rapido

```bash
npm run model-gateway:ops
npm run model-gateway:auto:ready
npm run model-gateway:auto:doctor
npm run model-gateway:live:runs
```

### 7.2 Diagnostico no terminal

```text
/byok gateway commands
/byok gateway env
/byok gateway limits
/byok gateway quota-matrix
/byok gateway selection audit effective
/byok auto policy
/byok auto doctor profile:repo_agent
```

### 7.3 Habilitar auto para a proxima sessao

```text
/byok auto on profile:repo_agent allow-live-set-model
```

Depois reiniciar a task/sessao conforme a mensagem do terminal quando houver rebind de provider/perfil.

### 7.4 Fazer switch manual explicavel

```text
/byok auto explain profile:repo_agent
/byok auto switch profile:repo_agent
/byok auto handoffs 10
/byok auto confirmations 10
/byok auto proof-plan profile:repo_agent 12
/byok auto recovery-fixture profile:repo_agent provider:zai model:glm-4.5-flash failure:rate-limit
/byok probe agent provider:zai model:glm-4.5-flash timeout:20000
/byok auto recoveries 10
```

### 7.5 Desligar auto

```text
/byok auto off
```

## 8. Politica De Local/Ollama

Ollama/local/private deve continuar suportado:

- catalogo pode conter modelos locais;
- comandos de inventario podem listar local;
- readiness nao deve falhar se Ollama nao estiver rodando;
- probes locais nao devem rodar por default;
- selecao automatica nao deve escolher local por default.

Para usar local/private, o operador precisa pedir explicitamente por um perfil local ou strict local.

Exemplos:

```bash
npm run model-gateway:selection:effective -- --profile local_private
npm run model-gateway:live:plan -- --local-private-strict
```

## 9. Resposta A Falhas

### 9.1 Falha temporaria de modelo/rota

Persistir como health/overlay operacional:

- provider;
- model;
- route profile;
- kind;
- observedAt;
- nextRetry/reset window, quando existir;
- contexto;
- redacted message.

Depois:

```bash
npm run model-gateway:runtime-health:mirror
npm run model-gateway:runtime-selector -- --fail
```

### 9.2 Falha account-wide/key-wide

Nao repetir outros modelos do mesmo provider/key sem motivo. O selector deve receber exclusao account-wide e preferir outro
provider/profile quando a policy permitir.

### 9.3 Falha dura de acesso

Exemplos:

- key sem acesso ao modelo;
- modelo pago indisponivel para a conta;
- endpoint autorizado mas modelo proibido;
- provider retornando permission denied.

Isso nao remove o modelo do catalogo. Isso cria overlay operacional com freshness.

### 9.4 Quota temporaria

Exemplos:

- rate limit;
- daily limit;
- monthly credit resetavel;
- insufficient quota com reset conhecido.

Isso cria overlay temporario com reset/cooldown.

## 10. Checklist Antes De Chancelar

- [ ] `npm run model-gateway:auto:ready` passa.
- [x] `npm run model-gateway:auto:doctor` passa.
- [x] `npm run model-gateway:auto:proof-plan` passa e gera fila read-only de comandos de prova.
- [x] `npm run model-gateway:auto:standby` passa e lista rotas de prontidao sem chamar provider.
- [x] `npm run model-gateway:auto:scenarios` passa sem blockers de readiness e com `live_plan_ready=true`.
- [x] `npm run model-gateway:live:readiness` passa.
- [x] `npm run model-gateway:live:plan -- --json --no-write` passa; health sintetica de fixture nao bloqueia live real.
- [x] `npm run model-gateway:live:llm-b -- --no-pr --timeout-ms=180000` passa.
- [x] `npm run model-gateway:live:llm-b -- --byok-probe --byok-fixture --no-pr --timeout-ms=240000` passa.
- [x] `npm run model-gateway:live:auto-probe` passa.
- [x] `npm run model-gateway:live:runs` mostra o ultimo auto-probe persistido.
- [x] `/byok auto recovery-fixture profile:repo_agent provider:zai model:glm-4.5-flash failure:rate-limit` persiste recovery, runtime health sintetica e SQLite sem provider call; health real exige `real-health`.
- [x] `/byok auto doctor profile:repo_agent` passa no terminal.
- [ ] `byok-real-no-pr` passa quando o operador permitir gasto de quota BYOK.
- [ ] `byok-real-full` passa quando o operador permitir turno real.
- [ ] Redaction audit passa.
- [ ] Lint/model-gateway scoped passa.
- [ ] Typecheck strict `src/copilot` passa quando houver mudanca de codigo.
- [ ] Testes unitarios escopados passam quando houver mudanca de codigo.

## 11. Lacunas Operacionais Ainda Abertas

- Persistencia dedicada de recovery attempts existe; falta ampliar scenarios fixture de falha/cooldown/fallback.
- Persistencia dedicada de live scenario runs existe; falta apenas ampliar scenarios especificos e rodar redaction audit dedicado.
- Pre-turn fixture precisa cobrir anti-loop de decision repetida.
- Post-turn fixture precisa simular falha, cooldown e fallback.
- Fixture `model_changed` precisa exercitar confirmation correlacionada.
- Cockpit prepared/live/confirmed precisa ser auditado no terminal com scenario completo.
- BYOK real no-PR ainda precisa ser rodado depois dos gates fixture.
- BYOK real full ainda precisa ser rodado depois do no-PR real.

## 12. Como Uma LLM Deve Operar

1. Ler este playbook.
2. Rodar `npm run model-gateway:ops`.
3. Rodar `npm run model-gateway:auto:ready`.
4. Rodar `npm run model-gateway:auto:doctor`.
5. Se houver blocker, corrigir a camada apontada sem pular para runtime.
6. Rodar `npm run model-gateway:auto:scenarios`.
7. Rodar `npm run model-gateway:live:readiness`.
8. Rodar `npm run model-gateway:live:plan`.
9. Rodar control no-PR.
10. Rodar BYOK fixture no-PR.
11. So depois planejar BYOK real no-PR.
12. So depois planejar BYOK real full.
13. Registrar artefatos e atualizar o roadmap.

## 13. Primeira Chancela Parcial De 2026-06-01

Comandos ja rodados nesta rodada:

```bash
npm run model-gateway:auto:ready
npm run model-gateway:auto:scenarios
npm run model-gateway:live:llm-b -- --no-pr --timeout-ms=180000
npm run model-gateway:live:llm-b -- --byok-probe --byok-fixture --no-pr --timeout-ms=240000
npm run model-gateway:live:auto-probe
```

Resultado:

- `auto:ready`: ok;
- `auto:proof-plan`: ok, gerou 12 comandos para alternativas bloqueadas.
- `auto:standby`: ok, listou rotas de prontidao sem provider call.
- `auto:scenarios`: comandos ok, 12 cenarios, standby ok; apos recovery fixture, o doctor pode voltar a bloquear por health/cooldown registrado;
- `live control no-PR`: PASS;
- `BYOK fixture no-PR`: PASS;
- `auto cockpit no-PR`: PASS;
- terminal error tracker: 0;
- fixture bearer token: nao vazou;
- provider/model/profile fixture: funcionando;
- proximo degrau: terminal auto doctor live e fixtures auto especificas antes de BYOK real.
