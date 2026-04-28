# 42 — Mapeamento Detalhado: Lifecycle do `agent` vs Lifecycle do `sdk`

**Status**: checkpoint analítico + corretivo **Última atualização**: 2026-04-27 **Escopo**:

- `src/copilot/agent/lifecycle/*`
- `src/copilot/agent/session/initializer.js`
- `src/copilot/sdk/session/lifecycle.js`
- `src/copilot/sdk/session/client.js`
- `src/copilot/sdk/session/client-options.js`
- `src/copilot/sdk/session/wrapper.js`

---

## 1. Objetivo deste documento

Este documento existe para remover a nebulosidade residual entre duas camadas que convivem muito de
perto:

1. o **lifecycle vanilla do SDK**;
2. o **lifecycle do runtime vivo do agent**.

A pergunta central não é apenas “quem chama quem”. A pergunta central é:

> **quem é dono de qual transição de estado, em qual camada, com qual contrato e com qual direito de
> decisão?**

---

## 2. Arquivos lidos obrigatoriamente nesta investigação

### 2.1 Lifecycle do `agent`

- `agent/lifecycle/agent-lifecycle.js`
- `agent/lifecycle/entry.js`
- `agent/lifecycle/index.js`
- `agent/lifecycle/reconnect-policy.js`
- `agent/lifecycle/runtime-host.js`
- `agent/lifecycle/session-setup.js`
- `agent/lifecycle/state-io.js`

### 2.2 Lifecycle do `sdk`

- `sdk/session/lifecycle.js`
- `sdk/session/client.js`
- `sdk/session/client-options.js`
- `sdk/session/wrapper.js`

### 2.3 Integrações imediatamente adjacentes

- `agent/session/initializer.js`
- `agent/facades/agent-sdk-access.js`
- `agent/messaging/agent-messaging.js`
- `agent/always-alive.js`

---

## 3. Regra geral canônica

A partir desta investigação, a regra geral deve ser considerada a seguinte:

> **`sdk/` é owner do lifecycle vanilla do Copilot SDK; `agent/` é owner do lifecycle da sessão viva
> governada pelo runtime; e `agent/lifecycle/*` deve tratar `CopilotClient`/`CopilotSession` como
> handles opacos, acionando transições vanilla exclusivamente por wrappers/facades canônicas.**

### 3.1 Tradução operacional da regra

#### `sdk/` decide

- como conectar client vanilla;
- como criar/retomar/deletar sessão vanilla;
- como desconectar/abortar/alterar modelo da sessão vanilla;
- como classificar erro vanilla;
- quando retry/reconnect vanilla é elegível;
- quais métricas L1 representam essas operações.

#### `agent/` decide

- quando iniciar o runtime vivo;
- como compor tools/hooks/system message da sessão do agente;
- como persistir e retomar a identidade da sessão viva;
- quando religar dialog loop, keepalive, quota monitor, MCP wiring e observers;
- como encerrar graciosamente o runtime vivo;
- como reconstituir a sessão viva após falha.

#### `agent/lifecycle/*` não deve decidir sozinho

- heurística de erro vanilla;
- elegibilidade-base de reconnect do SDK;
- semântica de `client.start()/stop()/ping()` dispersa em múltiplos callers;
- criação/retomada vanilla por bypass de `client.createSession()` / `client.resumeSession()`.

---

## 4. Mapeamento por arquivo — `agent/lifecycle/*`

## 4.1 `agent/lifecycle/agent-lifecycle.js`

### Função atual correta

É o owner do **lifecycle do runtime vivo**:

- `agentStart()`
- `agentStop()`
- `agentTryReconnect()`
- `initSession()` como etapa de montagem do runtime do agent
- `wireAgentSessionRuntime()` como costura do runtime pós-sessão

### O que ele pode fazer legitimamente

- mudar status do agent;
- persistir shutdown/restore intent;
- drenar tasks/queue;
- refazer wiring do runtime;
- acionar reconnect do runtime vivo;
- disparar shutdown gracioso do runtime.

### O que ele não deve fazer diretamente

- implementar sua própria política vanilla de `create/resume`;
- duplicar classificação de erro do SDK;
- chamar `client.createSession()` / `client.resumeSession()` cru;
- espalhar `client.start()/stop()/ping()` como semântica local.

### Correção aplicada nesta onda

- `initSession()` agora explicita `ensureAgentSdkClientStarted(client)` via façade canônica
- `agentStop()` agora usa `stopAgentSdkClient(client)` em vez de chamar `client.stop()` cru

---

## 4.2 `agent/lifecycle/reconnect-policy.js`

### Função atual correta

É o owner do **reconnect da sessão viva**, não do reconnect vanilla.

Ele decide:

- quantas tentativas de reconstrução da sessão viva fazer;
- quando notificar dialog loop;
- quando emitir `session.fatal`;
- como reconstituir o runtime após recuperar uma sessão.

### O que ele não deve decidir sozinho

- elegibilidade-base de reconnect para erros vanilla conhecidos;
- taxonomia de `auth/quota/rate_limit/network/timeout`;
- semântica canônica de `client.stop()/ping()`.

### Correções aplicadas

- já vinha consultando `SdkRecoveryPolicy` para elegibilidade e backoff floor
- agora usa façade canônica também para:
  - `stopAgentSdkClient(client)`
  - `pingAgentSdkClient(activeClient)`

### Leitura final

`reconnect-policy.js` continua soberano para **reconectar a sessão viva**, mas perdeu o papel
indevido de reinterpretar sozinho a fronteira vanilla.

---

## 4.3 `agent/lifecycle/runtime-host.js`

### Função atual correta

É owner do **lifecycle do host de processo compatível**, não do runtime canônico nem do SDK vanilla.

Ele decide:

- sinais POSIX;
- IPC de processo;
- shutdown host-level;
- preflight de boot do host compatível.

### Zona de nebulosidade anterior

O preflight ainda chamava `client.start()/ping()/stop()` diretamente.

### Correção aplicada

O preflight agora passa pela façade:

- `ensureAgentSdkClientStarted(client)`
- `pingAgentSdkClient(client)`
- `stopAgentSdkClient(client)`

### Regra consolidada

Mesmo o host compatível não deve espalhar semântica method-level do SDK quando existe façade
canônica do agent para isso.

---

## 4.4 `agent/lifecycle/entry.js`

### Função atual correta

É **entrypoint compatível**, não root canônico de arquitetura.

### Delimitação

- pode orquestrar boot do processo compatível;
- pode iniciar retry do host compatível;
- não deve virar segundo owner do runtime vivo ou do lifecycle vanilla.

### Situação atual

Está majoritariamente correta após delegar preflight/runtime host e `agent.start()`.

---

## 4.5 `agent/lifecycle/session-setup.js`

### Função atual correta

É owner da **montagem de configuração de sessão do agent**:

- tools
- hooks
- onUserInputRequest
- system message composition
- MCP/session options

### Delimitação importante

Ele conhece o shape da sessão do agent, mas **não é owner do lifecycle vanilla**.

### Regra

- montar config: sim
- decidir `create/resume/delete/disconnect` vanilla: não

---

## 4.6 `agent/lifecycle/state-io.js`

### Função atual correta

É owner da **persistência do estado do runtime vivo**.

### Não é

- owner da sessão vanilla
- owner da store conversacional persistida
- owner do `conversation-hub`

### Papel correto no lifecycle

Fornece snapshot persistido que orienta o runtime do agent sobre:

- sessão a retomar;
- contadores;
- intenção de dialog loop;
- graceful shutdown.

---

## 5. Mapeamento por arquivo — `sdk/session/*`

## 5.1 `sdk/session/lifecycle.js`

### Função correta

É owner do **lifecycle vanilla da sessão**:

- `createSession()`
- `resumeSession()`
- `resumeOrCreate()`
- `listSessions()`
- `deleteSession()`
- `disconnectSession()`

### Deve decidir

- normalização de `SessionConfig`
- retry/recovery vanilla curto
- métricas L1 dessas operações
- classificação de erro vanilla dessas operações

### Não deve decidir

- persistência do runtime do agent
- rotation policy do runtime
- wiring do dialog loop
- keepalive
- ownership multi-surface

---

## 5.2 `sdk/session/client.js`

### Função correta

É owner do **singleton client vanilla** e do seu registry local em memória.

### Correção arquitetural recente já consolidada

`createClientSession()` e `resumeClientSession()` deixaram de manter semântica paralela e passaram a
reutilizar:

- `sdk/session/lifecycle.js`

### Leitura final

`client.js` pode oferecer ergonomia singleton, mas não deve se tornar segundo owner do lifecycle de
sessão.

---

## 5.3 `sdk/session/client-options.js`

### Função correta

É owner da **configuração vanilla do client**:

- env parsing
- telemetry config
- sessionFs client-level
- idle timeout do server-side sessions cleanup

### Não é

- owner do runtime do agent
- owner de boot do processo

---

## 5.4 `sdk/session/wrapper.js`

### Função correta

É owner de **operações sobre sessão ativa já criada**:

- send
- sendAndWait
- setModel
- disconnect/abort/dispose wrappers

### Regra

`wrapper.js` governa uso da sessão viva vanilla; `lifecycle.js` governa transições
create/resume/list/delete.

---

## 6. Zona de integração correta: `agent/session/initializer.js`

Este arquivo é o acoplamento legítimo entre:

- **persistência/rotação/health-check do agent**
- e **lifecycle vanilla do SDK**

### Função correta dele

- ler state persistido do agent;
- validar se vale tentar retomar;
- decidir rotate vs resume vs create para a sessão viva do agent;
- persistir o resultado.

### O que ele faz certo hoje

- não chama `client.createSession()` / `client.resumeSession()` cru;
- usa:
  - `resumeOrCreateAgentSdkSession()`
  - `createAgentSdkSessionByClient()`
- mantém o lifecycle vanilla atrás da façade do agent.

### Conclusão

`initializer.js` é o ponto certo para a política de retomada do **agent**;
`sdk/session/lifecycle.js` continua sendo o ponto certo para a política de lifecycle **vanilla**.

---

## 7. Duplicações e nebulosidades encontradas

## 7.1 Duplicação já corrigida

### A) Singleton session lifecycle paralelo em `sdk/session/client.js`

**Antes**: `client.js` mantinha semântica paralela de create/resume.

**Agora**: converge para `sdk/session/lifecycle.js`.

### B) Heurística local de reconnect em `agent/` e `terminal/`

**Antes**: `auth/quota/rate_limit` eram parcialmente reclassificados por heurísticas locais.

**Agora**: a elegibilidade-base vem da `SdkRecoveryPolicy`.

### C) `client.start()/stop()/ping()` dispersos em múltiplos pontos do lifecycle do agent

**Antes**: `agent-lifecycle.js`, `reconnect-policy.js` e `runtime-host.js` falavam diretamente com
métodos do client.

**Agora**: essas transições foram encapsuladas em façade canônica do agent.

---

## 7.2 Nebulosidades ainda remanescentes

1. `entry.js` ainda é host compatível e precisa continuar explicitamente marcado como não-canônico;
2. `runtime-host.js` continua próximo do SDK por natureza, mas agora já sem method-level scattering;
3. ainda é possível aprofundar a taxonomia entre:
   - preflight de host
   - startup de runtime
   - reconnect da sessão viva
   - keepalive preventivo

---

## 8. Regra geral operacional a aplicar daqui em diante

### Regra R1 — Owner de lifecycle vanilla

Se a operação existir como transição vanilla do SDK, o owner é `sdk/session/*`.

### Regra R2 — Owner de lifecycle da sessão viva

Se a operação envolve reconstruir wiring do runtime, persistência local, queue, dialog loop,
keepalive ou ownership multi-surface, o owner é `agent/`.

### Regra R3 — Handles opacos no lifecycle do agent

`agent/lifecycle/*` pode carregar `CopilotClient` e `CopilotSession`, mas deve tratá-los como
**handles opacos**.

Métodos vanilla devem entrar por:

- `agent/facades/agent-sdk-access.js`
- ou outras façades/ports do agent

### Regra R4 — Process host não vira owner vanilla

`agent/lifecycle/runtime-host.js` pode fazer preflight e shutdown de processo, mas não deve se
transformar em segundo owner do SDK.

### Regra R5 — Initializer do agent não reabre o SDK

`agent/session/initializer.js` é o owner da política de retomada da **sessão viva do agent**, mas
nunca deve chamar `client.createSession()` / `client.resumeSession()` cru.

---

## 9. Correções aplicadas nesta onda

1. `agent-sdk-access.js`
   - adicionados:
     - `ensureAgentSdkClientStarted()`
     - `pingAgentSdkClient()`
     - `stopAgentSdkClient()`

2. `agent/lifecycle/agent-lifecycle.js`
   - `initSession()` agora explicita start do client via façade
   - `agentStop()` agora para client via façade

3. `agent/lifecycle/reconnect-policy.js`
   - stop/ping do client agora passam pela façade

4. `agent/lifecycle/runtime-host.js`
   - preflight start/ping/stop agora passam pela façade

5. enforcement estrutural
   - novos rules no gate `check-copilot-official-seams.mjs`
   - novo contract test do Bloco B para a fronteira de lifecycle

---

## 10. Próximos upgrades recomendados

### curto prazo

1. projetar no audit docs uma ADR curta desta fronteira de lifecycle;
2. revisar `agent/session/cleanup.js` e `agent/session/boot-steps.js` pela mesma lente;
3. procurar mais callsites de `client.start/stop/ping` fora da façade.

### médio prazo

1. separar mais explicitamente “host lifecycle” vs “runtime lifecycle” no pacote `agent/lifecycle/`;
2. avaliar se `runtime-host.js` deveria migrar parte do preflight para uma façade própria;
3. consolidar scorecard específico de maturidade do lifecycle.

---

## 11. Conclusão

A regra que faltava explicitar era esta:

> **o `sdk` governa transições vanilla; o `agent` governa a sessão viva; e o lifecycle do `agent`
> não deve operar o SDK por chamadas cruas dispersas.**

A subonda aplicada aqui não resolve tudo, mas transforma essa regra em:

- código;
- façade;
- gate;
- contract test;
- e documento permanente da auditoria.
