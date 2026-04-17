# Fluxos, Ciclos e Modelo Operacional Atual — `src/copilot`

## 1. Bootstrap canônico hoje

O bootstrap factual do sistema parte de `src/copilot/bootstrap.js`.

### Sequência observada

1. bootstrap de observabilidade;
2. bootstrap de dependências tardias;
3. validação de tokens críticos no container;
4. inicialização do terminal como modo canônico.

### Implicação arquitetural

O sistema hoje é **terminal-first**. Isso não é detalhe: significa que a LLM-B é tratada como ferramenta contínua de desenvolvimento, não como serviço de produção independente.

## 2. Fluxo de runtime principal

### Núcleo factual

- `agent/always-alive.js` expõe a fachada pública do runtime;
- `agent/lifecycle/*` cuida do start/stop/reconnect/session-setup;
- `agent/dialog/*` controla loop de diálogo, turnos, watchdog e backpressure;
- `agent/session/*` cuida de boot, keepalive, snapshot, cleanup e ownership;
- `agent/messaging/*` opera fila e envio.

### Leitura

O runtime está mais modular do que em versões anteriores, mas ainda é **o coração de coordenação do sistema**.

## 3. Fluxo de borda HTTP/SSE/Socket

### `server/index.js`

- cria o app Express;
- monta `router.js`;
- registra error handler;
- sobe HTTP server;
- opcionalmente acopla Socket.IO ao `conversation-hub`.

### `server/router.js`

Hoje ele centraliza a costura das rotas de:

- health;
- health-registry;
- observability;
- config;
- sessions;
- memory;
- SSE;
- copilot-api;
- SDK API;
- webhooks;
- agent control.

### Leitura

`server/` está cada vez mais próximo do papel correto: **orquestrador de borda**, não runtime owner.

## 4. Fluxo terminal-first

### `terminal/index.js`

O terminal hoje executa:

1. aliases;
2. DI wiring local;
3. pinned files loader;
4. inicialização do hub conversacional;
5. criação da hub session principal;
6. subida do copilot server;
7. registro de listeners do agente;
8. reflection loop;
9. cleanup jobs;
10. início do REPL.

### Leitura

O terminal é hoje a **interface contínua operacional da LLM-B**, tanto para usuário humano quanto para LLM-A.

## 5. Fluxo de sessão conversacional

### `conversation-hub/orchestrator.js`

Esse módulo mostra algo central: o hub não é só storage. Ele é também:

- coordenador de sessões;
- serializador de `sendToLlmB` por sessão;
- ponto de injeção de mensagens do usuário;
- emissor de eventos de ciclo de sessão;
- ponto de fallback para sessão SDK ativa.

### Leitura

`conversation-hub/` já é mais que um “store”. Ele é uma camada de ownership conversacional.

## 6. Fluxo SDK/vendor

### `sdk/session/client.js`

O wrapper:

- cria e mantém `CopilotClient`;
- conecta/desconecta sessões;
- lista modelos;
- gerencia auth/status/ping;
- usa `infra/sdk-session-registry.js` como registry ativo;
- ainda concentra muita API pública do vendor.

### Leitura

O `sdk/` já deixou de ser só thin wrapper. Hoje ele é uma combinação de:

- façade de vendor;
- runtime helper;
- catálogo de modelos;
- RPC surface;
- health surface.

## 7. Fluxo de ferramentas

### `tools/index.js`

`tools/` hoje agrega:

- code tools;
- git tools;
- session tools;
- hook tools;
- hub tools;
- file tools;
- shell tools;
- web tools;
- todo tools;
- introspection tools;
- permission tools;
- experimental RPC tools.

### Leitura

`tools/` funciona como marketplace/runtime surface de capacidades do agente. Isso é útil, mas também explica por que o módulo é enorme.

## 8. Fluxo de hooks

### `hooks/session-lifecycle.js`

Os hooks de sessão hoje:

- registram começo/fim de sessão;
- enriquecem contexto de sessão;
- reagem a erros com fallback de modelo;
- emitem webhooks e eventos.

### Leitura

`hooks/` está mais próximo de camada de política e transformação do que de runtime — que é exatamente onde ele deveria convergir.

## 9. Fluxo de observabilidade

### `observability/bootstrap.js`

Esse arquivo é especialmente revelador porque ele mostra um crossing intencional:

- `observability` injeta logger/tracker/event bus no `core` e em camadas inferiores;
- registra singletons como tokens DI;
- conecta bus, middleware, observers e shutdown handlers.

### Leitura

Esse bootstrap é arquiteturalmente necessário hoje, mas também evidencia que `observability/` não é apenas um sink passivo; ele participa ativamente da estrutura do runtime.

## 10. Ciclos e semi-ciclos arquiteturais

### Ciclo semântico 1 — runtime/eventos/observability

```
agent -> event-handlers -> observability -> events -> agent
```

Mesmo que nem todo passo seja import cíclico formal, o ciclo funcional existe.

### Ciclo semântico 2 — terminal/hub/agent/channel

```
terminal -> channel
terminal -> agent
terminal -> conversation-hub
conversation-hub -> channel
conversation-hub -> fallback agent session
```

Isso é aceitável, desde que o terminal continue sendo frontend e não passe a arbitrar ownership.

### Ciclo semântico 3 — server/presentation/runtime state

```
server -> presentation -> agent/hub/core/shared-state/sdk
```

Esse ciclo é o desejado entre bordas compartilhadas, contanto que `presentation/` permaneça projeção e não absorva orchestration.

## 11. Conclusão dos fluxos

O sistema atual já tem uma direção arquitetural clara:

- **terminal-first** como experiência principal;
- **agent** como runtime;
- **channel** como transporte contínuo;
- **conversation-hub** como ownership conversacional;
- **sdk** como boundary do vendor;
- **presentation** como camada de projeção entre bordas.

O problema não é a ausência de direção. O problema é que ainda existem trilhas onde duas ou três camadas fazem partes parecidas do mesmo trabalho.
