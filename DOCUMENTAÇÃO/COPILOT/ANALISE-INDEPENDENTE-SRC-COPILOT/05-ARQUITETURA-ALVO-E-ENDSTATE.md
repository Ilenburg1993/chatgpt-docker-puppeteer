# Arquitetura-Alvo e Endstate Ideal — `src/copilot`

## 1. Princípio-mestre

O sistema ideal deve obedecer a uma regra simples:

> **para cada responsabilidade importante, deve existir um owner inequívoco e uma SSOT inequívoca**.

Tudo o que violar isso aumenta acoplamento, drift e retrabalho.

## 2. Endstate alvo por domínio

### 2.1 Runtime

**Owner ideal**: `agent/`

`agent/` deve ser o dono exclusivo de:

- estado operacional vivo da LLM-B;
- lifecycle do runtime;
- dialog loop e controle de turno;
- handoff e fila de mensagens;
- health do runtime.

`agent/` **não** deve ser owner de:

- projections HTTP;
- UX do terminal;
- persistência conversacional do hub;
- contrato bruto do vendor SDK.

### 2.2 Vendor / modelos / sessão SDK

**Owner ideal**: `sdk/` + `infra/sdk-session-registry.js`

`sdk/` deve ser dono de:

- `CopilotClient` e suas sessões;
- modelos e capabilities do vendor;
- auth/ping/status do vendor;
- tool/core contracts do vendor wrapper.

`sdk/` não deve ser dono de:

- conversa persistida;
- health do runtime;
- projeções de terminal/server;
- regras de ownership conversacional.

### 2.3 Sessão conversacional e replay

**Owner ideal**: `conversation-hub/`

`conversation-hub/` deve ser dono de:

- sessões conversacionais persistidas;
- turns;
- memórias;
- replay/resume;
- broadcast por sessão.

### 2.4 Binding cross-layer

**Owner ideal**: `core/shared-state.js` + helpers explícitos de ownership

Esse domínio deve conter apenas:

- `hubSessionId` ativo;
- `sdkSessionId` ativo;
- binding explícito entre ambos;
- estado compartilhado realmente mínimo.

Ele **não** deve virar store genérico.

### 2.5 Transporte contínuo

**Owner ideal**: `channel/`

`channel/` deve ser dono de:

- injeção contínua LLM-A ↔ LLM-B;
- SSE client;
- histórico do bridge;
- protocolo de transporte.

### 2.6 Frontend principal da LLM-B

**Owner ideal**: `terminal/`

`terminal/` deve ser o frontend operacional principal para:

- o usuário humano;
- a LLM-A via inject server/fluxo contínuo.

Mas o terminal deve permanecer **consumidor** de SSOTs, não dono delas.

### 2.7 Bordas compartilhadas

**Owner ideal**: `presentation/`

`presentation/` deve conter apenas:

- projections compartilhadas;
- helpers de adaptação entre bordas;
- contratos para `server` e `terminal` lerem a mesma verdade.

`presentation/` não deve fazer:

- orchestration;
- lifecycle;
- persistência;
- coordenação de sessão.

### 2.8 Borda HTTP/SSE/Socket

**Owner ideal**: `server/`

`server/` deve cuidar apenas de:

- transporte HTTP;
- auth/rate limiting/headers;
- SSE;
- Socket.IO;
- montagem de rotas.

### 2.9 Eventos e políticas

**Owners ideais**:

- `events/` = taxonomia e middleware de evento
- `event-handlers/` = reação semântica
- `hooks/` = política e interceptação
- `observability/` = coleta, métrica, health projection, tracking

Esses quatro domínios precisam coexistir, mas sem sobreposição de trabalho.

## 3. Camadas arquiteturais propostas

### Camada 0 — contratos e utilidades puras

- `core/`
- `types/`
- `db/`
- partes de `infra/`

### Camada 1 — vendor e configuração

- `sdk/`
- `config/`

### Camada 2 — runtime e domínio conversacional

- `agent/`
- `conversation-hub/`
- `channel/`

### Camada 3 — políticas, eventos e observação

- `events/`
- `event-handlers/`
- `hooks/`
- `observability/`
- `audit/`

### Camada 4 — bordas compartilhadas

- `presentation/`

### Camada 5 — frontends e transportes externos

- `terminal/`
- `server/`
- `bridges/`

### Camada 6 — superfícies de capacidade

- `tools/`
- `plugins/`

## 4. Regras de fronteira propostas

### Permitido

- `terminal -> presentation`, `agent`, `channel`, `conversation-hub`, `sdk`, `config`
- `server -> presentation`, `agent`, `conversation-hub`, `config`, `sdk`
- `presentation -> agent`, `conversation-hub`, `core`, `bridges`, `sdk`, `observability` (somente leitura/projeção)
- `agent -> sdk`, `core`, `events`, `event-handlers`, `hooks`, `config`, `infra`

### Proibido ou excepcional

- `server -> terminal`
- `sdk -> agent`
- `presentation -> terminal`
- `observability -> orchestration de domínio`
- `event-handlers -> ownership de sessão`
- `terminal -> ser owner do runtime`

## 5. Critérios de sucesso objetivos

O endstate ideal só estará atingido quando todos os itens abaixo forem verdadeiros.

### 5.1 Ownership

- cada um dos domínios críticos (`runtime`, `sdk session`, `conversation session`, `transport`, `frontend`, `presentation`) possuir um owner explícito e estável;
- nenhuma projection compartilhada existir em mais de um lugar.

### 5.2 Dependências

- `server -> terminal` continuar em **0**;
- imports diretos de `@github/copilot-sdk` fora do boundary pretendido caírem drasticamente;
- `observability/` reduzir sua centralidade transversal.

### 5.3 Compatibilidade residual

- os shims de `agent/session/event-handlers/*` deixarem de ser necessários;
- wrappers `deprecated` cairam a um nível baixo e com data de remoção clara.

### 5.4 Estado compartilhado

- `shared-state` continuar mínimo;
- caches/Maps relevantes possuírem política explícita de cleanup/TTL/owner.

### 5.5 Terminal-first correto

- o terminal seguir como frontend principal da LLM-B;
- sem virar runtime owner;
- sem DI espalhada;
- com seams locais claras (`frontend/*`).

## 6. Endstate resumido

O sistema ideal é aquele em que:

- `agent` roda;
- `sdk` fala com o vendor;
- `conversation-hub` lembra;
- `channel` transporta;
- `terminal` apresenta e opera;
- `server` publica bordas de rede;
- `presentation` projeta a mesma verdade para múltiplas bordas;
- `observability` mede, mas não decide domínio;
- `events` nomeiam;
- `event-handlers` reagem;
- `hooks` policiam;
- `tools` executam capacidades.

Se dois lugares fizerem o mesmo papel ao mesmo tempo, a arquitetura ainda não chegou no endstate.
