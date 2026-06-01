# Model Gateway Scripts

Scripts operacionais canônicos do `src/copilot/model-gateway`.

## Regra De Ouro

- `model-gateway:ops`, `model-gateway:commands`, `model-gateway:sqlite:diagnostics`, `model-gateway:live:readiness`,
  `model-gateway:live:plan`, `model-gateway:auto:status`, `model-gateway:auto:plan`,
  `model-gateway:auto:ready`, `model-gateway:auto:doctor` e `model-gateway:auto:scenarios` são caminhos read-only por padrão.
- Provider/model runtime só deve ser executado por comandos que exigem flag explícita, como runtime selector com execução
  ou live test real.
- Metadados canônicos não são mutados por runtime health, route decisions ou automation decisions.
- Estados voláteis de conta/key/quota/rate-limit vivem em overlays, health e tabelas operacionais SQLite.

## Comandos De Orientação

```bash
npm run model-gateway:ops
npm run model-gateway:commands
npm run model-gateway:commands:json
```

`model-gateway:ops` é o cockpit rápido: resume banco SQLite, readiness, decisão auto e inventário de comandos sem buscar
providers, rodar modelos ou mutar a sessão terminal.

## Banco De Metadados

```bash
npm run model-gateway:metadata:build:plan
npm run model-gateway:metadata:build:preview
npm run model-gateway:metadata:build
npm run model-gateway:refresh:plan -- --provider=openrouter --force
npm run model-gateway:refresh -- --provider=openrouter --force
```

Use refresh por provider quando estiver alterando fontes, specs ou importers de um provider específico. Build completo é
reservado para mudanças amplas de schema, normalização ou bootstrap.

## SQLite Operacional

```bash
npm run model-gateway:sqlite:diagnostics
npm run model-gateway:sqlite:retention -- --json
npm run model-gateway:sqlite:retention:apply -- --json
```

Diagnostics mostra snapshot ativo, contagens por camada, runtime health, route decisions e automation decisions. Retention
remove apenas histórico operacional acima dos limites configurados; não apaga o catálogo canônico ativo.

## Seleção E Automação

```bash
npm run model-gateway:selection:effective
npm run model-gateway:runtime-selector
npm run model-gateway:auto:status
npm run model-gateway:auto:ready
npm run model-gateway:auto:doctor
npm run model-gateway:auto:explain
npm run model-gateway:auto:handoffs
npm run model-gateway:auto:confirmations
npm run model-gateway:auto:recoveries
npm run model-gateway:auto:scenarios
npm run model-gateway:auto:status -- --write-sqlite
```

`auto:status` monta uma decisão pura. `--write-sqlite` grava a decisão como trilha operacional, sem aplicar efeitos e sem
chamar provider.

`auto:ready` é o gate operacional objetivo para saber se catálogo, SQLite, readiness, decisão auto e superfícies canônicas
estão visíveis. `auto:doctor` explica a policy efetiva, ledgers de efeitos/recoveries/handoffs/confirmations e o que
ainda impede automação total. `auto:handoffs`, `auto:confirmations` e `auto:recoveries` leem os ledgers SDK/recovery sem
SQL manual.

`auto:scenarios` agrega readiness, doctor, explain, ledgers e live-plan em uma escada canônica de cenários para humano
ou LLM: leitura, policy stateful, troca terminal, fixture e real provider. Ele não chama provider nem inicia o terminal.

No terminal:

```text
/byok auto status profile:repo_agent
/byok auto record profile:repo_agent
/byok auto apply profile:repo_agent allow-live-set-model
/byok auto off
```

`apply` só executa efeitos que a policy autorizou. Troca live de modelo é limitada à mesma boundary BYOK; troca de
provider/perfil exige novo boot de sessão SDK.

## Live Tests

```bash
npm run model-gateway:live:readiness
npm run model-gateway:live:plan
npm run model-gateway:auto:scenarios
npm run model-gateway:live:llm-b -- --no-pr --timeout-ms=180000
npm run model-gateway:live:llm-b -- --byok-probe --byok-fixture --no-pr --timeout-ms=240000
npm run model-gateway:live:auto-probe
npm run model-gateway:live:runs
```

Rode testes live reais apenas depois de readiness, plan, control no-PR, BYOK fixture no-PR e auto-probe estarem claros.
O caminho real pode consumir quota da key BYOK.

O playbook operacional ativo vive em:

```text
src/copilot/docs/model-gateway/CANONICAL_MODEL_GATEWAY_OPERATOR_RUNTIME_PLAYBOOK_2026-06-01.md
```
