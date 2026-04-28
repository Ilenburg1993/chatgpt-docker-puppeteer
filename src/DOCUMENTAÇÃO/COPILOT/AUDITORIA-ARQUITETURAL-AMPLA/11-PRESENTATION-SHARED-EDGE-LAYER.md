# 11 — `presentation/` como Shared Edge Layer

**Status**: auditoria ativa **Última atualização**: 2026-04-27 **Escopo desta etapa**:
`src/copilot/presentation/` como camada de projeções e accessors compartilhados entre `server/`,
`terminal/` e demais bordas.

---

## 1. Objetivo deste documento

A pasta `presentation/` é uma das peças mais estratégicas e, ao mesmo tempo, mais fáceis de ser mal
compreendidas.

Ela não é:

- o runtime;
- o SDK;
- a borda HTTP;
- a borda humana.

Ela é a camada que responde à pergunta:

> **o que as bordas precisam compartilhar sem conhecer profundamente a topologia do runtime?**

Este documento audita se essa tese está realmente se sustentando em código.

---

## 2. Base factual utilizada nesta etapa

A análise se apoia em:

- `src/copilot/presentation/README.md`
- `src/copilot/presentation/agent-runtime.js`
- `src/copilot/presentation/runtime-request.js`
- documentação anterior desta auditoria (`05`–`10`)

---

## 3. Tese arquitetural declarada para `presentation/`

## 3.1 Tese canônica

A documentação atual é precisa:

> `presentation/` é a camada de **projeções compartilhadas de borda**.

Ela deve existir para evitar acoplamentos errados como:

- `server/` dependendo de semântica do `terminal/`;
- `terminal/` dependendo diretamente de internals do runtime em muitos pontos;
- cada borda reimplementando parsing de `runtimeId`, status payloads e selection logic.

## 3.2 O que `presentation/` não deve ser

Segundo a própria documentação, `presentation/` não deve ser:

- source-of-truth do runtime;
- owner da semântica vanilla do SDK;
- local de regras de lifecycle do agent;
- dumping ground de utilitários genéricos.

---

## 4. O que `presentation/` parece fazer corretamente hoje

## 4.1 `agent-runtime.js` como accessor compartilhado

Esse arquivo encapsula algo essencial:

- `server/` e `terminal/` não precisam mais conhecer, ao mesmo tempo, o singleton lazy do agent e o
  registry explícito de runtimes.

Ele centraliza:

- resolução do runtime default;
- runtime selection com fallback explícito;
- runtime lookup nomeado;
- listagem de runtimes em shape seguro.

### Diagnóstico

Isso é um ótimo exemplo de responsabilidade correta para `presentation/`:

- não muda o runtime;
- não define a política do runtime;
- apenas torna o consumo compartilhado e explícito.

## 4.2 `runtime-request.js` como parsing canônico de borda

Esse arquivo também mostra a força correta de `presentation/`.

Ele centraliza:

- leitura de `runtimeId` via query/header/body/params;
- resolução das deps de rota para `copilot-api`;
- binding canônico para routers HTTP.

### Diagnóstico

Esse tipo de lógica **não pertence nem ao runtime puro nem à borda pura**. Ela é exatamente o tipo
de concern que justifica uma shared edge layer.

## 4.3 Família de arquivos coerente com a tese

O README lista uma família muito consistente:

- `runtime-overview.js`
- `runtime-status.js`
- `runtime-health.js`
- `runtime-targeting.js`
- `runtime-controls.js`
- `runtime-sdk-session.js`
- `runtime-file-context.js`
- `runtime-ui-state-store.js`
- `runtime-dialog.js`
- `system-config.js`
- `system-metrics.js`
- `conversation-hub.js`
- `sdk-sessions.js`

### Diagnóstico

Essa pasta já deixou de ser “helper bag”. Ela está se tornando uma camada propriamente dita.

---

## 5. Por que `presentation/` é tão importante arquiteturalmente

## 5.1 Ela protege `agent/` de vazamento de borda

Sem `presentation/`, o `agent/` tenderia a acumular:

- payload shaping para HTTP;
- parsing canônico de runtime selection;
- projeções específicas para terminal;
- dependências repetidas de rotas.

Isso faria o runtime virar também owner das bordas, o que é errado.

## 5.2 Ela protege `server/` e `terminal/` de reabrir o runtime

Sem `presentation/`, cada borda tenderia a conhecer:

- `getAgent()`;
- registry de runtimes;
- facades do SDK;
- detalhes de fallback;
- shape de snapshots;
- selection semantics.

Isso multiplicaria drift e inconsistência.

## 5.3 Ela é o lugar certo para semântica "compartilhada, mas não fundacional"

Existem responsabilidades que não são nem base técnica nem domínio puro. Exemplos:

- resolver `runtimeId` por múltiplos canais de request;
- montar payload comum de status;
- compor deps de rota;
- refletir modo/plan/session vanilla para múltiplas bordas.

Esse tipo de coisa justifica `presentation/`.

---

## 6. Fronteiras críticas de `presentation/`

## 6.1 `presentation/` vs `agent/`

### Situação atual

A documentação de ambos os módulos já reconhece a separação correta:

- `agent/` governa o runtime;
- `presentation/` governa o acesso compartilhado das bordas.

### Diagnóstico

Essa é uma das melhores definições de fronteira em todo `src/copilot`.

### Risco real

A fronteira é conceitualmente clara, mas estruturalmente frágil porque `presentation/` sempre pode
ser tentada a subir semântica demais do runtime.

### Situação ideal

- `agent/` mantém truth, invariantes e mutações;
- `presentation/` mantém accessors, targeting, projections e route deps compartilhadas.

## 6.2 `presentation/` vs `server/`

### Situação atual

O `server/` já pode montar rotas com menos conhecimento da topologia do runtime graças à família de
`runtime-request.js`, `runtime-route-deps.js`, `agent-http-errors.js`, `system-metrics.js`, etc.

### Situação ideal

`server/` deve ser consumidor de `presentation/`, não reimplementador do runtime.

## 6.3 `presentation/` vs `terminal/`

### Situação atual

`terminal/frontend/llm-b-runtime.js` usa pesadamente `presentation/*` para acessar runtime, SDK
session, snapshots, handoff, controls e targeting.

### Diagnóstico

Esse é um caso muito saudável de reutilização correta.

### Situação ideal

`terminal/` deve continuar usando `presentation/` como shared edge layer, preservando em si apenas:

- render;
- prompt;
- waiting UX;
- parsing de comandos;
- narrativa operacional humana.

## 6.4 `presentation/` vs `sdk/`

### Situação atual

A camada já consome capabilities vanilla projetadas por `agent/`/`sdk`, por exemplo em
`runtime-sdk-session.js`.

### Situação ideal

`presentation/` jamais deve inventar capacidade vanilla nova. Ela apenas a projeta.

---

## 7. Riscos estruturais específicos de `presentation/`

## 7.1 Virar dumping ground de qualquer helper compartilhado

Esse é o risco estrutural número um.

### Sinal de regressão

Entram em `presentation/` funções que:

- não são projeções de borda;
- não são accessors compartilhados;
- não compõem payload/route deps/selection shared;
- poderiam ficar em `core/`, `config/` ou em um owner de domínio mais claro.

## 7.2 Virar "segundo runtime"

Se `presentation/` passar a:

- manter estado vivo relevante;
- decidir lifecycle;
- governar reconnection;
- reimplementar health source-of-truth;

ela deixará de ser shared edge layer e se tornará runtime paralelo — uma regressão grave.

## 7.3 Misturar shared edge e edge-specific logic

### Risco

Partes de UX exclusivamente do terminal ou de protocolo exclusivamente do server podem ser jogadas
em `presentation/` apenas porque “ambas são bordas”.

### Regra proposta

Só sobe para `presentation/` o que é efetivamente compartilhável e vantajoso para mais de uma borda.

---

## 8. Situação ideal TO-BE para `presentation/`

## 8.1 Missão ideal consolidada

`src/copilot/presentation/` deve ser o módulo que responde:

> **como capabilities e estados do runtime são expostos, selecionados e projetados de forma
> compartilhada para bordas externas, sem que essas bordas precisem reabrir a topologia do
> sistema?**

## 8.2 Responsabilidades legítimas

- runtime targeting;
- route deps compartilhadas;
- projections de status/health/overview;
- projections de SDK session úteis a múltiplas bordas;
- mapping canônico `Error -> HTTP` quando isso for shared;
- file context e UI state compartilháveis;
- projections de system metrics/config úteis a mais de uma borda.

## 8.3 Responsabilidades ilegítimas

- runtime lifecycle source-of-truth;
- vendor capability definition;
- tool policy;
- prompt/render humano;
- protocolo HTTP puro;
- orchestration de conversation hub como owner primário.

---

## 9. Decisões preliminares desta etapa

1. **`presentation/` parece hoje um dos módulos emergentes mais corretos de `src/copilot`**.
2. **A sua existência é arquiteturalmente necessária para separar `agent/` das bordas**.
3. **A maior disciplina futura aqui será impedir que a pasta vire dumping ground de helpers vagos**.
4. **`runtime-targeting`, `runtime-request`, `runtime-route-deps` e `runtime-sdk-session` são
   exemplos particularmente fortes do tipo de responsabilidade correta para esse layer**.
5. **A fronteira ideal é: `agent` governa o runtime; `presentation` governa o acesso compartilhado
   ao runtime**.

---

## 10. Conclusão desta etapa

A conclusão principal é fortemente positiva:

> `presentation/` já deixou de ser um experimento e está se consolidando como a camada certa para
> evitar que `server/` e `terminal/` reconstruam o runtime por conta própria.

O problema principal aqui não é validar sua existência — isso já está validado.

O problema principal é **governar seu crescimento** para que ela continue sendo:

- shared edge layer,
- e não runtime paralelo,
- nem helper bag indiferenciado.

As próximas duas etapas da auditoria aprofundam exatamente os consumidores dessa camada:

- `12-SERVER-HTTP-SSE-SOCKET-BOUNDARY.md`
- `13-TERMINAL-UX-E-CONSUMO-DO-RUNTIME.md`
