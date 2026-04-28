# 09 — Hooks e Policies em `src/copilot`

**Status**: auditoria ativa **Última atualização**: 2026-04-27 **Escopo desta etapa**:
`src/copilot/hooks/` como owner de callbacks, policies e composição de hooks sobre o SDK, incluindo
factory, permission handling, lifecycle hooks, user input, elicitation e presets.

---

## 1. Objetivo deste documento

Este documento audita a pasta `hooks/`, que é uma das maiores zonas de risco semântico de qualquer
runtime baseado em SDK.

A razão é simples:

- hooks parecem “apenas callbacks”,
- mas rapidamente podem virar:
  - policy engine,
  - intercept layer,
  - runtime side-effect bus,
  - local de auditoria,
  - local de observabilidade,
  - ou até mini-runtime paralelo.

A pergunta central desta etapa é:

> **`hooks/` está hoje operando como owner disciplinado de policies/callbacks do SDK, ou já está
> absorvendo responsabilidades que pertencem a outros módulos?**

---

## 2. Base factual utilizada nesta etapa

A análise se apoia em:

- `src/copilot/hooks/README.md`
- `src/copilot/hooks/index.js`
- `src/copilot/hooks/factory.js`
- `src/copilot/hooks/session-hooks.js`
- `src/copilot/README.md`
- `DOCUMENTAÇÃO/ARQUITETURA/SDK-WRAPPER-IDEAL-ARCHITECTURE.md`
- contexto recente da implementação de elicitation provider-side

---

## 3. Tese arquitetural declarada para `hooks/`

## 3.1 Tese canônica

A tese declarada é forte:

> `hooks/` é o sistema modular de **hooks do SDK**, isto é, o lugar onde callbacks e policies sobre
> a sessão SDK são compostos, reutilizados e tornados testáveis.

Isso implica, idealmente, que `hooks/` deva possuir:

- composition de callbacks do SDK;
- presets de policies;
- permission handling de alto nível;
- interceptação de prompt/tool use sob contrato do SDK;
- session lifecycle hooks;
- user input / elicitation helpers enquanto **callbacks do SDK**;
- bus/registry/composer próprios desse subsistema.

## 3.2 O que `hooks/` não deveria ser

Pela mesma lógica, `hooks/` não deveria ser:

- tradutor de `SessionEvent` do SDK;
- source-of-truth de estado do runtime contínuo;
- camada de projection compartilhada para bordas;
- local principal de semântica de audit trail do sistema;
- substituto do `agent/` na governança do ciclo de vida do runtime.

---

## 4. O que `hooks/` parece fazer corretamente hoje

## 4.1 Organização interna forte

O barrel `hooks/index.js` mostra um sistema conscientemente organizado, com categorias explícitas:

- factory;
- permission handlers;
- session lifecycle;
- prompt transformers;
- tool interceptors;
- user input;
- elicitation queue/provider helpers;
- bus;
- registry;
- composer;
- presets;
- error handlers;
- audit trail support;
- logger injection.

### Diagnóstico

Isso não parece um módulo improvisado. Parece um subsistema real.

## 4.2 `factory.js` como composition engine

`factory.js` deixa claro que o módulo é capaz de compor:

- `onPreToolUse`;
- `onPostToolUse`;
- `onUserPromptSubmitted`;
- `onSessionStart`;
- `onSessionEnd`;
- `onErrorOccurred`.

O arquivo ainda faz distinções importantes entre:

- filtering estático;
- filtering dinâmico;
- askHandler;
- argsModifier;
- audit logging;
- error strategy.

### Diagnóstico

Isso é exatamente o tipo de papel que `hooks/` deveria exercer.

## 4.3 `session-hooks.js` como lifecycle policy

`session-hooks.js` demonstra bem a natureza correta do módulo:

- não toma posse do runtime por conta própria;
- recebe contexto injetado;
- produz callbacks de ciclo de vida da sessão SDK;
- enriquece eventos com telemetry/audit/webhook when appropriate.

### Diagnóstico

Esse desenho é forte porque mantém o módulo do lado certo da fronteira:

- **callback policy**, não **runtime orchestration**.

---

## 5. O que torna `hooks/` perigoso arquiteturalmente

## 5.1 Hooks ficam naturalmente perto de tudo

Hooks tocam:

- tools;
- prompts;
- sessão;
- erro;
- permissões;
- user input;
- elicitation;
- webhook;
- audit;
- observabilidade.

Isso faz de `hooks/` um módulo com altíssimo potencial de acoplamento transversal.

### Consequência

Mesmo quando o módulo está correto hoje, ele precisa de vigilância arquitetural contínua.

## 5.2 O barrel de `hooks/` é naturalmente tentador

Assim como o barrel do SDK, o barrel de hooks é amplo.

Risco:

- virar “pasta onde colocamos qualquer comportamento que intercepta algo”.

### Regra proposta

Novo código só entra em `hooks/` se a resposta for “sim” para ambas as perguntas:

1. isso é callback ou policy sob contrato do SDK?
2. isso existe porque o SDK abriu um slot/hook real para isso?

Se a resposta for “não”, provavelmente não pertence a `hooks/`.

---

## 6. Fronteiras críticas de `hooks/`

## 6.1 `hooks/` vs `sdk/`

### Situação atual

A separação documental é boa:

- `sdk/` expõe o vanilla;
- `hooks/` compõe callbacks/policies sobre esse vanilla.

O próprio barrel do `sdk/` deixa claro que fábricas de hooks não pertencem mais a L1.

### Diagnóstico

Essa é uma fronteira saudável e uma das correções mais importantes já realizadas no sistema.

### Situação ideal

- `sdk/` define o contrato e a capability;
- `hooks/` define a policy configurável em cima dele.

## 6.2 `hooks/` vs `event-handlers/`

### Situação atual

`event-handlers/` traduz eventos do SDK; `hooks/` compõe callbacks do SDK.

### Diagnóstico

Essa divisão é teoricamente clara, mas operacionalmente delicada, porque ambos lidam com “coisas que
acontecem ao redor da sessão”.

### Situação ideal

- `hooks/` reage a slots formais do SDK;
- `event-handlers/` traduz o fluxo de eventos vanilla;
- nenhum dos dois invade o papel do outro.

## 6.3 `hooks/` vs `agent/`

### Situação atual

`hooks/` recebe contexto injetado do runtime e ajuda a materializar pieces como permission policy,
elicitation queue/provider e session lifecycle callbacks.

### Diagnóstico

Essa colaboração é inevitável, mas precisa permanecer assimétrica:

- `agent/` oferece contexto e runtime authority;
- `hooks/` compõe callbacks/policies sobre slots do SDK.

### Situação ideal

`hooks/` não deve começar a tomar decisões que exigem visão total do runtime como owner.

## 6.4 `hooks/` vs `observability/` e `audit/`

### Situação atual

O módulo toca logging, audit trail e, em alguns casos, webhook/telemetria.

### Diagnóstico

n Aqui mora um dos maiores riscos reais do sistema.

`hooks/` está legitimamente perto do que precisa ser auditado e observado. Mas isso não significa
que deva virar o owner desses domínios.

### Situação ideal

- `hooks/` pode emitir ou enriquecer sinais;
- `observability/` mede/correlaciona;
- `audit/` preserva evidência/governança;
- o significado do runtime continua sendo do `agent/`, e o significado vanilla continua sendo do
  `sdk/`.

---

## 7. Subdomínios internos de `hooks/` e sua legitimidade

## 7.1 Factory / composer / presets

### Diagnóstico

Legítimos e necessários.

Esses subdomínios são exatamente o que se espera de um módulo de policies configuráveis:

- reuso;
- composição;
- presets seguros;
- padronização de comportamento.

## 7.2 Permission handling

### Diagnóstico

Também legítimo.

Permissões são um dos eixos mais naturais de hooks/policy sobre o SDK.

### Cuidado

A política de permissão não deve vazar para semântica de runtime que não passe por hooks do SDK.

## 7.3 User input e elicitation provider-side

### Diagnóstico

Legítimos, **desde que tratados como callback/provider helpers do SDK**.

O trabalho recente com `createQueuedElicitationHandler()` e a fila provider-side reforça isso.

### Fronteira ideal

- `hooks/` materializa o handler;
- `agent/` governa o runtime onde a fila vive;
- `terminal/`/HTTP podem atuar como resolução externa.

## 7.4 Session lifecycle hooks

### Diagnóstico

Muito legítimos, desde que permaneçam callbacks injetados e não runtime orchestrators.

---

## 8. Riscos estruturais específicos de `hooks/`

## 8.1 Hooks virarem “policy god module”

É o risco número um.

### Sinal de regressão

Começam a aparecer em `hooks/` responsabilidades como:

- state store do runtime;
- projection compartilhada;
- tradução de eventos;
- decision engine que depende de topologia inteira do agent;
- sincronização cross-surface que não depende diretamente de slots do SDK.

## 8.2 Overlap com audit trail

O módulo já exporta componentes relacionados a audit trail.

### Risco

Com o tempo, `hooks/` pode virar o lugar onde se registra “o que aconteceu” de forma total — o que
não é sua missão ideal.

### Regra proposta

`hooks/` pode registrar evidências ligadas à execução de hooks, mas não deve virar o owner genérico
da trilha de auditoria do sistema Copilot.

## 8.3 Overlap com observability

Hooks naturalmente produzem dados úteis para métricas e tracing.

### Regra proposta

`hooks/` pode ser emissor/fonte de sinais, mas não owner central de coleta/tracing do runtime.

---

## 9. Situação ideal TO-BE para `hooks/`

## 9.1 Missão ideal consolidada

`src/copilot/hooks/` deve ser o módulo que responde:

> **como policies configuráveis e callbacks do SDK são compostos, testados e aplicados sem invadir o
> runtime nem duplicar o vanilla?**

## 9.2 Limites ideais

### `hooks/` pode possuir

- factories e presets de hooks;
- permission policy em cima dos hooks/slots do SDK;
- prompt/tool interception sob contrato do SDK;
- lifecycle hooks;
- user input / elicitation provider helpers;
- registries, bus e composers específicos desse domínio.

### `hooks/` não deve possuir

- tradução primária de eventos do SDK;
- projections HTTP/terminal;
- source-of-truth do runtime;
- semântica vanilla do SDK;
- audit trail global do sistema;
- composition root do runtime.

---

## 10. Decisões preliminares desta etapa

1. **`hooks/` parece estruturalmente legítimo e bem organizado como subsistema próprio**.
2. **O principal risco não é desorganização interna, e sim crescimento transversal sem disciplina de
   fronteira**.
3. **A fronteira mais importante a proteger é `hooks/` vs `event-handlers/` vs `agent/`**.
4. **Permission handling, session lifecycle, user input e elicitation provider-side pertencem
   legitimamente a `hooks/`, desde que mantenham contrato de callback/policy sobre o SDK**.
5. **O módulo deve ser auditado continuamente contra a tentação de virar owner de audit,
   observability ou runtime orchestration**.

---

## 11. Conclusão desta etapa

A conclusão principal é moderadamente positiva:

> `hooks/` parece hoje muito mais um **subsistema legítimo de policy/callback composition** do que
> um dumping ground arbitrário.

Isso é excelente.

Mas também é exatamente o tipo de módulo que precisa de guardrails conceituais fortes, porque sua
proximidade com tudo faz dele um candidato natural a drift.

O próximo documento precisa atacar a outra metade dessa fronteira:

- `10-EVENTS-E-TRADUCAO-DE-SINAIS.md`

para deixar inequívoco:

- quem traduz;
- quem nomeia/catalogue;
- quem observa;
- quem orquestra.
