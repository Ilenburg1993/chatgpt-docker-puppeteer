# 14 — `conversation-hub/` e Persistência de Conversa

**Status**: auditoria ativa **Última atualização**: 2026-04-27 **Escopo desta etapa**:
`src/copilot/conversation-hub/` e sua relação com `agent/`, `db/`, `presentation/`, `server/` e o
conceito de sessão persistida.

---

## 1. Objetivo deste documento

Este documento audita um dos domínios mais sensíveis de `src/copilot`:

> **quem é dono da conversa persistida, da multi-sessão, do replay e da sincronização entre
> superfícies?**

A pasta `conversation-hub/` é estruturalmente importante porque toca:

- store;
- orquestração multi-sessão;
- socket namespace;
- persistência;
- relação entre LLM-A, LLM-B e usuário.

E exatamente por isso ela também corre o risco de competir semanticamente com `agent/`.

---

## 2. Base factual utilizada nesta etapa

A análise se apoia em:

- `src/copilot/conversation-hub/README.md`
- `src/copilot/conversation-hub/hub.js`
- documentação anterior desta auditoria (`05`–`13`)

---

## 3. Tese arquitetural atual para `conversation-hub/`

## 3.1 Tese declarada

O README do módulo define `conversation-hub/` como:

- gestão multi-sessão de conversas do Copilot;
- store persistente;
- orquestração de sessões;
- namespace Socket.IO e sincronização.

`hub.js` reforça isso ao declarar `ConversationHub` como singleton que compõe:

- `ConversationStore`;
- `HubOrchestrator`;
- namespace Socket.IO;
- bridge para EventBus e, opcionalmente, NERV.

### Diagnóstico

Isso coloca `conversation-hub/` claramente do lado de:

- persistência de conversa;
- orchestrated multi-session environment;
- realtime propagation da conversa persistida.

---

## 4. O que `conversation-hub/` parece fazer corretamente hoje

## 4.1 `hub.js` como entrypoint único do domínio persistido

O `ConversationHub` já se apresenta como ponto de entrada único para o ambiente permanente LLM-A ↔
LLM-B ↔ usuário.

Isso é importante porque evita a situação ruim em que:

- store;
- orchestrator;
- namespace de socket;
- forwarding de eventos

ficam espalhados em vários pontos sem owner claro.

## 4.2 Relação clara com `store` e `orchestrator`

A documentação do módulo já separa corretamente:

- `hub.js` = entrypoint do domínio;
- `store.js` = store principal;
- `orchestrator.js` = orquestração de sessões;
- `socket-ns.js` = realtime.

### Diagnóstico

A pasta parece ter uma taxonomia interna boa.

## 4.3 Realtime como concern do domínio persistido

O fato de `conversation-hub/` possuir namespace/socket próprio é saudável se entendido assim:

- o hub não é só banco;
- é também a superfície de sincronização da conversa persistida.

Isso é diferente de transformar `server/` em owner do domínio da conversa.

---

## 5. Onde está a tensão arquitetural real

## 5.1 `conversation-hub/` vs `agent/`

### Situação atual

O `agent/` é owner da sessão viva do runtime.

O `conversation-hub/` parece owner da sessão persistida, multi-sessão, replay e sincronização.

### Diagnóstico

Essa divisão é plausível, mas precisa ser defendida explicitamente, porque os dois módulos
tangenciam:

- sessão;
- turns;
- memory;
- state;
- handoff;
- replay.

### Situação ideal

- `agent/` = dono da sessão viva, ativa, stateful em runtime;
- `conversation-hub/` = dono da conversa persistida, multi-sessão, sincronização, replay e store.

## 5.2 `conversation-hub/` vs `server/`

### Situação atual

O servidor expõe rotas e sockets, mas não deve ser owner do domínio do hub.

### Situação ideal

- `conversation-hub/` detém a semântica persistida;
- `server/` apenas expõe esse domínio por protocolo.

## 5.3 `conversation-hub/` vs `presentation/`

### Situação atual

`presentation/` já possui projections e handlers ligados ao hub, o que faz sentido.

### Situação ideal

- `conversation-hub/` define o domínio;
- `presentation/` projeta esse domínio quando necessário para múltiplas bordas;
- `presentation/` não vira store do hub.

---

## 6. Riscos estruturais específicos de `conversation-hub/`

## 6.1 Competir com `agent/` pela ownership da sessão

Este é o risco maior.

### Sinal de regressão

- regras de lifecycle da sessão ativa passam a ser definidas no hub;
- o hub passa a decidir semântica do runtime vivo;
- ou `agent/` passa a manter persistência/replay que deveria estar concentrada no hub.

## 6.2 Hub virar domínio total de conversa e runtime ao mesmo tempo

Como ele é persistente e multi-sessão, existe o risco de virar um “segundo cérebro” do sistema.

### Regra proposta

O hub deve ser poderoso no que diz respeito a:

- store;
- orquestração persistida;
- sincronização;
- replay;
- namespace de conversa.

Mas não deve absorver:

- ownership da sessão ativa do SDK;
- health source-of-truth do runtime vivo;
- policy de diálogo contínuo do agente.

## 6.3 Realtime e domínio persistido se confundirem com protocolo puro

O hub já tem namespace/socket logic. Isso é válido, mas deve continuar claramente subordinado ao
domínio da conversa, não ao protocolo HTTP em geral.

---

## 7. Situação ideal TO-BE para `conversation-hub/`

## 7.1 Missão ideal consolidada

`src/copilot/conversation-hub/` deve ser o módulo que responde:

> **como conversas persistidas, multi-sessão e sincronizadas são armazenadas, orquestradas e
> expostas em realtime sem competir com o runtime vivo do agente?**

## 7.2 Responsabilidades legítimas

- store persistente;
- queries e sync de conversa;
- memory persistida do hub;
- orquestração multi-sessão;
- namespace/socket do domínio conversacional;
- replay e sincronização cross-surface.

## 7.3 Responsabilidades ilegítimas

- lifecycle do runtime ativo;
- source-of-truth da sessão SDK atual;
- policy de dialog loop do agent;
- capacidade vanilla do SDK.

---

## 8. Decisões preliminares desta etapa

1. **`conversation-hub/` parece ser um domínio legítimo, não um agregado acidental**.
2. **A fronteira mais importante a endurecer é sua relação com `agent/`**.
3. **O hub deve ser tratado como owner da conversa persistida e multi-sessão, não da sessão viva do
   runtime**.
4. **`server/` e `presentation/` devem continuar como consumidores/projeções desse domínio, não como
   owners concorrentes**.

---

## 9. Conclusão desta etapa

A conclusão principal é positiva, mas com cautela:

> `conversation-hub/` parece hoje um domínio real e necessário, mas é também uma das áreas em que a
> ambiguidade de ownership com `agent/` pode produzir confusão silenciosa no longo prazo.

Por isso, esta pasta é uma das candidatas naturais a futuras matrizes de decisão explícita entre:

- sessão viva;
- sessão persistida;
- replay;
- memory;
- ownership cross-surface.
