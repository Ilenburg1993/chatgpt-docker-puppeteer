# Canonical Model Gateway Runtime Automation Roadmap 2026-06-01

Status: guia ativo para operacionalizacao completa do model-gateway.

Escopo primario: `src/copilot/model-gateway`, `src/copilot/terminal`, `src/copilot/sdk`, `scripts/model-gateway`.

Guia legado: `CANONICAL_MODEL_GATEWAY_BYOK_NEXT_GUIDE_2026-05-26.md`.

Este documento consolida a auditoria feita em 2026-06-01 depois da reorganizacao dos scripts em
`scripts/model-gateway/`.

## 1. Objetivo

O objetivo agora nao e apenas ter catalogo, selecao e probes.

O objetivo e transformar o model-gateway em um sistema operacional completo para o terminal:

- coletar metadados ricos;
- normalizar tudo em schema compativel com OpenAI;
- separar metadados estaveis de estado volatil de conta/key/runtime;
- selecionar antes do runtime;
- executar runtime selector com fallback bounded;
- registrar sucesso/falha;
- atualizar health e overlays;
- permitir modo automatico continuo;
- trocar modelo quando a politica permitir;
- pedir novo boot de sessao quando o boundary de provider exigir;
- explicar cada decisao ao operador;
- manter comandos canonicos simples para humanos e LLMs.

## 2. Situacao Atual

### 2.1 Banco de metadados

- [x] SQLite existe e tem schema versionado.
- [x] Store persiste snapshots, sources, model evidence, provider evidence, projections, route options, account overlays,
  runtime probes, health observations, route decisions e refresh log.
- [x] Build de metadados existe como comando canonico.
- [x] Refresh provider-scoped existe.
- [x] Diagnostics SQLite existe.
- [x] Retention operacional existe.
- [x] Raw payload refs existem com politica de redacao.
- [x] Redaction audit existe.
- [ ] Ainda falta um plano claro de migracao incremental quando novos provider fields exigirem novas colunas/materializacoes.
- [ ] Ainda falta um resumo operacional unico que diga se o banco esta pronto para ser usado pelo terminal sem build full.

### 2.2 Importers e catalogo

- [x] Ha importers para OpenAI, OpenRouter, Zai, Kilo, OpenCode, Cerebras, Groq, Gemini, Mistral, Anthropic, Chutes,
  Cloudflare Workers AI, HuggingFace, Nvidia NIM, Ollama e docs associadas.
- [x] Providers tem specs/endpoints em arquivos proprios.
- [x] Ollama local e suportado.
- [x] Ollama local nao deve ser selecionado por default.
- [ ] Ainda falta matriz unica por provider com endpoints disponiveis, auth, list models, account limits, rate-limit headers
  e particularidades de auto selection.
- [ ] Ainda falta auditoria automatica de cobertura por provider baseada naquilo que o provider poderia expor e aquilo que
  coletamos.

### 2.3 Pre-runtime

- [x] Eligibility existe.
- [x] Account overlays existem.
- [x] Runtime failures podem derivar overlays volateis.
- [x] Runtime health pode excluir rotas com falhas recentes.
- [x] Policy engine tem score, reasons, rejectedReasons e scoreBreakdown.
- [x] Runtime selector dry-run existe.
- [x] Runtime selector execution bounded existe.
- [x] Route decisions sao persistiveis.
- [x] Score reasons chegam ao runtime selector e ao route decision ledger.
- [x] Existe objeto unico de `runtime automation decision` que combina politica, rota selecionada, aplicabilidade
  na sessao viva e proxima acao.

### 2.4 Terminal

- [x] `/byok` ja mostra status, modelos, recomendacoes, probes, health e model-gateway cockpit.
- [x] `/byok model <id>` tenta `setModel` apenas quando a sessao viva nasceu no mesmo provider BYOK.
- [x] Session binding impede cruzar provider/perfil silenciosamente.
- [x] Dialog engine registra falhas BYOK de turno como provider health.
- [x] Admission control bloqueia ou avisa quando o envelope de tokens parece incompatível.
- [x] Existe comando read-only de modo automatico do model-gateway no terminal.
- [ ] Ainda falta um controlador que rode antes/depois do turno e decida se deve manter, trocar modelo, solicitar novo boot
  ou aguardar reset.
- [x] Existe UX read-only para explicar quando a troca pode ser live e quando exige nova sessao.

### 2.5 SDK boundary

- [x] onListModels pode projetar modelos do model-gateway para o SDK.
- [x] Projection preserva provider-local id, gateway id, route id e metadados BYOK.
- [x] Auto model nativo do GitHub Copilot existe como outra politica.
- [ ] Ainda falta separar claramente "Copilot SDK auto" de "model-gateway auto".
- [x] Existe policy inicial que diz quando podemos usar `setModel`, quando precisamos `session sdk next new`, e quando
  devemos apenas preparar env para o proximo boot.

### 2.6 Scripts e comandos

- [x] Scripts operacionais do model-gateway foram movidos para `scripts/model-gateway/`.
- [x] `scripts/model-gateway/index.mjs` e o barril de caminhos.
- [x] `package.json` aponta para a nova pasta.
- [x] `model-gateway:commands:json` passa.
- [x] `model-gateway:sqlite:diagnostics` passa.
- [x] `model-gateway:live:readiness` passa.
- [x] `model-gateway:live:plan --no-write` passa.
- [x] Existe comando canonico para explicar "estado operacional completo" em uma tela.
- [x] Existe comando canonico para o futuro modo auto sem executar provider por acidente.

## 3. Arquitetura Ideal

### 3.1 Camadas

Camada 1: Catalogo canonico.

- Dados publicos e relativamente estaveis.
- Metadados de modelo.
- Metadados de provider.
- Endpoints.
- Precos.
- Limites documentados.
- Capacidades.
- Modos de selecao automatica do provider.

Camada 2: Estado de conta/key.

- Dados volateis.
- Acesso real da key.
- Quota.
- Rate limit.
- Creditos.
- Spending.
- Reset windows.
- Falhas account-wide.
- Expiracao.

Camada 3: Pre-runtime selection.

- Usa catalogo + conta/key + preferencias do operador.
- Exclui o obvio antes de chamar modelo.
- Nao executa providers.
- Produz decision trace.

Camada 4: Runtime selector.

- Usa decision trace + runtime health.
- Pode executar probes ou turnos descartaveis somente quando explicitamente permitido.
- Tem fallback bounded.
- Registra health e route decisions.

Camada 5: Terminal automation controller.

- Decide o que fazer na sessao viva.
- Aplica modelo live se mesmo provider boundary.
- Agenda novo SDK session boot se provider/perfil mudou.
- Usa health recente para evitar modelo esgotado.
- Explica ao operador.

Camada 6: Runtime UX.

- Comandos `/byok auto`, `/byok auto status`, `/byok auto apply`, `/byok auto off`.
- Mensagens de turno quando fallback aconteceu.
- Logs e artifacts.
- Nenhuma troca silenciosa cruzando provider.

## 4. Principios

- [x] Metadado canonico nao deve ser mutado por runtime.
- [x] Quota e estado de key, nao metadado do modelo.
- [x] Falha de provider real deve virar health/overlay volatil.
- [x] Vision nao e hard gate por default.
- [x] Ollama local e opt-in.
- [x] Provider boundary importa mais que model id.
- [x] `setModel` live so e seguro dentro do mesmo provider BYOK.
- [x] Troca cruzando provider exige novo boot de sessao.
- [x] Todo auto deve ser explicavel e reversivel.
- [x] Todo comando que executa provider deve exigir flag explicita.

## 5. Gaps Criticos

### Gap 1: Nao ha objeto unico de automacao

Hoje temos:

- policy resolution;
- runtime selector plan;
- runtime execution result;
- terminal byok summary;
- sdk binding classifier;
- provider health.

Mas nao ha um `ModelGatewayRuntimeAutomationDecision`.

Esse objeto precisa responder:

- qual rota desejada;
- qual rota viva atual;
- se o provider boundary e igual;
- se `setModel` live e permitido;
- se novo boot e necessario;
- se ha blocker de quota/rate-limit/auth;
- se ha cooldown;
- qual comando o operador deve executar;
- se o modo auto pode agir sem interacao.

### Gap 2: Auto atual do SDK nao e auto do gateway

`/model auto` delega ao GitHub Copilot.

O model-gateway precisa de outro modo:

- `gateway_auto`;
- provider BYOK;
- policy local;
- health-aware;
- account-aware;
- route-profile-aware.

### Gap 3: Turn failure nao dispara replanejamento

O dialog engine registra falha BYOK.

Mas o proximo turno ainda depende do operador acionar comandos.

Precisamos de:

- post-failure hook;
- refresh runtime overlays;
- runtime selector dry-run;
- decisao de manter/trocar/agendar novo boot;
- mensagem curta para o operador.

### Gap 4: Sessao viva e env preparado podem divergir

`classifyTerminalByokSdkBinding()` ja explica a divergencia.

Mas o sistema automatico precisa consumir isso como contrato, nao como texto.

### Gap 5: Comandos canônicos ainda sao muitos

Ha 103 comandos no inventory.

Precisamos de um cockpit operacional unico:

- status;
- banco;
- selection;
- runtime;
- auto;
- next action.

## 6. Roadmap

## Faixa A - Contrato De Automacao Runtime

- [x] A.1 Criar modulo `src/copilot/model-gateway/automation/`.
- [x] A.2 Criar barrel `automation/index.js`.
- [x] A.3 Definir `buildModelGatewayRuntimeAutomationDecision()`.
- [ ] A.4 Entrada deve aceitar:
  - [ ] terminal BYOK summary;
  - [ ] persisted SDK binding;
  - [ ] runtime selector plan;
  - [ ] provider health records;
  - [ ] operator policy.
- [x] A.5 Saida deve conter:
  - [x] `status`;
  - [x] `action`;
  - [x] `canApplyLiveModel`;
  - [x] `requiresNewSession`;
  - [x] `selectedRouteKey`;
  - [x] `currentBoundary`;
  - [x] `targetBoundary`;
  - [x] `blockers`;
  - [x] `nextCommands`;
  - [x] `operatorSummary`.
- [x] A.6 Adicionar testes unitarios para:
  - [x] mesmo provider troca live;
  - [x] provider diferente exige novo boot;
  - [x] quota esgotada bloqueia rota;
  - [x] rate-limit com reset recomenda aguardar;
  - [x] Ollama local sem opt-in nao entra.

## Faixa B - Politica Auto Do Gateway

- [x] B.1 Definir envs:
  - [x] `COPILOT_BYOK_GATEWAY_AUTO`;
  - [x] `COPILOT_BYOK_GATEWAY_AUTO_POLICY`;
  - [x] `COPILOT_BYOK_GATEWAY_AUTO_PROFILES`;
  - [x] `COPILOT_BYOK_GATEWAY_AUTO_ALLOW_LIVE_SET_MODEL`;
  - [x] `COPILOT_BYOK_GATEWAY_AUTO_ALLOW_NEW_SESSION`;
  - [x] `COPILOT_BYOK_GATEWAY_AUTO_ALLOW_PROVIDER_PROBES`.
- [x] B.2 Criar parser de policy.
- [x] B.3 Defaults:
  - [x] auto off;
  - [x] probes off;
  - [x] live setModel allowed only same provider;
  - [x] new session advisory unless explicit.
- [x] B.4 Integrar policy ao automation decision.

## Faixa C - Controller Pre/Post Turn

- [x] C.1 Criar controller puro sem side effects.
- [x] C.2 Criar adapter terminal.
- [ ] C.3 Pre-turn:
  - [ ] avaliar current route;
  - [ ] se health bloqueia, replanejar;
  - [ ] se mesma boundary, aplicar live model quando policy permite;
  - [ ] se boundary diferente, avisar/planejar novo boot.
- [ ] C.4 Post-turn:
  - [ ] se sucesso, registrar estabilidade;
  - [x] se falha, health ja registrado;
  - [ ] derivar overlay;
  - [ ] replanejar fallback;
  - [x] exibir next action.

## Faixa D - Terminal UX

- [x] D.1 Adicionar `/byok auto`.
- [x] D.2 Adicionar `/byok auto status`.
- [x] D.3 Adicionar `/byok auto plan`.
- [x] D.4 Adicionar `/byok auto apply`.
- [x] D.5 Adicionar `/byok auto off`.
- [x] D.6 `status` deve mostrar:
  - [x] policy;
  - [x] rota viva;
  - [x] rota recomendada;
  - [x] live switch possivel;
  - [x] novo boot necessario;
  - [x] blockers;
  - [x] next command.

## Faixa E - Scripts Operacionais

- [x] E.1 Mover scripts para `scripts/model-gateway/`.
- [x] E.2 Criar barril `scripts/model-gateway/index.mjs`.
- [x] E.3 Migrar `package.json`.
- [x] E.4 Migrar runner llm-b para chamar runtime selector novo.
- [x] E.5 Criar `model-gateway:auto:status`.
- [x] E.6 Criar `model-gateway:auto:plan`.
- [x] E.7 Criar `model-gateway:ops`.

## Faixa F - Persistencia E Observabilidade

- [x] F.1 Route decisions persistem scoreBreakdown.
- [x] F.2 Runtime selector registra pre-decision e outcome.
- [x] F.3 Persistir automation decisions.
- [x] F.4 Adicionar tabela ou payload type para automation decision.
- [x] F.5 Retention para automation decisions.
- [x] F.6 Diagnostics devem mostrar contagem operacional de automation decisions.

## Faixa G - Account/Key Dinamico

- [x] G.1 Classificacao de auth/credits/rate-limit existe.
- [x] G.2 Runtime overlays derivados de health existem.
- [ ] G.3 Tornar account-wide failure kinds configuraveis no controller.
- [ ] G.4 Diferenciar quota hard, rate-limit resetavel, auth invalid, model unavailable.
- [x] G.5 Expor cooldown no comando auto status.

## Faixa H - Integracao Com SDK Session

- [x] H.1 Session binding classifier existe.
- [x] H.2 setModel live e restrito a mesma boundary.
- [ ] H.3 Automation decision deve consumir classifier.
- [x] H.4 Quando provider muda, preparar `session sdk next new`.
- [x] H.5 Quando so modelo muda, aplicar `setModel` se permitido.
- [ ] H.6 Confirmar modelo efetivo via usage/session.model_changed.

## Faixa I - Runtime Selector Mais Operacional

- [x] I.1 Runtime selector dry-run.
- [x] I.2 Runtime selector execute bounded.
- [x] I.3 Fallback bounded por provider.
- [x] I.4 Preferred probes live.
- [x] I.5 Expor helper puro para "melhor rota para automacao".
- [x] I.6 Retornar motivo de nao acao quando plan ok mas terminal nao pode aplicar.

## Faixa J - Comandos Canonicos Para Operador

- [x] J.1 `model-gateway:commands`.
- [x] J.2 `model-gateway:live:readiness`.
- [x] J.3 `model-gateway:live:plan`.
- [x] J.4 `model-gateway:ops`.
- [x] J.5 `model-gateway:auto:status`.
- [x] J.6 `model-gateway:auto:plan`.
- [x] J.7 Makefile targets correspondentes.

## Faixa K - Testes Live LLM-B

- [x] K.1 Runner live real existe.
- [x] K.2 Full-turn BYOK real ja passou uma vez.
- [ ] K.3 Teste live para auto status.
- [ ] K.4 Teste live para falha simulada e fallback.
- [ ] K.5 Teste live para mesma boundary e setModel.
- [ ] K.6 Teste live para boundary diferente e novo boot recomendado.

## Faixa L - Documentacao Operacional

- [x] L.1 Este roadmap criado.
- [x] L.2 README curto para `scripts/model-gateway/`.
- [x] L.3 Atualizar `src/copilot/model-gateway/README.md`.
- [ ] L.4 Atualizar comandos `/byok` help.
- [ ] L.5 Atualizar guia de operador para auto mode.

## Faixa M - Chancela De Pronto

- [ ] M.1 Lint escopado.
- [ ] M.2 Typecheck strict src/copilot.
- [ ] M.3 Testes unitarios model-gateway escopados.
- [ ] M.4 Testes terminal BYOK escopados.
- [ ] M.5 Live readiness.
- [ ] M.6 Live plan.
- [ ] M.7 Live llm-b control.
- [ ] M.8 Live llm-b real no-pr.
- [ ] M.9 Live llm-b full turn.
- [ ] M.10 Relatorio final de chancela.

## 7. Fluxo Operacional Ideal

1. Operador configura keys.
2. Operador roda `npm run model-gateway:ops`.
3. Sistema mostra banco, coverage, selection, runtime health e auto status.
4. Operador ativa `/byok auto on` ou env equivalente.
5. Antes do turno, controller avalia rota atual.
6. Se rota atual esta boa, nada muda.
7. Se modelo esta esgotado, controller replaneja.
8. Se fallback e mesmo provider boundary, aplica live model.
9. Se fallback cruza provider, prepara proximo boot e avisa.
10. Turno roda.
11. Falha BYOK vira health.
12. Health vira overlay quando aplicavel.
13. Proximo turno usa overlay antes de runtime.
14. Operador sempre ve o motivo e o proximo comando.

## 8. Primeiras Implementacoes Recomendadas

1. Criar `automation/decision.js`.
2. Criar testes puros de decision.
3. Criar script `model-gateway-auto-status.mjs`.
4. Adicionar comandos npm/make.
5. Integrar `/byok auto status`.
6. So depois conectar pre/post turn controller.

## 9. Criterio De Nao Regressao

- Nenhum comando model-gateway deve executar provider sem flag explicita.
- Nenhuma troca live deve cruzar provider boundary.
- Nenhum dado de secret deve aparecer em doc, JSON ou SQLite payload.
- Ollama local permanece opt-in.
- Runtime health nao pode mutar metadado canonico.
- Route decisions devem continuar redigidos.

## 10. Proxima Acao

Implementar Faixa A com contrato puro e testes.

Depois implementar Faixa E.5/E.6 com script de status/plano.

Depois ligar ao terminal.
