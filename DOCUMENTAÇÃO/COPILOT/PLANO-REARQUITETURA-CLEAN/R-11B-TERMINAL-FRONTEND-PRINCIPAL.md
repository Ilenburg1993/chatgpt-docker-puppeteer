# R-11B — Terminal como Frontend Principal da LLM-B

**Programa**: P4
**Status**: canônico para a frente terminal-first
**Relacionamento**: complemento operacional de `R-11` e `R-11A`

---

## 1. Propósito

Este documento explicita um ponto que já estava implícito em vários artefatos da linha clean, mas
que agora precisa ficar cristalino:

> o `terminal/` é o frontend principal da LLM-B.

Isso vale para dois públicos simultaneamente:

- o **usuário humano**, via REPL local e UX interativa;
- a **LLM-A**, via inject server, streaming, sessões e controle operacional contínuo.

O objetivo desta nota é transformar essa ideia em contrato arquitetural explícito, com critérios de
sucesso e fila de transformação coerente com a Faixa F.

---

## 2. Diagnóstico curto

O `terminal/` já opera, na prática, como frontend principal da LLM-B porque concentra:

- boot da experiência interativa;
- REPL e gramática de comandos;
- inject server usado pela LLM-A;
- integração com dialog loop contínuo;
- visão operacional de health, diagnose, métricas, sessões e memória.

O problema do estado atual não é o terminal “fazer demais”.

O problema é que ele faz isso com a arquitetura interna ainda heterogênea demais:

- parte do módulo já consome SSOTs canônicas;
- parte ainda fala com múltiplos domínios diretamente;
- parte ainda resolve dependências via container em níveis baixos demais;
- e a distinção entre **frontend local**, **projection shared** e **runtime truth** ainda não está
  suficientemente materializada no código.

---

## 3. Relação ideal do terminal com o restante de `src/copilot/`

## 3.1 Princípio central

O terminal é o **frontend principal** — mas **não** é a SSOT dos domínios que ele apresenta.

Ele deve consumir SSOTs já definidas pelo sistema:

| Domínio                                 | SSOT canônica                         | Papel do terminal                   |
| --------------------------------------- | ------------------------------------- | ----------------------------------- |
| runtime da LLM-B                        | `agent/`                              | frontend operacional                |
| health/runtime status                   | `agent/health-check.js` + projections | consumo e renderização              |
| transporte LLM-A ↔ LLM-B                | `channel/`                            | frontend contínuo e operador humano |
| sessão/memória/replay conversacional    | `conversation-hub/`                   | navegação, listagem, replay, UX     |
| modelos/capacidades do vendor           | `sdk/`                                | consumo orientado à experiência     |
| projections compartilhadas entre bordas | `presentation/`                       | consumo como adapter local          |

Em resumo:

- `agent/` continua sendo a verdade do runtime da LLM-B;
- `channel/` continua sendo a verdade do transporte contínuo;
- `conversation-hub/` continua sendo a verdade da sessão conversacional persistida;
- `sdk/` continua sendo a verdade da superfície de vendor/capabilities;
- o `terminal/` se torna a **verdade da UX local/operacional**, não a verdade de domínio.

---

## 3.2 O que o terminal deve possuir

O terminal deve ser dono de:

- boot da experiência local;
- REPL, aliases, anexos, file/workspace context;
- renderização, streaming e output local;
- composição de visões de runtime para consumo humano e pela LLM-A;
- comandos, flows e affordances voltadas à operação da LLM-B.

---

## 3.3 O que o terminal não deve voltar a possuir

O terminal **não** deve voltar a ser:

- pseudo-backend reaproveitado pelo `server/`;
- local de projeções compartilhadas entre bordas;
- dono acidental de sessão SDK, health ou replay;
- ponto arbitrário de DI para qualquer domínio do sistema.

---

## 4. Boundary interno-alvo do próprio terminal

## 4.1 Novo boundary interno recomendado

O terminal deve convergir para esta topologia interna:

```text
terminal/
  index.js / bootstrap.js / di-wiring.js / terminal-agent-wiring.js
    -> boot e costura

  frontend/
    -> camada interna canônica de composição da UX da LLM-B
    -> lê agent/channel/hub/sdk/observability/core de forma controlada

  commands/
    -> comandos finos de REPL, dependentes de frontend/

  handlers/
    -> adapters HTTP finos, dependentes de presentation/

  dialog/
    -> motor local de streaming/turn execution/persistência de UX

  state.js / alias-store.js / file-context.js / workspace-context.js
    -> estado e ergonomia local legítimos
```

## 4.2 Regra operacional

Quando um comando, handler ou flow do terminal precisar falar com muitos domínios ao mesmo tempo,
o destino preferencial **não** é mais o container espalhado; o destino preferencial passa a ser:

- `terminal/frontend/*` para composição específica da UX local;
- `presentation/*` para superfícies compartilhadas entre bordas;
- SSOT do domínio quando a operação for realmente daquele domínio.

---

## 5. Critérios de sucesso específicos desta frente

O terminal só pode ser considerado convergente com o end-state clean quando:

1. o `server/` continuar em **0 imports estruturais diretos** de `terminal/`;
2. projections compartilhadas seguirem concentradas em `presentation/`;
3. `commands/` e `dialog/` pararem de abrir integrações transversais em cada arquivo;
4. existir uma camada `terminal/frontend/*` claramente reconhecível como consumer layer principal da LLM-B;
5. a UX do terminal continuar plenamente compatível com `agent/`, `channel/`, `conversation-hub/` e `sdk/`;
6. o terminal continuar operando tanto para o usuário humano quanto para a LLM-A sem duplicar runtime truth.

---

## 6. Fila recomendada de transformação

## Fase T1 — consolidar o terminal como frontend principal

- T1.1 criar `terminal/frontend/*` como camada canônica de composição local;
- T1.2 migrar `/status`, `/diagnose`, `/metrics`, `/usage` e flows de sessão para essa camada;
- T1.3 expor no frontend a visão canônica do binding `runtime ↔ sdk ↔ hub`;
- T1.4 tornar o terminal a melhor borda de observação do estado da LLM-B.

### Estado atual resumido de T1

O primeiro corte dessa fase já foi materializado:

- foi criada a camada `src/copilot/terminal/frontend/llm-b-frontend.js`;
- essa camada já centraliza status, diagnose, métricas, usage, operações centrais de sessão, memória, retomada e busca do terminal;
- `commands/session.js`, `commands/diagnose.js`, `commands/metrics.js`, `commands/usage.js`, `commands/memory.js`, `commands/resume.js` e `commands/search.js` passaram a consumir essa camada;
- `commands/config.js`, `commands/context.js` e `commands/errors.js` também passaram a consumir essa camada;
- foi criado `src/copilot/terminal/frontend/llm-b-runtime.js` como gateway runtime da UX principal da LLM-B;
- `repl.js`, `repl-listeners.js`, `dialog/output.js`, `dialog/engine.js`, `dialog/engine-persistence.js`, `terminal-agent-wiring.js` e `index.js` passaram a consumir esse gateway;
- o binding canônico `runtimeSessionId ↔ sdkSessionId ↔ hubSessionId` agora aparece de forma mais explícita na UX local do terminal;
- a DI direta do recorte `terminal/commands/` caiu de **22** para **0** ocorrências;
- o recorte total de `container.resolve()` em `src/copilot/terminal/` caiu para **2** ocorrências, com apenas **1** remanescente no runtime efetivo do módulo.

Próxima fila recomendada de T1/T2:

1. seguir refinando `dialog/`, `repl.js` e `repl-listeners.js` agora em torno do gateway runtime já extraído;
2. expandir os contract tests do frontend principal da LLM-B e do boundary runtime local;
3. manter README e artefatos do P4 alinhados ao boundary terminal-first.

### Estado atual resumido adicional de T1/T2

- `terminal/frontend/*` agora tem **3 arquivos / 1.045 linhas** e funciona como camada interna canônica do frontend principal + gateway runtime;
- validação focada mais recente do slice terminal-first:
  - **44/44** testes verdes em `vitest` no slice de comandos/frontend;
  - **14/14** testes verdes em `node:test` nos contratos de `dialog`/`repl`/`wiring`/`index`;
  - **26/26** testes verdes em `vitest` na rodada do gateway runtime.

## Fase T2 — reduzir DI difusa

- T2.1 migrar `commands/` mais acoplados para `frontend/`;
- T2.2 migrar `dialog/` para seams mais estáveis de runtime e persistence;
- T2.3 concentrar container/boot em wiring explícito.

## Fase T3 — endurecer contratos do frontend principal

- T3.1 criar contract tests do P4 sobre a UX principal da LLM-B;
- T3.2 estabilizar o README/local docs do terminal;
- T3.3 fechar backlog estrutural antes de capabilities avançadas.

---

## 7. Conclusão

O terminal não deve ser tratado como detalhe de UX.

Ele é a **porta principal** de operação da LLM-B, tanto para o humano quanto para a LLM-A. O que a
rearquitertura clean busca não é reduzir essa centralidade, e sim discipliná-la:

- SSOTs continuam nos domínios certos;
- projections compartilhadas continuam em `presentation/`;
- o terminal passa a ser um frontend principal mais explícito, mais fino por dentro e mais forte por fora.

## 8. Atualização do baseline terminal-first

O terminal agora também converge para uma regra interna mais forte:

- `terminal/frontend/llm-b-runtime.js` é a seam canônica de acesso a `agent/`, `channel/`,
  `conversation-hub/` e binding compartilhado de sessão;
- `terminal/frontend/llm-b-frontend.js` passa a ser uma camada de projeção/UX, sem reabrir acesso
  direto a essas SSOTs de runtime;
- comandos como `/export` passam a reutilizar a mesma seam runtime, em vez de falar direto com o
  transporte.

Critério de sucesso adicional desta frente:

1. `llm-b-frontend.js` não deve importar diretamente `#copilot/agent`, `#copilot/channel`,
   `#copilot/conversation-hub` ou `#copilot/core`;
2. o acesso a runtime/hub/transporte deve convergir em `llm-b-runtime.js`;
3. comandos REPL devem consumir `frontend/*`, não SSOTs de domínio diretamente.
