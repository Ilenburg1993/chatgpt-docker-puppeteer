# Canonical Model Gateway Auto Runtime Operability Roadmap

Data: 2026-06-01

Status: guia operacional ativo para transformar o model-gateway em sistema funcional, didatico e automatizado no terminal.

Escopo primario: `src/copilot/model-gateway/`

Escopo de integracao: `src/copilot/terminal/`, `src/copilot/config/`, `src/copilot/presentation/sdk/`, `scripts/model-gateway/`, `package.json`, `Makefile`.

Roadmaps anteriores continuam como historico. Este arquivo concentra a linha atual: fazer o banco de metadados, a selecao
pre-runtime e o runtime selector virarem uma experiencia operacional real, com modo auto do terminal, fallback entre
modelos e troca controlada quando um modelo se esgota, falha ou quando o operador pede.

---

## 1. Objetivo

Queremos que o operador consiga trabalhar no terminal com uma politica declarada e simples, por exemplo:

```text
/byok auto on profile:repo_agent allow-live-set-model allow-new-session
```

A partir disso, o sistema deve:

- [x] Saber quais modelos existem no catalogo canonico.
- [x] Saber quais rotas sao candidatas para cada perfil de tarefa.
- [x] Saber que dados pertencem ao catalogo estavel e que dados pertencem ao estado operacional volatil.
- [x] Excluir Ollama/local por padrao, salvo pedido explicito.
- [x] Fazer selecao pre-runtime sem chamar provider.
- [x] Aplicar health/overlays operacionais sem corromper metadados canonicos.
- [x] Rodar um controller pre-turn quando a policy auto estiver ligada.
- [ ] Rodar um controller post-turn completo quando a chamada BYOK falhar.
- [ ] Preparar novo boot SDK automaticamente quando a mudanca de provider/perfil exigir nova sessao.
- [ ] Confirmar aplicacao real via eventos de sessao/modelo.
- [ ] Oferecer cockpit unico para saber se o modo auto esta pronto.
- [ ] Fazer live tests llm-b cobrindo sucesso, falha, quota, rate-limit, troca live e novo boot.

---

## 2. Principios De Arquitetura

### 2.1 Metadado canonico nao e estado operacional

O catalogo canonico responde: "o que se sabe sobre providers, modelos, endpoints, capacidades e precos".

Ele nao deve responder sozinho: "a key atual pode rodar este modelo agora?".

Essa segunda pergunta muda com frequencia e pertence a overlays, health e historico operacional.

### 2.2 Selecao pre-runtime vem antes de probes

O fluxo correto e:

1. Importar e normalizar metadados.
2. Avaliar env/secrets e requisitos de provider.
3. Aplicar overlays de conta/key quando existirem.
4. Aplicar runtime health persistido.
5. Selecionar uma rota candidata sem chamar provider.
6. So depois, se a politica permitir, executar probe ou chamada real.

### 2.3 Runtime health nao reescreve catalogo

Falhas como `rate-limit`, `credits`, `auth`, `timeout`, `network`, `model-or-route` e `upstream` devem ser gravadas como
estado operacional. Elas podem excluir ou rebaixar rotas temporariamente, mas nao devem apagar ou adulterar a ficha do
modelo no catalogo.

### 2.4 Troca live so dentro da mesma boundary

`setModel` vivo so e permitido quando a sessao SDK atual ja nasceu no mesmo provider/perfil/base URL compativel.

Trocar provider, tipo de wire, base URL, segredo ou perfil exige novo boot SDK.

### 2.5 Modo auto precisa ser audivel

Toda decisao automatica deve deixar rastro:

- decision id;
- timestamp;
- profile;
- rota selecionada;
- acao;
- blockers;
- efeitos autorizados;
- efeitos aplicados;
- efeitos pulados;
- erro/falha quando houver;
- proximo passo recomendado.

### 2.6 Operador continua no controle de efeitos perigosos

Por default:

- [x] `allowLiveSetModel=false`.
- [x] `allowNewSession=false`.
- [x] `allowProviderProbes=false`.
- [x] `allowLocalPrivate=false`.

O operador pode ligar explicitamente. Quando ligado, o sistema deve aplicar efeitos sem janelas manuais internas,
mas mantendo rastreabilidade e sem vazar segredo.

---

## 3. Situacao Atual Auditada

### 3.1 Catalogo e metadados

- [x] `src/copilot/model-gateway/catalog/` possui contratos, normalizadores, stores JSON/SQLite e refresh.
- [x] Importers existem para OpenRouter, OpenAI, Anthropic, Groq, Gemini, Mistral, Cerebras, Chutes, Cloudflare Workers AI,
  HuggingFace, Kilo, Nvidia NIM, Ollama, OpenCode Zen e Z.ai.
- [x] Cada provider relevante possui arquivos de endpoints/specs/adapters.
- [x] `openai-schema.js` projeta catalogo para formato OpenAI.
- [x] SQLite possui schema operacional e diagnosticos.
- [x] Refresh incremental por provider existe.
- [ ] Falta consolidar comando unico de "catalog health" com status de freshness por source/importer/provider.
- [ ] Falta maior cobertura de importers que distinguem "modelo existe" de "key tem acesso".
- [ ] Falta cockpit de payload bruto sanitizado por provider/source.

### 3.2 Elegibilidade e pre-runtime

- [x] `eligibility/` separa policies, decisions e aplicacao ao snapshot.
- [x] `selection-audit.js` compara pre-runtime e post-runtime.
- [x] Local/private e bloqueado por padrao.
- [x] Env requirements entram na avaliacao.
- [x] Runtime health influencia selecao sem alterar catalogo.
- [ ] Falta uma explicacao unificada "por que este modelo foi excluido antes de runtime".
- [ ] Falta classificar explicitamente "sem acesso pela key" como blocker distinto de "modelo indisponivel".
- [ ] Falta freshness de overlays aparecer claramente no seletor.

### 3.3 Runtime selector

- [x] `routing/runtime-selector.js` tem plano e execucao bounded com probes opcionais.
- [x] Planos podem usar fallback profiles.
- [x] Execucao grava health e route decision.
- [x] Probes sao opt-in.
- [x] Runtime selector consegue produzir env de rota.
- [ ] Falta integrar plenamente o resultado do runtime selector ao boot real do terminal.
- [ ] Falta state machine para "selected -> prepared -> booting -> confirmed -> active".
- [ ] Falta fallback automatico post-falha dentro do terminal em modo auto.

### 3.4 Automacao

- [x] `automation/policy.js` le env e arquivo persistente.
- [x] `/byok auto on` persiste policy sem segredo.
- [x] `/byok auto status`, `record`, `apply`, `history`, `off` existem.
- [x] `gateway-auto.js` roda status/plan e aplica efeitos de terminal.
- [x] Engine chama pre-turn automation quando policy esta ligada.
- [x] Decisoes pre-turn podem ser persistidas no SQLite.
- [x] `off` edita arquivo persistente.
- [x] `/byok auto policy`.
- [ ] Falta `/byok auto explain`.
- [ ] Falta controller post-turn completo.
- [x] `prepare_new_sdk_session` agenda novo boot SDK quando `allow-new-session` esta autorizado.

### 3.5 Terminal e SDK boundary

- [x] `terminal/dialog/engine.js` classifica falhas BYOK e grava provider health.
- [x] `terminal/byok/session-binding.js` distingue prepared/live binding.
- [x] `/session` mostra boundary BYOK.
- [x] `/usage` separa quota Copilot SDK de BYOK.
- [x] `terminal/frontend/gateways/sdk-session.js` dispoe inventario de sessao.
- [ ] Falta uma API terminal unica para preparar proximo boot SDK a partir de uma route env.
- [ ] Falta confirmacao de `session.model_changed` ligada a decision id.
- [ ] Falta relatorio visual "auto trocou para X" vs "auto preparou proximo boot".
- [ ] Falta comando do operador para pedir "troque automaticamente agora para o melhor fallback".

### 3.6 Scripts e comandos canonicos

- [x] Scripts de model-gateway vivem em `scripts/model-gateway/`.
- [x] `scripts/model-gateway/index.mjs` e o barril canonico.
- [x] `package.json` possui `model-gateway:*`.
- [x] `Makefile` possui `model-gateway-*`.
- [x] Wrapper legado em `scripts/copilot` foi removido.
- [x] Existe contrato que garante paths no barril `scripts/model-gateway`.
- [x] Comando unico `model-gateway:auto:doctor`.
- [x] Comando unico `model-gateway:auto:ready`.
- [ ] Falta script que gere plano de live tests com fixtures e reais.

---

## 4. Arquitetura Ideal

### 4.1 Camadas

```text
Provider APIs / docs / local endpoints
        |
        v
Importers e normalizadores
        |
        v
Catalogo canonico JSON/SQLite
        |
        v
Eligibility + account/key overlays + runtime health
        |
        v
Selecao pre-runtime
        |
        v
Runtime selector plan
        |
        +--> dry-run / explain / cockpit
        |
        +--> probes ou chamada real, somente quando permitido
        |
        v
Automation decision
        |
        v
Controller step
        |
        +--> set live model, se mesma boundary
        +--> prepare next SDK session, se troca de provider/perfil
        +--> wait, se reset temporario
        +--> manual intervention, se blocker duro
```

### 4.2 Estados operacionais propostos

```text
metadata_selected
pre_runtime_selected
runtime_plan_ready
live_same_boundary_applicable
next_session_prepared
sdk_boot_requested
sdk_boot_started
sdk_binding_confirmed
model_changed_confirmed
turn_running
turn_succeeded
turn_failed_retriable
turn_failed_hard
fallback_selected
cooldown_waiting
manual_required
```

### 4.3 Registros operacionais necessarios

- [x] runtime health.
- [x] route decisions.
- [x] automation decisions.
- [x] automation effect applications.
- [x] SDK session handoffs.
- [x] SDK binding confirmations.
- [ ] post-turn recovery attempts.
- [x] operator policy snapshots.
- [ ] live-test scenario runs.

### 4.4 Politica efetiva

Ordem atual: arquivo persistente + env override.

Ordem ideal:

1. defaults seguros;
2. policy file do operador;
3. env explicito;
4. flags de comando;
5. overrides por teste live.

Cada superficie deve mostrar a fonte efetiva.

### 4.5 Handoff para novo boot SDK

Quando a decisao for `prepare_new_session`, o sistema deve:

1. converter rota em env BYOK canonico;
2. gravar handoff operacional sem segredo bruto;
3. marcar `next_session_prepared`;
4. instruir ou acionar `/session sdk next new` conforme policy;
5. no boot seguinte, validar binding;
6. correlacionar com decision id;
7. marcar `sdk_binding_confirmed`;
8. se modelo divergente, registrar mismatch.

### 4.6 Fallback post-falha

Quando um turno falhar:

1. classificar falha;
2. registrar health;
3. derivar overlay operacional quando aplicavel;
4. invalidar ou rebaixar rota falha conforme tipo;
5. rodar selector de novo;
6. decidir se pode trocar live;
7. se nao puder, preparar novo boot;
8. persistir recovery decision;
9. mostrar resumo curto;
10. evitar loop infinito no mesmo modelo.

---

## 5. Gaps De Maior Retorno

- [x] Existe executor puro/compartilhado de efeitos auto no terminal.
- [x] Store SQLite para effect applications.
- [x] Store SQLite para SDK handoffs.
- [x] Comando `/byok auto policy`.
- [ ] Falta comando `/byok auto explain`.
- [ ] Falta `/byok auto switch` ou equivalente para pedir melhor fallback agora.
- [x] `model-gateway:auto:ready`.
- [x] `model-gateway:auto:doctor`.
- [ ] Falta o post-turn controller rodando de verdade.
- [x] `prepare_new_sdk_session` agenda novo boot SDK quando autorizado.
- [ ] Falta confirmar `session.model_changed`.
- [ ] Falta live test fixture cobrindo auto mode sem gastar quota real.
- [ ] Falta live test real com fallback profiles.
- [ ] Falta relatorio final de chancela.

---

## 6. Roadmap

Todos os checkboxes sao booleanos. Nao usar estados parciais.

### Faixa A - Fundacao Canonica De Scripts

- [x] A.1 Concentrar scripts operacionais em `scripts/model-gateway/`.
- [x] A.2 Criar barril `scripts/model-gateway/index.mjs`.
- [x] A.3 Migrar runner live LLM-B para `scripts/model-gateway/`.
- [x] A.4 Remover wrapper legado em `scripts/copilot`.
- [x] A.5 Garantir package scripts canonicos.
- [x] A.6 Garantir Makefile canonico.
- [x] A.7 Criar contrato de path do barril.
- [x] A.8 Criar `model-gateway:auto:ready`.
- [x] A.9 Criar `model-gateway:auto:doctor`.
- [x] A.10 Atualizar README de scripts com fluxo auto completo.

### Faixa B - Policy Persistente E Explicavel

- [x] B.1 Defaults seguros.
- [x] B.2 Env vars de policy.
- [x] B.3 Policy file sem segredo.
- [x] B.4 Merge arquivo + env.
- [x] B.5 `/byok auto on`.
- [x] B.6 `/byok auto policy`.
- [x] B.7 `/byok auto off` mutando policy file para disabled.
- [ ] B.8 Mostrar fonte de cada campo.
- [ ] B.9 Validar policy invalida com erro didatico.
- [ ] B.10 Persistir snapshot de policy usado por cada automation decision.

### Faixa C - Selecao Pre-Runtime Explicavel

- [x] C.1 Auditar catalogo sem provider call.
- [x] C.2 Aplicar env/secrets.
- [x] C.3 Aplicar local/private opt-in.
- [x] C.4 Aplicar runtime health.
- [x] C.5 Gerar plan.
- [ ] C.6 Explicar blockers por modelo e por profile.
- [ ] C.7 Distinguir sem key, key sem acesso, quota temporaria, quota dura e modelo inexistente.
- [ ] C.8 Expor freshness de overlays.
- [ ] C.9 Gerar resumo "melhor candidato excluido por X".
- [ ] C.10 Criar comando terminal compacto para explain.

### Faixa D - Runtime Selector Sem Probes Por Padrao

- [x] D.1 Planejar rota final.
- [x] D.2 Fallback profiles.
- [x] D.3 Preferir runtime proof quando existir.
- [x] D.4 Bloquear local/private sem opt-in.
- [ ] D.5 Expor route env sanitizado no cockpit.
- [ ] D.6 Retornar handoff payload para terminal.
- [ ] D.7 Expor attempts/cooldowns antes de executar.
- [ ] D.8 Separar claramente probe execution de turn execution.
- [ ] D.9 Testar selector com account overlays vencidos.
- [ ] D.10 Testar selector com quota resetavel.

### Faixa E - Automation Decisions

- [x] E.1 Decision pura.
- [x] E.2 Controller step puro.
- [x] E.3 Effects secos.
- [x] E.4 Persistir automation decision.
- [x] E.5 Persistir effect application.
- [ ] E.6 Correlacionar decision id com terminal turn id.
- [ ] E.7 Correlacionar decision id com SDK session id.
- [ ] E.8 Expor action trace.
- [ ] E.9 Criar diff entre duas decisions.
- [ ] E.10 Criar retention especifica para decisions/effects.

### Faixa F - Pre-Turn Controller

- [x] F.1 Rodar antes de cada turno quando policy enabled.
- [x] F.2 Nao rodar quando policy disabled.
- [x] F.3 Usar catalogo + health + selector.
- [x] F.4 Aplicar set live model quando autorizado.
- [x] F.5 Persistir decision pre-turn.
- [x] F.6 Renderizar resumo curto.
- [x] F.7 Persistir effect application.
- [ ] F.8 Evitar repeticao verbosa a cada turno quando nada mudou.
- [ ] F.9 Expor no `/activity` decision id.
- [ ] F.10 Evitar selector pesado quando catalogo/health/policy nao mudaram.

### Faixa G - Post-Turn Controller

- [x] G.1 Classificar falhas BYOK.
- [x] G.2 Gravar runtime health.
- [x] G.3 Mostrar dica auto apos falha.
- [ ] G.4 Rodar controller post-turn de verdade.
- [ ] G.5 Persistir recovery decision.
- [ ] G.6 Replanejar fallback sem provider call.
- [ ] G.7 Aplicar live fallback quando mesma boundary.
- [ ] G.8 Preparar novo boot quando provider/perfil mudar.
- [ ] G.9 Bloquear loops no mesmo modelo falho.
- [ ] G.10 Mostrar cooldown/reset quando existir.

### Faixa H - SDK Session Handoff

- [ ] H.1 Definir contrato `ModelGatewaySdkSessionHandoff`.
- [ ] H.2 Converter route env em configuracao BYOK de proximo boot.
- [x] H.3 Gravar handoff sem segredo bruto.
- [x] H.4 Integrar com `/session sdk next new`.
- [x] H.5 Permitir auto request de novo boot quando policy autoriza.
- [ ] H.6 Validar boot com binding esperado.
- [ ] H.7 Detectar mismatch de provider/modelo.
- [ ] H.8 Persistir confirmacao.
- [ ] H.9 Mostrar status "prepared/booted/confirmed".
- [ ] H.10 Testar ciclo new/resume/auto.

### Faixa I - Confirmacao Por Eventos SDK

- [ ] I.1 Mapear `session.model_changed`.
- [ ] I.2 Mapear usage/session events relevantes.
- [ ] I.3 Correlacionar modelo aplicado por `setModel`.
- [ ] I.4 Correlacionar modelo do novo boot.
- [ ] I.5 Persistir confirmacao no SQLite.
- [ ] I.6 Mostrar divergencia no terminal.
- [ ] I.7 Auditar se BYOK consome ou nao snapshots de quota SDK.
- [ ] I.8 Garantir que quota Copilot SDK nao seja confundida com quota BYOK.
- [ ] I.9 Testar evento simulado.
- [ ] I.10 Testar live real quando disponivel.

### Faixa J - Cockpit Do Operador

- [x] J.1 `/byok auto status`.
- [x] J.2 `/byok auto record`.
- [x] J.3 `/byok auto apply`.
- [x] J.4 `/byok auto history`.
- [x] J.5 `model-gateway:ops`.
- [x] J.6 `/byok auto policy`.
- [ ] J.7 `/byok auto explain`.
- [ ] J.8 `/byok auto switch`.
- [x] J.9 `model-gateway:auto:ready`.
- [x] J.10 `model-gateway:auto:doctor`.
- [ ] J.11 Mostrar prepared/live/confirmed em uma linha.
- [x] J.12 Mostrar o que ainda impede automacao total.

### Faixa K - Account/Key/Quota

- [x] K.1 Separar SDK quota de BYOK quota.
- [x] K.2 Provider quota capabilities.
- [x] K.3 Runtime health overlays.
- [x] K.4 Reset windows.
- [ ] K.5 Key access probes controladas.
- [ ] K.6 Account endpoint importers adicionais.
- [ ] K.7 Overlay para "key sem acesso a modelo".
- [ ] K.8 Overlay para "quota temporariamente esgotada".
- [ ] K.9 Overlay para "credito duro esgotado".
- [ ] K.10 Cockpit de freshness e proxima coleta.

### Faixa L - Live Tests

- [x] L.1 Runner vive em `scripts/model-gateway`.
- [x] L.2 Fixture BYOK existe no runner.
- [x] L.3 Runner suporta BYOK real.
- [x] L.4 Runner suporta runtime selector options.
- [ ] L.5 Scenario fixture para pre-turn auto.
- [ ] L.6 Scenario fixture para post-turn fallback.
- [ ] L.7 Scenario real com fallback profiles.
- [ ] L.8 Scenario real sem PR premium.
- [ ] L.9 Scenario rate-limit/credits quando reproduzivel.
- [ ] L.10 Relatorio JSON/MD de chancela.

### Faixa M - Primeiro Uso Funcional

- [x] M.1 Rodar `model-gateway:auto:ready`.
- [x] M.2 Rodar `model-gateway:auto:doctor`.
- [ ] M.3 Ligar `/byok auto on` em modo seguro.
- [ ] M.4 Verificar pre-turn sem mutacao perigosa.
- [ ] M.5 Autorizar live set model.
- [ ] M.6 Testar fallback manual via `/byok auto apply`.
- [ ] M.7 Autorizar new session.
- [ ] M.8 Testar handoff.
- [ ] M.9 Confirmar binding.
- [ ] M.10 Emitir chancela de uso funcional.

### Faixa N - Integracao Total De Runtime

- [ ] N.1 Auto mode escolhe rota antes do turno.
- [ ] N.2 Auto mode troca modelo live quando seguro.
- [ ] N.3 Auto mode prepara novo boot quando necessario.
- [ ] N.4 Auto mode replaneja depois de falha.
- [ ] N.5 Auto mode evita rota em cooldown.
- [ ] N.6 Auto mode respeita politica do operador.
- [ ] N.7 Auto mode mostra explicacao curta.
- [ ] N.8 Auto mode persiste trilha completa.
- [ ] N.9 Auto mode passa live fixture.
- [ ] N.10 Auto mode passa live real.

---

## 7. Sequencia Recomendada De Implementacao

1. [x] Criar stores/contratos para effect applications e SDK handoffs.
2. [x] Implementar `/byok auto policy`.
3. [x] Implementar `/byok auto off` persistente.
4. [x] Implementar `model-gateway:auto:ready`.
5. [x] Implementar `model-gateway:auto:doctor`.
6. [x] Integrar `prepare_new_sdk_session` ao terminal.
7. [ ] Implementar controller post-turn.
8. [ ] Correlacionar eventos SDK.
9. [ ] Expandir live runner com cenarios auto.
10. [ ] Rodar live tests e corrigir.

---

## 8. Definicao De Pronto

O sistema estara pronto para chancela funcional quando:

- [x] `model-gateway:auto:ready` passa.
- [x] `model-gateway:auto:doctor` passa.
- [ ] `/byok auto status` explica policy e rota.
- [ ] `/byok auto on` liga policy persistente.
- [ ] Pre-turn roda em modo auto sem provider call.
- [ ] Live model switch funciona dentro da mesma boundary.
- [ ] New session handoff funciona para provider/perfil diferente.
- [ ] Post-turn fallback funciona apos falha BYOK.
- [ ] Runtime health exclui/rebaixa rota falha sem tocar catalogo.
- [ ] Eventos SDK confirmam modelo/binding.
- [ ] Live fixture passa.
- [ ] Live real passa ou falha por blocker externo explicado.
