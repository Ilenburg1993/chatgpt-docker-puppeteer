# 08 — Agent Runtime e Fronteiras em `src/copilot`

**Status**: auditoria ativa **Última atualização**: 2026-04-27 **Escopo desta etapa**:
`src/copilot/agent/` como owner do runtime contínuo, incluindo `always-alive.js`,
`agent-context.js`, `runtime-registry.js`, `facades/*` e a fronteira com `sdk/`, `presentation/`,
`hooks/`, `conversation-hub/` e `terminal/`.

---

## 1. Objetivo deste documento

Este documento audita o centro vivo do sistema.

Se `sdk/` é a fronteira do vanilla, `agent/` é o lugar onde esse vanilla ganha:

- continuidade;
- lifecycle;
- loop de diálogo;
- recuperação;
- health;
- ownership operacional;
- estado e invariantes de runtime.

A pergunta central aqui é:

> **`agent/` está hoje exercendo o papel de owner do runtime contínuo com fronteiras suficientemente
> nítidas, ou ainda acumula responsabilidades demais e semânticas parcialmente concorrentes?**

---

## 2. Base factual utilizada nesta etapa

Esta etapa foi construída a partir de:

- `src/copilot/agent/README.md`
- `src/copilot/agent/index.js`
- `src/copilot/agent/always-alive.js`
- `src/copilot/agent/agent-context.js`
- `src/copilot/agent/runtime-registry.js`
- `src/copilot/agent/facades/index.js`
- `src/copilot/agent/facades/agent-sdk-access.js`
- `src/copilot/README.md`
- `DOCUMENTAÇÃO/ARQUITETURA/SDK-WRAPPER-IDEAL-ARCHITECTURE.md`

---

## 3. Tese arquitetural declarada para `agent/`

## 3.1 Tese canônica

A documentação local é muito clara em um ponto:

> `agent/` é o owner do **runtime contínuo** do Copilot local.

Isso implica que ele deve possuir legitimamente:

- session lifecycle vivo;
- dialog loop;
- turn execution;
- queue/message processing;
- handoff e recovery;
- health e readiness do runtime;
- registry de runtimes conhecidos;
- invariantes do `AgentContext`.

## 3.2 O que `agent/` não deveria ser

Pela mesma tese, `agent/` não deveria ser:

- o lugar onde o vanilla do SDK nasce;
- o lugar onde bordas montam suas projections compartilhadas;
- a camada que define payload HTTP ou REPL de forma compartilhada;
- um depósito indiscriminado de qualquer capability “quente”.

---

## 4. Anatomia atual do runtime do agente

## 4.1 `always-alive.js` como fachada viva

`AlwaysAliveAgent` continua sendo a face principal do runtime.

Ele reúne, diretamente ou via façades:

- gestão do loop de diálogo;
- coordenação de mensagens;
- controle de modo de permissão;
- tool registry snapshot;
- handoff manager;
- pending question / shadow state;
- acesso à superfície útil do SDK;
- acesso a webhooks;
- integração com registry explícita de runtimes.

### Diagnóstico

Isso confirma que `AlwaysAliveAgent` é hoje uma **fachada viva e central**.

A classe ainda é grande e poderosa, mas não pelo motivo errado. Ela é grande porque está no centro
real do runtime.

A questão arquitetural não é “ele deveria ser pequeno a qualquer custo?”.

A questão é:

- suas responsabilidades estão semanticamente organizadas?
- ele delega corretamente para subsistemas e façades?
- seus consumidores externos ficam protegidos de shapes crus?

A resposta preliminar é: **parcialmente sim, com espaço real para endurecimento adicional**.

---

## 4.2 `agent-context.js` como source-of-truth interno

`AgentContext` é provavelmente o arquivo mais importante do runtime depois de `AlwaysAliveAgent`.

Ele centraliza:

- subestados nomeados (`sessionState`, `dialogState`, `configState`, `metricsState`, `runtimeState`,
  `ioState`);
- managers vivos (`messageQueue`, `dialogLoop`, `webhooks`, `permissions`, `toolsRegistry`,
  `keepalive`, `handoff`, `messagesCache`, `sdkElicitation`, `backgroundTasks`);
- snapshots e accessors compatíveis;
- factories do contexto.

### Diagnóstico

Isso é um movimento arquitetural positivo.

Em vez de um conjunto difuso de campos privados dispersos, o sistema concentrou a espinha do estado
vivo em um contexto explícito.

### Ponto forte

A presença de:

- factories explícitas;
- snapshots semânticos;
- subestados nomeados;
- accessors compatíveis;

indica que `agent/` está se movendo de um modelo de “objeto monolítico” para um modelo de **runtime
com contratos internos mais explicitáveis**.

### Ponto de risco

`AgentContext` ainda é, inevitavelmente, uma estrutura muito poderosa.

O risco arquitetural aqui é clássico:

> virar uma super-API interna onde qualquer módulo toca qualquer coisa porque “está no contexto”.

Essa tensão precisa ser monitorada durante toda a auditoria.

---

## 4.3 `runtime-registry.js` como preparação para multi-runtime

O registry explícito de runtimes é um sinal arquitetural importante.

Ele introduz:

- `DEFAULT_AGENT_RUNTIME_ID`;
- registro explícito de runtimes;
- default runtime configurável;
- listagem e query explícita.

### Diagnóstico

Esse é um avanço saudável, porque separa:

- singleton histórico;
- runtime default explícito;
- futuros runtimes nomeados.

### Situação ideal

O registry deve crescer como infraestrutura clara de multi-runtime, mas sem permitir que isso abra
atalhos caóticos nas bordas.

Em outras palavras:

- multi-runtime deve ser resolvido por façades e `presentation/`,
- não por cada consumer chamando registry diretamente de forma ad hoc.

---

## 4.4 `facades/*` como fronteira estratégica do runtime

O barrel de `agent/facades/index.js` mostra claramente uma direção importante:

o runtime está tentando organizar sua API pública em domínios como:

- dialog runtime;
- model config;
- runtime capabilities;
- runtime controls;
- runtime ownership;
- runtime status;
- runtime todos;
- runtime tools;
- runtime webhooks;
- SDK access / SDK session / SDK runtime;
- session ops.

### Diagnóstico

Essa é provavelmente a maior oportunidade estrutural do `agent/`.

Se as façades se consolidarem de verdade como owners públicos do runtime, o restante do sistema
passa a depender muito menos de:

- `AlwaysAliveAgent` gigantesco;
- conhecimento direto do `AgentContext`;
- imports cruzados em módulos quentes.

### Situação atual

O progresso já é real, mas ainda incompleto.

Os próprios documentos anteriores já reconhecem isso.

---

## 5. O que `agent/` possui legitimamente hoje

## 5.1 Responsabilidades legítimas

`agent/` parece possuir legitimamente, hoje:

### A. Runtime lifecycle

- start/stop;
- reconnect;
- shutdown cooperativo;
- keepalive;
- session boot wiring;
- recovery.

### B. Dialog runtime

- dialog loop;
- pause/resume/stop;
- pending question;
- pending shadow;
- turn execution;
- stall/recovery semantics.

### C. Runtime state and invariants

- source-of-truth do estado vivo do agente;
- status do runtime;
- queue state;
- health snapshot;
- ownership de sessão em runtime;
- relationship with active SDK session.

### D. Public façade of the runtime

- API pública do runtime via `always-alive.js` e `facades/*`;
- runtime selection/registry;
- runtime snapshots and controls.

### E. Runtime-side integration points

- permission mode at runtime;
- webhook registration;
- tool registry snapshot;
- SDK elicitation provider queue integration.

---

## 6. Principais tensões arquiteturais em `agent/`

## 6.1 `AlwaysAliveAgent` vs `facades/*`

### Situação atual

`AlwaysAliveAgent` ainda expõe muita coisa diretamente, ao mesmo tempo em que as façades já existem
e estão crescendo.

### Diagnóstico

Existe aqui uma tensão saudável, mas ainda aberta:

- manter `AlwaysAliveAgent` como fachada principal por compatibilidade e ergonomia;
- ao mesmo tempo, deslocar a autoridade pública real para `facades/*`.

### Situação ideal

- `AlwaysAliveAgent` continua existindo como casca operacional e façade principal;
- porém a semântica pública de domínio deve nascer cada vez mais em façades explícitas;
- o corpo da classe deixa de ser o único mapa mental do runtime.

## 6.2 `AgentContext` vs módulos quentes de domínio

### Situação atual

O contexto já oferece snapshots e helpers semânticos, o que é ótimo.

### Diagnóstico

O risco continua sendo acesso demais por shape de contexto bruto.

### Situação ideal

- módulos quentes dependem de snapshots/helpers semânticos e factories;
- o shape cru do contexto vira implementação interna, não interface implícita.

## 6.3 `agent/` vs `presentation/`

### Situação atual

A documentação do próprio `agent/` já reconhece corretamente:

- `agent/` governa o runtime;
- `presentation/` governa o acesso compartilhado das bordas.

### Diagnóstico

Isso é ótimo em teoria, mas é justamente uma fronteira sensível porque runtime code tende a acumular
projection code por conveniência.

### Situação ideal

- `agent/` define truth, invariantes e mutações;
- `presentation/` projeta para server/terminal;
- nenhuma borda deve precisar reabrir a topologia do runtime.

## 6.4 `agent/` vs `conversation-hub/`

### Situação atual

Há uma relação íntima, mas ainda claramente tensa, entre:

- sessão viva do runtime;
- sessão persistida/orquestrada no hub;
- ownership cross-surface.

### Situação ideal

A divisão ideal é:

- `agent/` = dono da sessão viva e do estado operacional;
- `conversation-hub/` = dono do store persistente, replay, orquestração multi-sessão e surface de
  sync.

A auditoria futura precisará confirmar se isso já acontece de fato em código.

## 6.5 `agent/` vs `hooks/`

### Situação atual

`agent/` consome o resultado de policies e callbacks do SDK, e também oferece contexto/factories
para partes do provider-side de elicitation.

### Diagnóstico

Essa fronteira exige cuidado para que:

- `hooks/` não se torne mini-runtime;
- `agent/` não absorva policy configurável que deveria permanecer fora dele.

---

## 7. Riscos estruturais específicos do módulo `agent/`

## 7.1 Superfície pública extensa demais

O barrel `agent/index.js` é amplo.

Isso traz uma vantagem: compatibilidade e descoberta.

Mas também traz um risco:

- a API pública do runtime pode ficar grande demais sem uma taxonomia formal suficientemente dura.

### Regra proposta

O barrel amplo pode continuar existindo, mas a auditoria deve passar a distinguir:

- **public API estratégica**;
- **public API compatível**;
- **exports tolerados, mas não ideais como surface principal**.

## 7.2 Contexto poderoso demais

`AgentContext` é inevitavelmente poderoso.

### Regra proposta

A cada nova capacidade adicionada ao contexto, perguntar:

1. isso deveria ser uma factory explícita?
2. isso deveria ser uma façade explícita?
3. isso deveria ser snapshot semântico em vez de shape cru?

## 7.3 Classe central como "god object" operacional

`AlwaysAliveAgent` pode se tornar um objeto central demais.

### Regra proposta

Ele deve continuar como owner legítimo do runtime, mas com semântica cada vez mais modularizada em:

- façades;
- subsistemas;
- ports;
- factories;
- projections externas fora dele.

---

## 8. Situação ideal TO-BE para `agent/`

## 8.1 Missão ideal consolidada

`agent/` deve ser o módulo que responde à pergunta:

> **como a sessão vanilla do SDK se transforma em um runtime contínuo, stateful, resiliente,
> observável e controlável?**

## 8.2 Owners ideais internos de `agent/`

### `always-alive.js`

- fachada operacional principal;
- casca coordenadora;
- compat surface.

### `agent-context.js`

- source-of-truth interna do runtime;
- estado nomeado;
- managers vivos;
- factories.

### `facades/*`

- surface pública estratégica do runtime;
- queries e controls canônicos;
- tradução semântica entre runtime e consumers externos.

### `dialog/*`, `lifecycle/*`, `messaging/*`, `session/*`, `state/*`

- owners internos especializados por subdomínio do runtime.

### `runtime-registry.js`

- owner da descoberta/registro explícito de runtimes.

---

## 9. Decisões preliminares desta etapa

1. **`agent/` continua sendo claramente o owner do runtime vivo**.
2. **O maior trabalho restante aqui não é redistribuir a ownership do runtime, e sim explicitar
   melhor sua surface pública e reduzir zonas de acesso implícito**.
3. **`facades/*` deve continuar sendo a principal estratégia de saneamento arquitetural do módulo**.
4. **`AgentContext` deve ser tratado como implementação interna altamente poderosa, mas
   progressivamente menos dependida por shape cru**.
5. **A fronteira com `presentation/` e `conversation-hub/` é a mais importante a continuar
   auditando**.
6. **A superfície compatível ampla de `agent/index.js` deve continuar existindo, mas sua curadoria
   precisa ficar cada vez mais consciente**.

---

## 10. Conclusão desta etapa

A conclusão principal é esta:

> `agent/` não parece estar arquiteturalmente perdido. Ele parece estar em **transição controlada**
> de um runtime centralizado para um runtime com contratos mais explícitos.

Isso é um sinal forte de maturidade.

O problema atual do módulo não é falta de papel. O papel existe e é forte.

O problema atual é outro:

- volume;
- centralidade excessiva natural;
- necessidade de continuar deslocando semântica pública para façades claras;
- necessidade de continuar isolando projections fora do runtime;
- necessidade de explicitar melhor a fronteira com hub, hooks e presentation.

O próximo passo natural da auditoria, portanto, é ir para os polos que mais tensionam esse módulo:

- `09-HOOKS-E-POLICIES.md`
- `10-EVENTS-E-TRADUCAO-DE-SINAIS.md`
- `14-CONVERSATION-HUB-E-PERSISTENCIA.md`
