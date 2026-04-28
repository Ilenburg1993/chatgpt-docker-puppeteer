# 15 — `tools/` e Execução Operacional do Agente

**Status**: auditoria ativa **Última atualização**: 2026-04-27 **Escopo desta etapa**:
`src/copilot/tools/` como domínio de custom tools, execução operacional e integração da superfície
de tools do runtime local com a camada SDK.

---

## 1. Objetivo deste documento

Este documento audita a pasta `tools/`, que responde a uma pergunta diferente de `sdk/tools/*`.

Enquanto a camada SDK trata do **contrato vanilla** de registry/state/factory, a pasta `tools/`
parece responder:

> **quais ferramentas o runtime local realmente oferece ao agente para operar sobre código, shell,
> git, web, hub, sessão e TODOs?**

A pergunta central da auditoria aqui é:

> **`tools/` está hoje claramente posicionada como domínio de execução operacional, ou ainda existe
> confusão com hooks, SDK tools registry e runtime policy?**

---

## 2. Base factual utilizada nesta etapa

A análise se apoia em:

- `src/copilot/tools/README.md`
- `src/copilot/tools/index.js`
- documentação anterior desta auditoria (`05`–`14`)

---

## 3. Tese arquitetural atual para `tools/`

## 3.1 Tese declarada

O README do módulo é claro:

- `tools/` é a camada de definição e registro de custom tools do agente;
- cada tool é uma função registrada no SDK que o agente pode chamar durante o diálogo.

Isso posiciona `tools/` como:

- domínio operacional local do agente;
- superfície de capabilities concretas de ação;
- conjunto de implementações que o runtime expõe ao modelo.

## 3.2 Relação declarada com `sdk/`

A própria documentação sugere a fronteira correta:

- `sdk/tools/*` = infraestrutura vanilla do wrapper;
- `tools/` = tools reais do produto/runtime local.

Essa é uma distinção importante e correta.

---

## 4. O que `tools/` parece fazer corretamente hoje

## 4.1 Taxonomia ampla de tools reais

`tools/index.js` centraliza categorias como:

- `taskTools`
- `codeTools`
- `gitTools`
- `sessionTools`
- `sessionRpcTools`
- `hookTools`
- `hubTools`
- `fileTools`
- `shellTools`
- `webTools`
- `todoTools`
- `permissionTools`
- `introspectionTools`
- `experimentalRpcTools`

### Diagnóstico

Essa taxonomia é coerente com um runtime operacional rico e mostra que `tools/` é um domínio real.

## 4.2 `buildTool()` e wrappers próprios

A pasta mantém sua própria infraestrutura prática de composição como:

- `buildTool()`
- `withSkipPermission`
- setters de DI específicos (`setHub`, `setPermissionAgent`, `setSessionRpc`)

### Diagnóstico

Isso é legítimo desde que continue subordinado ao contrato do SDK, e não competindo com ele.

## 4.3 `allTools` / `getAllTools()` como registry operacional local

O uso de `getAllTools()` com cache explícito deixa clara uma responsabilidade útil:

- a pasta também é o ponto de agregação do catálogo local de tools reais.

### Diagnóstico

Isso faz sentido para o domínio `tools/`, contanto que não entre em conflito com o registry/state do
wrapper SDK.

---

## 5. Fronteiras críticas de `tools/`

## 5.1 `tools/` vs `sdk/tools/*`

### Situação atual

Esta é a fronteira mais importante da etapa.

A distinção ideal é:

- `sdk/tools/*` = infrastructure wrapper, registry/state/factory vanilla;
- `tools/` = catálogo e implementação das tools do runtime local.

### Diagnóstico

A separação parece conceitualmente correta, mas é um ponto que sempre merece vigilância porque o
nome “tools” existe dos dois lados.

### Situação ideal

Nenhuma tool de domínio real deve nascer em `sdk/`. Nenhuma infraestrutura vanilla de tool
registry/state deve nascer em `tools/`.

## 5.2 `tools/` vs `hooks/`

### Situação atual

Existe proximidade natural entre:

- tools,
- permission policy,
- hook interception,
- hook tools.

### Diagnóstico

Esse é um local clássico de confusão.

### Situação ideal

- `tools/` define capabilities executáveis;
- `hooks/` define policy/interceptação sobre a execução dessas capabilities via slots do SDK.

## 5.3 `tools/` vs `agent/`

### Situação atual

O README afirma algo muito importante:

- tools são registradas pelo agent, mas `tools/` não deve importar `agent/` como owner do domínio.

### Diagnóstico

Isso é arquiteturalmente saudável. Evita acoplamento circular do tipo “o runtime vive dentro das
próprias tools”.

## 5.4 `tools/` vs `bridges/`

### Situação atual

`tools/` pode consumir bridges e integrações externas, o que faz sentido.

### Situação ideal

Bridges continuam sendo adapters externos; tools são as capabilities operacionais que podem usá-las.

---

## 6. Riscos estruturais específicos de `tools/`

## 6.1 Misturar capability com policy

É o risco número um do módulo.

### Sinal de regressão

- lógica de permissão/interceptação migra para dentro da própria tool;
- a tool decide policy que deveria estar em hooks/permissions;
- exceções de governança aparecem embutidas em ferramentas específicas.

## 6.2 Misturar catálogo operacional com infraestrutura vanilla de registry

### Risco

`tools/` começar a assumir papéis que pertencem ao wrapper SDK, como:

- state registry do SDK;
- negociação vanilla com o vendor;
- semântica do contrato de tool definition além do necessário.

## 6.3 Acúmulo desordenado de categorias

Como ferramentas novas são sempre atraentes, o módulo tende a crescer indefinidamente.

### Regra proposta

Cada tool nova deveria responder:

1. é capability de domínio do runtime local?
2. não pertence a `bridges/`, `hooks/`, `sdk/` ou `presentation/`?
3. sua categoria é realmente distinta ou já existe uma taxonomia adequada?

---

## 7. Situação ideal TO-BE para `tools/`

## 7.1 Missão ideal consolidada

`src/copilot/tools/` deve ser o módulo que responde:

> **quais são as capabilities executáveis e operacionais do runtime local que o agente pode invocar
> para agir sobre código, ambiente, web, sessão, hub e tarefas?**

## 7.2 Responsabilidades legítimas

- implementação concreta de tools de domínio;
- agrupamento por categoria operacional;
- catálogo operacional local de tools;
- wrappers práticos de composição local de tools;
- integração operacional com bridges e stores quando necessário.

## 7.3 Responsabilidades ilegítimas

- policy de permissão/interceptação como owner primário;
- tradução de eventos do SDK;
- semântica vanilla do wrapper SDK;
- projections de borda;
- lifecycle do runtime.

---

## 8. Decisões preliminares desta etapa

1. **`tools/` parece ser um domínio legítimo e necessário de execução operacional**.
2. **A fronteira mais importante a proteger é `tools/` vs `sdk/tools/*`**.
3. **A segunda fronteira mais importante é `tools/` vs `hooks/`**.
4. **O módulo deve continuar centrado em capability executável, não em policy ou governance**.
5. **O crescimento da taxonomia de tools precisa ser governado para evitar explosão categorial e
   drift de responsabilidades**.

---

## 9. Conclusão desta etapa

A conclusão principal é positiva:

> `tools/` parece hoje muito mais um catálogo operacional real do agente do que uma pasta ambígua.

O que precisa de vigilância contínua não é sua existência, mas sua fronteira:

- com `sdk/tools/*`;
- com `hooks/`;
- com bridges e adapters externos.

Em resumo:

- `tools/` deve continuar sendo o lugar onde o agente ganha **mãos operacionais**;
- mas não o lugar onde ele ganha sua semântica vanilla, sua policy ou sua projection.
