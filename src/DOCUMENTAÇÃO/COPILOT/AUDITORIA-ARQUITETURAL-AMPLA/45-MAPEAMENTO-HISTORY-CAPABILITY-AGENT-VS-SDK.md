# 45 — Mapeamento da Capability de Histórico (`getMessages`) entre `agent` e `sdk`

**Status**: checkpoint complementar do Bloco B / transição para Bloco C **Última atualização**:
2026-04-28 **Escopo desta etapa**: delimitar a responsabilidade da capability de leitura de
histórico da sessão SDK (`getMessages`) e remover sondagens cruas dessa surface em módulos de
`agent/session/*`.

---

## 1. Problema observado

Mesmo após a consolidação principal do lifecycle `agent ↔ sdk`, ainda havia uma pequena, mas
significativa, nebulosidade neste ponto:

- `agent/session/history-sync.js` sondava `sdkSession.getMessages` diretamente;
- `agent/session/initializer.js` também verificava `session.getMessages` cru para o health-check de
  sessão retomada;
- a façade do runtime já possuía `readAgentSdkSessionMessages(session)`, mas **não** possuía um
  contrato canônico para expor se a capability estava ou não disponível.

Isso criava três problemas:

1. o `agent` ainda precisava conhecer um detalhe method-level do SDK;
2. a mesma decisão de capability era repetida em mais de um módulo;
3. a regra arquitetural ficava incompleta: havia wrapper para **usar** o histórico, mas não para
   **descobrir** se o histórico estava disponível.

---

## 2. Regra arquitetural consolidada

A regra geral agora fica explícita:

> módulos de `agent/session/*` podem decidir **quando** ler o histórico da sessão viva, mas não
> devem decidir **como detectar** a disponibilidade method-level dessa capability vanilla do SDK.

### `sdk/` / façades runtime do SDK

Devem decidir:

- como ler o histórico vanilla;
- como detectar a presença de `getMessages`;
- como encapsular essa capability para o runtime do `agent`.

### `agent/session/*`

Deve decidir:

- quando executar health-check de sessão retomada;
- quando sincronizar histórico com `conversation-hub`;
- como tratar ausência da capability no contexto do runtime local.

---

## 3. Transformação aplicada

### 3.1 Nova capability façade no runtime

Em `src/copilot/agent/facades/agent-sdk-runtime.js` foi introduzida:

- `canReadAgentSdkSessionMessages(session)`

Ela passa a ser a forma canônica de responder:

- "esta sessão viva suporta leitura de histórico?"

### 3.2 Re-exportação pelo boundary principal do agent

Em `src/copilot/agent/facades/agent-sdk-access.js` a capability passou a ser promovida ao boundary
mais amplo do runtime:

- `canReadAgentSdkSessionMessages(session)`
- `readAgentSdkSessionMessages(session)`

Isso preserva compatibilidade com callers que já dependem do barrel/facade principal.

### 3.3 `initializer.js` saneado

`agent/session/initializer.js` deixou de checar `session.getMessages` cru e passou a usar:

- `canReadAgentSdkSessionMessages(session)`

Resultado:

- o health-check de sessão retomada continua existindo;
- a decisão de capability deixa de ser method-level do SDK dentro do módulo de inicialização.

### 3.4 `history-sync.js` saneado

`agent/session/history-sync.js` deixou de fazer sondagem crua de `sdkSession.getMessages` e passou a
usar:

- `canReadAgentSdkSessionMessages(session)`

Resultado:

- a sincronização de histórico continua sendo owner do runtime;
- mas a descoberta da capability passa pela façade canônica.

---

## 4. Guardrails adicionados

O script estrutural `scripts/check-copilot-official-seams.mjs` passou a incluir a regra:

- `agent-session-must-not-check-sdk-getmessages-directly`

Essa regra impede regressões em que módulos de `agent/session/*` voltem a usar:

- `session.getMessages`
- `sdkSession.getMessages`

como checagem direta de capability.

---

## 5. Testes que congelam a nova fronteira

### Testes estruturais

- `tests/unit/copilot/contracts/test_lifecycle_boundary_block_b.spec.js`
  - agora também verifica ausência de sondagem crua de `getMessages` em `agent/session/*`

### Testes funcionais

- `tests/unit/copilot/test_agent_sdk_access.spec.js`
  - valida `canReadAgentSdkSessionMessages()`
- `tests/unit/copilot/agent/test_agent_session_event_handlers.spec.js`
  - valida que `syncSdkHistory()` trata ausência de `getMessages` como capability indisponível, e
    não como falha estrutural.

---

## 6. Relação com o plano geral

Esta subonda encaixa-se principalmente em:

- **P1 / W10** — fechamento e endurecimento de wrappers/capabilities vanilla do SDK;
- **P2 / W17–W18** — redução de detalhes crus do runtime e catalogação de pontos onde `agent/*`
  ainda conhece demais o `AgentContext` ou a topologia method-level do SDK;
- **P2 / W23** — limpeza do lifecycle adjacente e das operações de sessão viva.

Ela é pequena em superfície, mas importante em qualidade de fronteira:

> a arquitetura fica mais coerente quando a capability `getMessages` deixa de ser um detalhe que
> qualquer módulo de sessão descobre sozinho.

---

## 7. Conclusão

Com esta etapa, a capability de histórico da sessão fica melhor delimitada:

- o `sdk` e suas façades do runtime do `agent` definem a descoberta e a leitura da capability;
- `initializer` e `history-sync` continuam sendo owners do **uso semântico** dessa capacidade;
- o CI agora bloqueia o retorno da sondagem crua em `agent/session/*`.

Essa convergência reduz um pequeno, mas persistente, ponto de nebulosidade entre:

- lifecycle vanilla do SDK,
- lifecycle da sessão viva,
- e sincronização/health-check do runtime do `agent`.
