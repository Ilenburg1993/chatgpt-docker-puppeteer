# Canonical Model Gateway Runtime Operations Roadmap - 2026-06-02

Este documento passa a ser o guia de continuidade para tornar o `src/copilot/model-gateway` operacional de ponta a
ponta no terminal, para operador humano ou LLM. O foco nao e apenas selecionar um modelo: o objetivo e manter uma lista
grande de modelos prontos, aplicar defaults seguros, permitir troca automatica quando houver falha/quota/esgotamento,
preservar explicabilidade, e testar o fluxo no mesmo ambiente do operador.

Documentos operacionais relacionados:

- `src/copilot/docs/model-gateway/CANONICAL_MODEL_GATEWAY_OPERATIONAL_AND_CODE_REFERENCE_2026-06-02.md`
- `src/copilot/docs/model-gateway/CANONICAL_MODEL_GATEWAY_RUNTIME_OPERATOR_AUTOMATION_GUIDE_2026-06-02.md`

Documentos anteriores continuam como historico e fonte de contexto:

- `src/copilot/docs/model-gateway/CANONICAL_MODEL_GATEWAY_OPERATOR_RUNTIME_PLAYBOOK_2026-06-01.md`
- `src/copilot/docs/model-gateway/CANONICAL_MODEL_GATEWAY_OPERATOR_AND_CODE_GUIDE_2026-06-01.md`
- `src/copilot/docs/model-gateway/CANONICAL_MODEL_GATEWAY_TERMINAL_AUTO_RUNTIME_ROADMAP_2026-06-01.md`
- `src/copilot/docs/model-gateway/CANONICAL_MODEL_GATEWAY_BYOK_NEXT_GUIDE_2026-05-26.md`
- `src/copilot/docs/model-gateway/CANONICAL_MODEL_GATEWAY_BYOK_UNIVERSAL_GUIDE_2026-05-25.md`

## 1. Norte

O sistema ideal deve permitir:

- coletar metadados completos de providers/modelos;
- normalizar tudo para uma superficie compativel com OpenAI e extensoes internas;
- manter metadados canonicos separados de fatos operacionais;
- registrar account/key/quota/rate-limit/runtime health como overlays;
- selecionar candidatos antes de runtime;
- executar probes descartaveis apenas quando autorizadas;
- promover modelos para prontidao quando provados;
- operar por default em modo auto configuravel;
- trocar modelo dentro da mesma boundary quando isso for seguro;
- preparar novo boot SDK quando provider/perfil mudar;
- replanejar apos falha/quota/esgotamento;
- manter standby list rica e explicavel;
- dar ao operador comandos curtos, previsiveis e auditaveis;
- dar a outra LLM um cockpit que ela consiga ler e agir sem contexto secreto;
- validar tudo por live tests no terminal real.

## 2. Estado Atual Consolidado

### 2.1 Ja Feito

- [x] Catalogo canonico JSON existe.
- [x] SQLite operacional existe.
- [x] Schema SQLite operacional esta na versao 11.
- [x] Importers por provider existem para fontes principais ja mapeadas.
- [x] OpenAI-compatible schema existe como alvo normalizado.
- [x] Account overlays existem.
- [x] Quota/rate-limit/reset windows existem como camada operacional.
- [x] Runtime health existe em ledger JSON.
- [x] Runtime health pode ser espelhado no SQLite.
- [x] Runtime health clear remove ledger JSON e SQLite para identidade escopada.
- [x] Selecao pre-runtime existe.
- [x] Selecao pos-runtime com health observado existe.
- [x] Runtime selector existe.
- [x] Runtime selector suporta fallback profiles.
- [x] Runtime selector suporta cooldown temporario.
- [x] Runtime selector suporta max attempts e max attempts per provider.
- [x] Runtime selector suporta `requireAgentProbeProfiles` configuravel.
- [x] Terminal live bootstrap pode selecionar rota e provar depois.
- [x] Probes descartaveis existem para chat, agent, streaming, json e vision.
- [x] Vision falha como capacidade nao bloqueante para chat/agent quando nao exigida.
- [x] `repo_agent` pode ser conservador por API e permissivo por bootstrap live.
- [x] Shortlist/probe separa provider/preset de profile.
- [x] `kilo-code` sem profile ativo gera `provider:kilo-code`, nao `profile:kilo-code`.
- [x] Residuos `routeProfile=kilo-code/provider=kilo-code` foram removidos do SQLite.
- [x] Automation decision pura existe.
- [x] Controller step existe.
- [x] Effect applications existem.
- [x] SDK handoffs existem.
- [x] SDK confirmations existem.
- [x] Recovery attempts existem.
- [x] Live scenario runs existem.
- [x] `auto:status`, `auto:ready`, `auto:doctor`, `auto:explain`, `auto:proof-plan`, `auto:standby` existem.
- [x] `auto:scenarios` existe.
- [x] `/byok auto ...` existe no terminal.
- [x] `/byok health clear ...` existe no terminal.
- [x] `/byok probe agent provider:<provider> model:<model>` existe.
- [x] Scripts operacionais vivem em `scripts/model-gateway/`.
- [x] Barril `scripts/model-gateway/index.mjs` existe.
- [x] Runner `scripts/model-gateway/run.mjs` existe.
- [x] `package.json` usa runner logico para scripts model-gateway.
- [x] Makefile encaminha para npm scripts canonicos.
- [x] Live control no-PR passou.
- [x] Live BYOK fixture no-PR passou.
- [x] Live BYOK real no-PR passou em `artifacts/terminal-live/2026-06-02T01-11-14-561Z/summary.md`.
- [x] Live auto-probe passou em `artifacts/terminal-live/2026-06-02T02-44-38-191Z/summary.md`.
- [x] Live control no-PR passou em `artifacts/terminal-live/2026-06-02T02-45-10-607Z/summary.md`.
- [x] Live BYOK fixture no-PR passou em `artifacts/terminal-live/2026-06-02T02-45-29-920Z/summary.md`.
- [x] Live BYOK real no-PR passou em `artifacts/terminal-live/2026-06-02T02-45-55-239Z/summary.md`.
- [x] `model-gateway:commands:json` roda pelo runner.
- [x] `model-gateway:live:readiness -- --fail` roda pelo runner.
- [x] `model-gateway:auto:ready` roda pelo runner.
- [x] `model-gateway:operator-ready` existe como cockpit read-only para humano/LLM.
- [x] Standby plans podem ser persistidos no SQLite operacional por perfil.
- [x] Standby persistido pode ser lido sem recalcular selector por `--read-sqlite`/`persisted`.
- [x] `auto:scenarios` inclui cockpit, standby persistido e etapa de persistencia de standby.
- [x] Referencia canonica operacional/estrutural foi criada.

### 2.2 Lacunas De Base Ainda Abertas

- [ ] O default auto ainda precisa de uma definicao operacional final: quando ligar, quando aplicar, quando apenas sugerir.
- [ ] O fallback real em turno ainda precisa ser fechado para falha durante runtime.
- [x] A lista de standby virou artefato persistivel de primeira classe.
- [x] A lista de standby aparece no cockpit com gerado agora vs persistido.
- [ ] A lista de standby ainda precisa ganhar fluxo manual de troca por item/rank.
- [ ] O terminal precisa expor com mais clareza "modelo vivo", "modelo preparado", "rota selecionada" e "proximos substitutos".
- [ ] A policy deve ter presets claros para humano, LLM operadora e modo conservador.
- [ ] A troca automatica por quota esgotada precisa diferenciar quota temporaria, creditos, auth, modelo inexistente e timeout.
- [ ] O sistema precisa saber quando nao tentar de novo antes do reset.
- [ ] O sistema precisa mostrar quando deve rodar probe descartavel antes de promover candidato.
- [ ] O sistema precisa preservar historico sem deixar lixo operacional ressuscitar selecao.
- [ ] A camada de comandos canonicos precisa incluir "status de pronto para operar" em uma saida unica e didatica.
- [ ] Live tests com LLM-B ainda precisam cobrir turnos reais, falhas simuladas e fallback efetivo.
- [ ] Vision nao deve ser tratado como bloqueio geral: falha de vision deve bloquear apenas capacidades multimodais.
- [ ] Side-channel GitHub Copilot quota deve continuar separado de BYOK quota/creditos/rate-limit.

## 3. Invariantes

- [ ] Nenhum comando read-only chama provider.
- [ ] Nenhum comando read-only muda terminal vivo.
- [ ] Nenhum runtime health altera metadados canonicos.
- [ ] Nenhum segredo bruto aparece em stdout, docs, artifacts ou SQLite payload.
- [ ] Nenhuma rota local/Ollama e selecionada por default.
- [ ] Local/Ollama so entra com opt-in explicito.
- [ ] Provider/preset nunca vira profile implicito.
- [ ] Profile e routeProfile sao conceitos diferentes quando necessario.
- [ ] SelectorSyntax e providerModel nao devem ser confundidos.
- [ ] Runtime proof nao substitui catalogo canonico.
- [ ] Quota temporaria nao remove modelo do catalogo canonico.
- [ ] Credits/auth/model-not-found precisam ter classificacao distinta.
- [ ] Falha durante turno precisa gerar overlay operacional e recovery decision.
- [ ] Todo efeito aplicado precisa de decision id.
- [ ] Todo handoff precisa de decision id.
- [ ] Toda confirmation precisa tentar correlacionar com handoff/effect.
- [ ] Todo live test precisa gravar scenario run.
- [ ] Todo comando novo precisa entrar no inventario canonico se for operador-facing.

## 4. Arquitetura Ideal

### 4.1 Camadas

```text
metadata importers
  -> canonical catalog
  -> sqlite catalog projection
  -> account/key overlays
  -> quota/rate-limit/runtime overlays
  -> pre-runtime selection
  -> runtime selector plan
  -> automation decision
  -> terminal effect controller
  -> SDK session/model boundary
  -> live turn/probe
  -> post-turn health/recovery
  -> standby refresh
```

### 4.2 Separacoes Criticas

- Metadados: o que o provider/modelo e ou diz suportar.
- Account/key: o que a key atual parece poder acessar.
- Pre-runtime: o que vale tentar sem rodar modelo.
- Runtime proof: o que ja foi provado por probes/turnos.
- Runtime failure: o que acabou de falhar e por quanto tempo deve bloquear.
- Selection policy: como ponderar metadados, proof, custo, contexto e risco.
- Terminal policy: quando aplicar troca live, quando preparar novo boot, quando so sugerir.
- Live tests: comprovacao no ambiente real do operador.

### 4.3 Estados Esperados

- [ ] `catalog_ready`
- [ ] `sqlite_ready`
- [ ] `account_overlay_ready`
- [ ] `pre_runtime_candidates_ready`
- [ ] `runtime_selector_ready`
- [x] `standby_ready`
- [ ] `auto_policy_ready`
- [ ] `terminal_boundary_known`
- [ ] `same_boundary_switch_possible`
- [ ] `new_session_handoff_possible`
- [ ] `runtime_probe_needed`
- [ ] `runtime_probe_passed`
- [ ] `turn_running`
- [ ] `turn_succeeded`
- [ ] `turn_failed_retriable`
- [ ] `turn_failed_hard`
- [ ] `fallback_selected`
- [ ] `effect_applied`
- [ ] `handoff_confirmed`
- [ ] `operator_action_required`

## 5. Roadmap

### Faixa A - Fundacao De Comandos E Barris

- [x] A.1 Centralizar scripts em `scripts/model-gateway/`.
- [x] A.2 Criar barril `scripts/model-gateway/index.mjs`.
- [x] A.3 Criar runner `scripts/model-gateway/run.mjs`.
- [x] A.4 Migrar `package.json` para runner logico.
- [x] A.5 Manter Makefile chamando npm canonico.
- [x] A.6 Proteger por teste que package nao aponta diretamente para `model-gateway-*.mjs`.
- [x] A.7 Criar comando `model-gateway:operator-ready` com resumo unico.
- [x] A.8 Adicionar `make model-gateway-operator-ready`.
- [x] A.9 Mover executaveis internos para `scripts/model-gateway/commands/`.
- [x] A.10 Mover helper dotenv para `scripts/model-gateway/lib/env.mjs`.
- [x] A.11 Expor manifesto JSON do runner via `npm run model-gateway:scripts` e `make model-gateway-scripts`.
- [x] A.12 Proteger por teste que comandos package usam o runner, nao caminhos fisicos internos.
- [x] A.13 Documentar IDs do runner no inventario canonico.
- [x] A.14 Expor `/byok gateway operator-ready`.

### Faixa B - Cockpit Operacional Unico

- [ ] B.1 Consolidar status de catalogo, SQLite, selector, auto policy e terminal boundary.
- [ ] B.2 Mostrar modelo vivo, modelo preparado e rota selecionada em uma unica saida.
- [ ] B.3 Mostrar standby top-N por perfil.
- [ ] B.4 Mostrar blockers agrupados por action: probe, clear, wait, configure key, new boot.
- [ ] B.5 Mostrar proximo comando seguro para humano.
- [ ] B.6 Mostrar proximo comando seguro para LLM operadora.
- [ ] B.7 Garantir JSON estavel para automacao.
- [x] B.8 Garantir texto curto e escaneavel para terminal.

### Faixa C - Default Auto

- [ ] C.1 Definir policy default: off, advise-only ou guarded-auto.
- [ ] C.2 Criar preset `operator_manual`.
- [ ] C.3 Criar preset `llm_operator_guarded`.
- [ ] C.4 Criar preset `auto_same_boundary`.
- [ ] C.5 Criar preset `auto_prepare_new_session`.
- [ ] C.6 Expor diferenca entre aplicar agora e preparar proximo boot.
- [ ] C.7 Persistir policy snapshot sempre que auto roda.
- [ ] C.8 Mostrar por que auto aplicou ou nao aplicou.
- [ ] C.9 Garantir que local/Ollama continua opt-in.

### Faixa D - Standby E Substituicao

- [x] D.1 Fazer standby virar contrato de dados, nao apenas comando.
- [x] D.2 Persistir ultima standby list por perfil.
- [x] D.3 Separar standby por mesma boundary e por novo provider.
- [x] D.4 Marcar candidatos ja provados para agent.
- [x] D.5 Expor leitura read-only da standby list persistida.
- [ ] D.6 Marcar candidatos que precisam de probe.
- [ ] D.7 Marcar candidatos bloqueados por quota/reset.
- [ ] D.8 Marcar candidatos bloqueados por auth/key.
- [ ] D.8 Gerar comandos de troca para cada candidato.
- [ ] D.9 Gerar comandos de probe para cada candidato.
- [x] D.10 Usar standby no post-turn recovery.

### Faixa E - Quota, Rate Limit E Conta/Key

- [ ] E.1 Separar quota BYOK de quota GitHub Copilot SDK.
- [ ] E.2 Mostrar side-channel do SDK como diagnostico, nao como decisao BYOK.
- [ ] E.3 Classificar quota temporaria.
- [ ] E.4 Classificar creditos esgotados.
- [ ] E.5 Classificar auth invalida.
- [ ] E.6 Classificar modelo inacessivel para key.
- [ ] E.7 Classificar rate-limit com `retry-after`.
- [ ] E.8 Persistir `resetAt`/`nextRetry`.
- [ ] E.9 Nao tentar candidato antes do reset quando hard cooldown estiver ativo.
- [ ] E.10 Permitir clear manual quando operador sabe que resetou.

### Faixa F - Runtime Selector Real

- [ ] F.1 Garantir plano com primario e fallbacks em ordem.
- [ ] F.2 Garantir diversidade de provider quando configurada.
- [ ] F.3 Garantir max attempts por provider.
- [ ] F.4 Garantir cooldown temporario por failure kind.
- [ ] F.5 Garantir agent probe exigido por policy, nao hardcode unico.
- [ ] F.6 Garantir bootstrap live com allow-probe controlado.
- [ ] F.7 Persistir route decisions de selector.
- [ ] F.8 Persistir probe runs quando executar.
- [ ] F.9 Expor resumo compacto para terminal.
- [ ] F.10 Expor JSON completo para automacao.

### Faixa G - Terminal Boundary

- [ ] G.1 Confirmar boundary viva no boot.
- [ ] G.2 Confirmar prepared selection.
- [ ] G.3 Diferenciar profile, preset, providerType, baseUrl e model.
- [ ] G.4 Permitir setModel somente na mesma boundary.
- [ ] G.5 Preparar novo boot SDK em troca de provider/perfil.
- [ ] G.6 Persistir handoff antes do boot.
- [ ] G.7 Confirmar `session.model_changed`.
- [ ] G.8 Detectar mismatch entre preparado e vivo.
- [ ] G.9 Mostrar mismatch no cockpit.
- [ ] G.10 Criar proximo comando para resolver mismatch.

### Faixa H - Post-Turn Recovery

- [ ] H.1 Capturar falha BYOK do turno real.
- [ ] H.2 Classificar falha.
- [ ] H.3 Persistir health operacional.
- [ ] H.4 Persistir recovery attempt.
- [ ] H.5 Bloquear repeticao imediata da mesma rota.
- [ ] H.6 Selecionar fallback de standby.
- [ ] H.7 Aplicar setModel se mesma boundary e policy permitir.
- [ ] H.8 Preparar novo boot se boundary mudou e policy permitir.
- [ ] H.9 Mostrar acao tomada no terminal.
- [ ] H.10 Registrar live scenario do recovery.

### Faixa I - Probes E Promocao

- [ ] I.1 Chat probe continua isolada.
- [ ] I.2 Agent probe continua isolada.
- [ ] I.3 Streaming probe continua isolada.
- [ ] I.4 JSON probe continua isolada.
- [ ] I.5 Vision probe nao bloqueia chat/agent por default.
- [ ] I.6 Shortlist probe deve usar provider quando nao ha profile.
- [ ] I.7 Shortlist deve evitar candidatos ja bloqueados por cooldown.
- [ ] I.8 Shortlist deve poder tentar proximo candidato quando primeiro falha.
- [ ] I.9 Prova positiva deve promover candidato para standby.
- [ ] I.10 Falha de probe deve registrar health sem poluir metadados.

### Faixa J - Live Tests LLM-B

- [x] J.1 Control no-PR deve permanecer verde.
- [x] J.2 BYOK fixture no-PR deve permanecer verde.
- [x] J.3 BYOK real no-PR deve permanecer verde.
- [ ] J.4 Live real com turno simples deve ser criado.
- [ ] J.5 Live real com tool/ask_user deve ser criado.
- [ ] J.6 Live fixture de quota esgotada deve ser criado.
- [ ] J.7 Live fixture de fallback mesma boundary deve ser criado.
- [ ] J.8 Live fixture de fallback novo provider deve ser criado.
- [ ] J.9 Live fixture de mismatch preparado/vivo deve ser criado.
- [ ] J.10 Live test deve validar ausencia de segredo em output.

### Faixa K - Operador Humano

- [ ] K.1 `/byok gateway operator-ready` deve ser o cockpit inicial.
- [x] K.2 `/byok auto standby` deve listar substitutos claros.
- [ ] K.3 `/byok auto apply` deve explicar antes/depois.
- [ ] K.4 `/byok auto switch` deve ser seguro e reversivel.
- [ ] K.5 `/byok auto off` deve ser sempre claro.
- [ ] K.6 `/byok health clear` deve mostrar preview antes de apply quando possivel.
- [ ] K.7 `/byok probe shortlist` deve explicar por que candidato falhou.
- [ ] K.8 `/usage now` deve separar BYOK e SDK side-channel.
- [ ] K.9 `/session sdk` deve mostrar boundary BYOK sem ambiguidade.
- [ ] K.10 `/metrics` deve mostrar modelo vivo e policy auto.

### Faixa L - Operador LLM

- [ ] L.1 JSON de `operator-ready` deve ser estavel.
- [ ] L.2 JSON deve conter `nextSafeCommands`.
- [ ] L.3 JSON deve conter `requiresHumanDecision`.
- [ ] L.4 JSON deve conter `canApplyAutomatically`.
- [x] L.5 JSON deve conter standby list.
- [ ] L.6 JSON deve conter blockers por candidato.
- [ ] L.7 JSON deve conter clear/probe commands.
- [ ] L.8 JSON deve conter live test commands.
- [ ] L.9 JSON deve conter artifact paths relevantes.
- [ ] L.10 LLM operadora nao deve precisar ler segredos.

### Faixa M - Documentacao E Governanca

- [x] M.1 Criar este roadmap.
- [x] M.2 Linkar este roadmap nos guias ativos.
- [x] M.3 Criar referencia canonica operacional e estrutural atual.
- [x] M.4 Atualizar `scripts/model-gateway/README.md`.
- [x] M.5 Atualizar inventario canonico.
- [x] M.6 Atualizar checklist de live tests.
- [x] M.7 Registrar cada live test relevante com artifact.
- [ ] M.8 Registrar comandos para recovery.
- [ ] M.9 Registrar comandos para fallback.
- [ ] M.10 Registrar comandos para clear/probe.

## 6. Prioridade Imediata

1. [x] Criar `operator-ready` read-only.
2. [x] Consolidar standby como contrato reutilizavel.
3. [x] Ligar standby ao post-turn recovery.
4. [ ] Melhorar cockpit terminal de boundary/prepared/live.
5. [ ] Criar live fixtures de fallback/recovery.
6. [ ] Rodar live tests LLM-B em escada.
7. [ ] Corrigir bugs encontrados nos lives.
8. [ ] Repetir readiness/selector/health diff.
9. [ ] Atualizar este roadmap.
10. [ ] Commit/push.

## 7. Comandos Canonicos Para Esta Fase

```bash
npm run model-gateway:commands:json
npm run model-gateway:ops
npm run model-gateway:auto:ready
npm run model-gateway:auto:doctor
npm run model-gateway:operator-ready
npm run model-gateway:auto:standby -- --profile=repo_agent --limit=12
npm run model-gateway:auto:standby -- --profile=repo_agent --limit=12 --write-sqlite
npm run model-gateway:auto:standby -- --profile=repo_agent --read-sqlite --json
npm run model-gateway:auto:scenarios -- --profile=repo_agent --json
npm run model-gateway:runtime-selector -- --fail
npm run model-gateway:runtime-health:diff -- --write-snapshot --fail-on-regression
npm run model-gateway:live:readiness -- --fail
npm run model-gateway:live:llm-b -- --byok-real --byok-real-route-profile=repo_agent --byok-real-route-fallback-profiles=code,tool_agent --byok-real-route-selection-policy=prefer_runtime_proved --byok-real-route-execute --byok-real-route-allow-probe --byok-real-route-temporary-failure-cooldown-ms=900000 --byok-real-route-max-attempts=8 --byok-real-route-max-attempts-per-provider=4 --byok-real-route-timeout-ms=20000 --no-pr --timeout-ms=240000
```

## 8. Criterio Para Chancela Operacional

- [ ] `operator-ready` ok.
- [ ] `auto:ready` ok.
- [ ] `auto:doctor` sem blocker desconhecido.
- [ ] `runtime-selector -- --fail` ok.
- [ ] `runtime-health:diff -- --fail-on-regression` ok.
- [ ] Standby tem pelo menos tres alternativas nao locais por default quando a key permitir.
- [ ] Local/Ollama nao aparece como selecionado por default.
- [ ] BYOK real no-PR passa.
- [ ] BYOK real turno simples passa.
- [ ] BYOK real tool/ask_user passa ou explica blocker.
- [ ] Fallback fixture passa.
- [ ] Recovery fixture passa.
- [ ] Nenhum segredo bruto aparece nos artifacts.
- [ ] Docs e comandos canonicos apontam para o fluxo atual.
