# 44 — Mapeamento do Lifecycle Adjacente: `keepalive`, `cleanup`, `boot-steps` e `boot-wiring`

**Status**: checkpoint complementar validado **Última atualização**: 2026-04-28 **Escopo desta
subonda**:

- delimitar responsabilidades entre `sdk/`, `agent/session/keepalive.js`, `cleanup.js`,
  `boot-steps.js` e `boot-wiring.js`;
- remover mais uma zona de nebulosidade no lifecycle adjacente do runtime vivo;
- reforçar que scheduling/runtime policy e operação vanilla do SDK são owners distintos.

---

## 1. Problema arquitetural investigado

Após a delimitação inicial do lifecycle `agent` vs `sdk`, ainda restava uma zona cinzenta importante
na família adjacente ao boot e à manutenção da sessão viva:

- `agent/session/keepalive.js`
- `agent/session/cleanup.js`
- `agent/session/boot-steps.js`
- `agent/session/boot-wiring.js`

A pergunta central era:

> esses módulos estão apenas orquestrando o runtime vivo, ou continuam operando o SDK em nível cru e
> duplicando semântica vanilla?

---

## 2. Leitura arquitetural consolidada

### 2.1 `keepalive.js`

Missão legítima:

- decidir **quando** a sessão precisa ser mantida viva;
- aplicar a policy de idle;
- suprimir keepalive quando o dialog loop já mantém a sessão viva;
- serializar o scheduler para evitar reentrância.

Missão ilegítima:

- tocar `client.ping()` ou `session.send()` diretamente como se fosse owner do boundary SDK.

### 2.2 `cleanup.js`

Missão legítima:

- listar sessões vanilla conhecidas;
- decidir quais estão stale pela policy local do runtime;
- pedir remoção ao boundary SDK por façades canônicas.

Missão ilegítima:

- recriar semântica de lifecycle vanilla;
- falar com o SDK por chamadas cruas fora da façade do agent.

### 2.3 `boot-steps.js`

Missão legítima:

- agrupar steps operacionais nomeadas;
- coordenar attach de observabilidade;
- disparar cleanup, recovery, timers, MCP reconnect, keepalive, quota monitor e relays.

Missão ilegítima:

- virar owner de semântica vanilla do SDK;
- espalhar método cru do SDK entre steps heterogêneas.

### 2.4 `boot-wiring.js`

Missão legítima:

- ser o runner/pipeline do boot;
- compor etapas, executar sob policy e produzir `bootReport`.

Missão ilegítima:

- acumular lógica operacional detalhada que já pertence a `boot-steps.js`;
- reabrir transições vanilla por conta própria.

---

## 3. Transformação aplicada nesta subonda

### 3.1 `keepalive.js` deixou de tocar handles crus do SDK

Antes, o keepalive recebia callbacks com acesso a objetos vivos do SDK:

- `getClient()`
- `getSession()`

e fazia ele mesmo a escolha entre:

- `client.ping()`
- `session.send({ prompt: '[keepalive]' })`

Isso mantinha uma duplicação sutil:

- o scheduler do runtime também carregava semântica de boundary SDK.

### 3.2 Ação semântica única de keepalive no runtime

Foi introduzida a façade:

- `performKeepaliveSdkTick(ctx)`

em:

- `src/copilot/agent/facades/agent-session-ops.js`

Essa façade agora é a owner de **como** tocar o SDK para manter a sessão viva:

1. tenta `pingAgentSdkClient(client)`;
2. faz fallback para `sendAgentSdkSession(session, { prompt: '[keepalive]' })`;
3. retorna a estratégia usada:
   - `'client.ping'`
   - `'session.send'`
   - `null` quando não houve ação.

### 3.3 `SessionKeepalive` virou scheduler puro

`src/copilot/agent/session/keepalive.js`

Agora o módulo não recebe mais handles crus; ele recebe uma única ação semântica:

- `performKeepalive()`

Portanto, `SessionKeepalive` passa a ser owner apenas de:

- tempo;
- idle policy;
- supressão por dialog loop;
- serialização do tick;
- observabilidade local da estratégia usada.

### 3.4 `AgentContext.startKeepalive()` passou a ligar o scheduler à façade correta

`src/copilot/agent/agent-context.js`

Agora o contexto passa ao keepalive:

- `performKeepalive: () => performKeepaliveSdkTick(this)`

Ou seja:

- `AgentContext` continua sendo o ponto de composição do runtime vivo;
- mas o scheduler não conhece mais `client`/`session` como objetos operáveis.

### 3.5 Estratégia de keepalive ficou observável

Os callbacks `onKeepalive` em:

- `agent/dialog/agent-dialog-controller.js`
- `agent/session/boot-steps.js`

passaram a receber:

- `ts`
- `strategy`

permitindo emitir:

- `EMITTER_SESSION_KEEPALIVE` com contexto da estratégia usada.

Isso melhora a observabilidade sem reabrir o boundary SDK.

---

## 4. Regra geral consolidada

O lifecycle adjacente passa a obedecer esta regra:

> módulos de manutenção do runtime vivo (`keepalive`, `cleanup`, `boot-steps`, `boot-wiring`) podem
> decidir _quando_ agir, mas não devem decidir _como_ invocar o SDK vanilla por chamadas cruas.

Tradução prática:

- **scheduler / orchestration** → `agent/session/*`
- **transição vanilla / operação SDK** → `sdk/*` ou façade canônica do `agent`

---

## 5. Enforcement adicionado

O gate de seams oficiais foi ampliado com a regra:

- `agent-keepalive-must-not-touch-raw-sdk-handles`

Isso impede regressões em que `keepalive.js` volte a usar diretamente:

- `client.ping()`
- `client.start()` / `client.stop()`
- `session.send()`

---

## 6. Validação executada

### 6.1 Validação estática escopada

- `prettier --check` focado nos arquivos tocados ✅
- `eslint` focado nos arquivos tocados ✅
- `npm run typecheck:strict:src.copilot` ✅

### 6.2 Lote focado de testes

- `tests/unit/copilot/test_keepalive.spec.js` ✅
- `tests/unit/copilot/contracts/test_lifecycle_boundary_block_b.spec.js` ✅
- `tests/unit/copilot/test_boot_wiring_pipeline.spec.js` ✅
- `tests/unit/copilot/test_boot_wiring_runner.spec.js` ✅

---

## 7. Impacto arquitetural

Esta subonda reduz uma duplicação importante:

- antes, `keepalive` era ao mesmo tempo scheduler e mini-owner de operações SDK;
- agora, ele volta a ser apenas scheduler do runtime vivo.

Com isso, a família do lifecycle adjacente fica mais clara:

- `cleanup.js` = manutenção de sessões stale sob policy do runtime;
- `keepalive.js` = manutenção temporal de vivacidade da sessão viva;
- `boot-steps.js` = catálogo de steps operacionais;
- `boot-wiring.js` = composição, execução ordenada e relatório do boot.

Isso encaixa diretamente nas prioridades dos Programas **P1** e **P2** do roadmap:

- reforça a soberania do boundary SDK;
- reduz nebulosidade no runtime `agent/`;
- transforma a regra arquitetural em seam monitorado.
