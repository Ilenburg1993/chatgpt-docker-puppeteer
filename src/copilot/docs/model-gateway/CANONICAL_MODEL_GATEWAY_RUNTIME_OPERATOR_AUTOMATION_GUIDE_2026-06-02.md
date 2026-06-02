# Canonical Model Gateway Runtime Operator Automation Guide - 2026-06-02

Este documento passa a guiar a fase operacional do `src/copilot/model-gateway/` e sua integracao com o terminal BYOK.
Os guias anteriores continuam como historico e contexto, mas este arquivo organiza o trabalho atual: deixar o sistema
pronto para uso por operador humano ou LLM, com fluxos claros, comandos canonicos, standby, fallback, selecao
pre-runtime, selecao runtime e testes live LLM-B.

## 1. Escopo

- Sistema principal: `src/copilot/model-gateway/`.
- Ponte terminal: `src/copilot/terminal/byok/` e `src/copilot/terminal/commands/byok.js`.
- Scripts operacionais: `scripts/model-gateway/`.
- Banco canonico: catalogo JSON e SQLite de model-gateway.
- Camada volatil: runtime health, account/key overlays, route decisions, automation decisions e live runs.
- Live testing: `npm run model-gateway:live:llm-b` via runner canonico.

## 2. Principios Arquiteturais

1. Metadados canonicos nao sao runtime.
2. Runtime health nao muda metadados canonicos.
3. Account/key/quota/rate-limit sao overlays volateis.
4. Ollama/local privado e suportado, mas nunca selecionado por default.
5. Toda selecao automatica deve ser explicavel antes de aplicar efeito.
6. Troca live de modelo so e segura dentro da mesma boundary BYOK.
7. Troca de provider/perfil exige preparacao de nova sessao SDK.
8. Provider calls e probes reais devem exigir opt-in explicito.
9. Operador humano e LLM devem conseguir operar pelos mesmos comandos canonicos.
10. Scripts internos devem ser resolvidos por runner/barrel, nao por caminhos fisicos espalhados.

## 3. Situacao Atual Auditada

### 3.1 O Que Esta Solido

- [x] Catalogo universal existe em JSON e SQLite.
- [x] Importers e normalizadores existem para multiplos providers.
- [x] Pre-runtime selection separa catalogo de runtime health.
- [x] Runtime selector gera plano de rota com primary e candidate alternatives.
- [x] Standby routes derivam selected e alternatives.
- [x] Terminal possui `/byok auto status`, `apply`, `standby`, `proof-plan`, `doctor`, `recoveries`.
- [x] Post-turn recovery grava falha em health operacional e SQLite.
- [x] Falha da rota selecionada pode promover fallback standby no decision core.
- [x] `operator-ready` agrega ops, auto-ready, selector, standby e health diff.
- [x] Standby plans podem ser persistidos no SQLite operacional por perfil sem tocar no catalogo canonico.
- [x] Standby persistido pode ser inspecionado sem recalcular selector por `--read-sqlite`/`persisted`.
- [x] Scripts foram movidos para `scripts/model-gateway/commands/`.
- [x] Runner/barrel vive em `scripts/model-gateway/run.mjs` e `scripts/model-gateway/index.mjs`.
- [x] Manifesto JSON do runner existe em `npm run model-gateway:scripts`.
- [x] Package scripts de model-gateway passam pelo runner.

### 3.2 Gaps Atuais De Maior Retorno

- [x] O cockpit `operator-ready` esta exposto diretamente no terminal por `/byok gateway operator-ready`.
- [x] O standby virou contrato de dados reutilizavel por `model-gateway-runtime-standby-plan`.
- [x] O standby virou contrato persistivel com snapshot por perfil em `copilot_model_gateway_standby_plans`.
- [ ] O terminal ainda nao mostra `fallbackFromSelectedRouteKey` e `fallbackReason` em auto status.
- [ ] A policy default ainda esta conservadora demais para o modo operador/LLM guardado.
- [ ] Falta preset claro para `operator_manual`, `llm_operator_guarded`, `auto_same_boundary` e `auto_prepare_new_session`.
- [ ] Falta um comando terminal unico que diga: modelo vivo, modelo preparado, melhor rota, standby e proximo passo.
- [ ] Falta live fixture especifica para post-turn fallback real sem provider call.
- [ ] Falta live test LLM-B em escada apos consolidar o cockpit.
- [ ] Falta acoplar confirmacao de novo boot SDK ao fluxo automatico de troca de provider.
- [ ] Falta registrar artifact paths de todas as etapas live no cockpit.

## 4. Arquitetura Ideal

### 4.1 Fluxo De Operador

1. Operador roda `npm run model-gateway:operator-ready` ou `/byok gateway operator-ready`.
2. Sistema mostra status unificado sem chamar provider.
3. Operador ve rota atual, rota recomendada, standby e blockers.
4. Operador pode pedir `/byok auto apply profile:repo_agent allow-live-set-model`.
5. Se a boundary for igual, terminal troca o modelo vivo.
6. Se a boundary mudar, terminal prepara novo boot SDK.
7. Se uma rota falhar, post-turn recovery registra health e promove standby quando possivel.
8. Operador pode ver `/byok auto recoveries`, `/byok auto confirmations` e `/byok auto handoffs`.
9. LLM operadora usa exatamente a mesma escada, com JSON quando estiver fora do terminal.

### 4.2 Fluxo De Selecao

1. Catalogo canonico fornece metadados normalizados.
2. Eligibility aplica regras estaveis e policy do operador.
3. Runtime overlays removem auth/key/quota/rate-limit bloqueados.
4. Pre-runtime selection escolhe candidatos sem rodar modelo.
5. Runtime selector transforma candidatos em rotas operacionais.
6. Standby contract mantem fila pronta de substitutos.
7. Runtime probes reais acontecem apenas com opt-in.
8. Live runtime selection usa provas existentes e falhas observadas.

### 4.3 Fluxo De Quota E Falhas

1. Provider responde erro ou terminal observa falha.
2. Falha e classificada como auth, credits, quota, rate-limit, model-inaccessible, timeout ou unknown.
3. Health operacional recebe scope provider/model/profile.
4. SQLite espelha health sem tocar no catalogo.
5. Selector exclui rota bloqueada enquanto cooldown/reset estiver ativo.
6. Standby fornece substituto.
7. Clear manual remove health quando operador sabe que resetou.

## 5. Roadmap Operacional

### Faixa A - Runner, Scripts E Comandos Canonicos

- [x] A.1 Centralizar scripts de model-gateway em `scripts/model-gateway/`.
- [x] A.2 Mover executaveis para `scripts/model-gateway/commands/`.
- [x] A.3 Mover helper dotenv para `scripts/model-gateway/lib/env.mjs`.
- [x] A.4 Manter `scripts/model-gateway/index.mjs` como barrel unico.
- [x] A.5 Manter `scripts/model-gateway/run.mjs` como runner unico.
- [x] A.6 Expor manifesto JSON por `npm run model-gateway:scripts`.
- [x] A.7 Expor manifesto JSON por `make model-gateway-scripts`.
- [x] A.8 Proteger package scripts contra caminhos internos diretos.
- [x] A.9 Documentar layout no README dos scripts.
- [x] A.10 Expor manifesto em `/byok gateway commands`.
- [x] A.11 Expor `operator-ready` em `/byok gateway operator-ready`.
- [ ] A.12 Exibir runner ids nos comandos de ajuda do terminal.

### Faixa B - Cockpit Unico Para Operador Humano E LLM

- [x] B.1 Criar script read-only `model-gateway:operator-ready`.
- [x] B.2 Agregar ops, auto-ready, runtime-selector, standby e health diff.
- [x] B.3 Expor checks booleanos e blockers.
- [x] B.4 Expor next safe commands.
- [x] B.5 Renderizar cockpit no terminal.
- [ ] B.6 Mostrar modelo vivo, preparado e alvo em uma unica tela.
- [ ] B.7 Mostrar fallback reason e fallback origin.
- [ ] B.8 Mostrar standby top-N por profile.
- [ ] B.9 Mostrar comandos de troca agrupados por risco.
- [ ] B.10 Garantir modo JSON estavel para LLM.

### Faixa C - Policy Default E Presets

- [x] C.1 Default atual e conservador e nao aplica efeitos sem opt-in.
- [ ] C.2 Definir preset `operator_manual`.
- [ ] C.3 Definir preset `llm_operator_guarded`.
- [ ] C.4 Definir preset `auto_same_boundary`.
- [ ] C.5 Definir preset `auto_prepare_new_session`.
- [ ] C.6 Expor preset em `/byok auto on preset:<id>`.
- [ ] C.7 Persistir snapshot da policy em cada decisao automatica.
- [ ] C.8 Explicar divergencia entre policy file e env.
- [ ] C.9 Garantir que local/Ollama continua opt-in em todos os presets.

### Faixa D - Standby Contract

- [x] D.1 Gerar standby routes a partir do runtime selector.
- [x] D.2 Incluir comandos probe/live/provider/persist/new-session em cada rota.
- [x] D.3 Usar standby no post-turn fallback decision.
- [x] D.4 Criar objeto `model-gateway-runtime-standby-plan`.
- [x] D.5 Persistir ultimo standby plan por profile no SQLite.
- [x] D.6 Expor leitura read-only do standby persistido.
- [x] D.7 Expor standby plan no cockpit terminal.
- [ ] D.8 Separar `same_boundary`, `new_model_same_provider`, `new_provider`, `needs_probe`.
- [ ] D.9 Registrar origem da exclusao quando standby estiver vazio.
- [ ] D.10 Criar fixture de standby com falha da rota primaria.

### Faixa E - Runtime Automation Core

- [x] E.1 Decision core e puro.
- [x] E.2 Controller core converte decision em efeitos.
- [x] E.3 Adapter terminal aplica efeitos apenas quando policy autoriza.
- [x] E.4 Post-turn recovery registra health operacional.
- [x] E.5 Fallback post-turn evita repetir a rota que falhou.
- [ ] E.6 Registrar fallback fields nos ledgers de efeito/recovery.
- [x] E.7 Expor fallback fields no terminal.
- [ ] E.8 Confirmar novo boot SDK apos `prepare_new_session`.
- [ ] E.9 Reavaliar selector apos confirmacao de novo boot.
- [ ] E.10 Criar modo dry-run textual curto para operador.

### Faixa F - Quota, Conta/Key E Cooldowns

- [x] F.1 Runtime health diff existe.
- [x] F.2 Runtime health clear remove JSON e SQLite por scope.
- [x] F.3 Rate-limit pode carregar retryAfter/reset.
- [ ] F.4 Separar quota Copilot SDK de quota BYOK em todos os cockpits.
- [ ] F.5 Diferenciar credits esgotados de rate-limit temporario.
- [ ] F.6 Tratar model inaccessible como acesso/key, nao como qualidade do modelo.
- [ ] F.7 Mostrar resetAt/nextRetry no cockpit terminal.
- [ ] F.8 Nao tentar rota em cooldown hard salvo clear/override explicito.
- [ ] F.9 Expor clear recomendado por scope no operator-ready.

### Faixa G - Terminal UX

- [x] G.1 `/byok auto status` existe.
- [x] G.2 `/byok auto apply` existe.
- [x] G.3 `/byok auto standby` existe.
- [x] G.4 `/byok auto proof-plan` existe.
- [x] G.5 `/byok auto recovery-fixture` existe.
- [x] G.6 `/byok gateway operator-ready` deve existir.
- [ ] G.7 `/byok gateway scripts` deve existir.
- [ ] G.8 Help principal deve apontar para operator-ready.
- [ ] G.9 Auto status deve incluir fallback origin/reason.
- [ ] G.10 Auto doctor deve mostrar proximo passo humano e LLM separadamente.

### Faixa H - Live Tests LLM-B

- [x] H.1 Runner live esta em `scripts/model-gateway/commands/`.
- [x] H.2 Live no-PR real ja foi executado com sucesso anteriormente.
- [x] H.3 Live readiness passou apos reorganizacao.
- [ ] H.4 Rodar live control no-PR apos terminal operator-ready.
- [ ] H.5 Rodar live BYOK fixture no-PR.
- [x] H.6 Rodar live auto-probe.
- [ ] H.7 Rodar live real no-PR com runtime selector.
- [ ] H.8 Rodar live fallback fixture com post-turn recovery.
- [x] H.9 Registrar artifact paths no guia e no ledger.
- [ ] H.10 Corrigir bugs encontrados e repetir readiness.

### Faixa I - Integracao Ao Runtime Automatizado

- [x] I.1 Pre-turn automation existe.
- [x] I.2 Post-turn automation existe.
- [ ] I.3 Garantir que terminal chama pre-turn no ponto correto do loop real.
- [ ] I.4 Garantir que terminal chama post-turn em falhas reais de modelo BYOK.
- [ ] I.5 Garantir que apply live model nao conflita com model projection do SDK.
- [ ] I.6 Garantir que prepare new session mostra handoff visivel ao operador.
- [ ] I.7 Implementar auto switch por esgotamento de modelo quando policy permitir.
- [ ] I.8 Implementar pedido manual de troca para uma lista de standby.
- [ ] I.9 Implementar retorno seguro quando todos os fallbacks falham.

### Faixa J - Observabilidade E Artifacts

- [x] J.1 Automation decisions no SQLite.
- [x] J.2 Effect applications no SQLite.
- [x] J.3 SDK handoffs no SQLite.
- [x] J.4 SDK confirmations no SQLite.
- [x] J.5 Recovery attempts no SQLite.
- [x] J.6 Live runs no SQLite.
- [x] J.7 Registrar selected standby snapshot.
- [x] J.8 Diagnostico SQLite expoe `standbyPlanRows` e ultimo standby plan.
- [x] J.9 Retencao operacional inclui standby plans sem tocar no catalogo canonico.
- [x] J.10 `operator-ready` diferencia standby gerado agora e standby persistido.
- [ ] J.11 Registrar fallback selected after failure.
- [ ] J.12 Registrar artifact path do operator-ready.
- [ ] J.13 Criar resumo final por sessao de testes live.

### Faixa K - Testes E Validadores

- [x] K.1 Contratos de model-gateway cobrem runner/barrel.
- [x] K.2 Lint escopado passa.
- [x] K.3 Operator-ready passa.
- [x] K.4 Testes terminal cobrem `/byok gateway operator-ready`.
- [x] K.5 Testes cobrem fallback fields no terminal.
- [ ] K.6 Testes cobrem presets de policy.
- [x] K.9 Testes cobrem `model-gateway-runtime-standby-plan`.
- [ ] K.7 Live tests cobrem fixture e real no-PR.
- [ ] K.8 Typecheck strict deve ser reavaliado depois das proximas mudancas grandes.

## 6. Sequencia Imediata

1. [x] Fechar fallback post-turn por standby.
2. [x] Commit/push do fallback.
3. [x] Reorganizar scripts em runner, commands e lib.
4. [x] Expor manifesto `model-gateway:scripts`.
5. [x] Validar runner, operator-ready, runtime-selector e contratos.
6. [x] Criar este guia operacional.
7. [x] Implementar `/byok gateway operator-ready`.
8. [x] Mostrar fallback origin/reason em `/byok auto status`.
9. [x] Criar contrato de standby plan.
10. [x] Persistir standby plan por perfil.
11. [x] Rodar testes terminal escopados.
12. [x] Commit/push da reorganizacao e cockpit terminal.
13. [ ] Continuar para live tests LLM-B em escada.

## 7. Comandos Canonicos Desta Fase

```bash
npm run model-gateway:scripts
npm run model-gateway:commands:json
npm run model-gateway:operator-ready
npm run model-gateway:runtime-selector -- --fail
npm run model-gateway:auto:standby -- --profile=repo_agent --limit=12
npm run model-gateway:auto:standby -- --profile=repo_agent --limit=12 --write-sqlite
npm run model-gateway:auto:standby -- --profile=repo_agent --read-sqlite --json
npm run model-gateway:auto:status -- --profile=repo_agent
npm run model-gateway:live:readiness -- --fail
npm run model-gateway:live:llm-b -- --no-pr --timeout-ms=180000
```

## 8. Criterios De Prontidao Para Live Tests

- [ ] Operator-ready package ok.
- [x] Operator-ready terminal ok.
- [ ] Runtime selector ok.
- [ ] Standby com pelo menos duas rotas de providers diferentes.
- [ ] Runtime health diff sem regressao nova.
- [ ] Auto status explica fallback quando houver falha simulada.
- [x] Recovery fixture grava ledger e nao chama provider.
- [ ] Lint escopado passa.
- [ ] Testes model-gateway e terminal escopados passam.

## 9. Evidencias Live Recentes

- [x] 2026-06-02T01:58:35.575Z - `npm run model-gateway:live:auto-probe` passou sem abrir turno de modelo e sem provider call.
- [x] Artifact: `artifacts/terminal-live/2026-06-02T01-58-35-568Z/summary.md`.
- [x] Check `gateway-operator-ready-visible` confirmou `/byok gateway operator-ready`.
- [x] Check `auto-recovery-fixture-visible` confirmou recovery sintético com health persistida.
- [x] Check `no-terminal-errors` confirmou error tracker limpo.
