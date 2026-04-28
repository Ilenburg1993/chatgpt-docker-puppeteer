# 07 — SDK e Fronteira Vanilla em `src/copilot`

**Status**: auditoria ativa **Última atualização**: 2026-04-27 **Escopo desta etapa**:
`src/copilot/sdk/`, sua relação com o vendor `@github/copilot-sdk` e a fronteira operacional com
`agent/`, `hooks/`, `tools/`, `config/`, `presentation/` e `observability/`.

---

## 1. Objetivo deste documento

Este documento audita o núcleo mais sensível de toda a arquitetura de `src/copilot`:

> **a camada `sdk/` é realmente a fronteira única, confiável e auditável entre o runtime local e o
> `@github/copilot-sdk`?**

A pergunta é crítica porque, se `sdk/` falhar como owner canônico do vanilla, todo o resto do
sistema tende a deteriorar:

- `agent/` passa a recriar semântica do SDK;
- `terminal/` e `server/` passam a consumir conceitos incompletos ou paralelos;
- `hooks/` começa a competir por papéis que não são seus;
- `observability/` tende a medir sinais inconsistentes;
- contratos deixam de ser cumulativos.

---

## 2. Base factual utilizada nesta etapa

Esta análise se apoia em:

- `src/copilot/sdk/README.md`
- `src/copilot/sdk/index.js`
- `DOCUMENTAÇÃO/ARQUITETURA/SDK-WRAPPER-IDEAL-ARCHITECTURE.md`
- `src/copilot/agent/facades/agent-sdk-access.js`
- `src/copilot/README.md`
- gates de boundary já existentes (`check-copilot-sdk-boundary`, `check-copilot-crude-calls`)

---

## 3. Tese arquitetural declarada para `sdk/`

## 3.1 Tese canônica

Os documentos-base são consistentes em um ponto:

> toda interação com `@github/copilot-sdk` deve começar em `src/copilot/sdk/`.

Essa tese se desdobra em quatro regras:

1. `sdk/` é o **SSOT do vanilla**;
2. `sdk/` é a **única camada autorizada** a importar o vendor diretamente;
3. qualquer capability análoga do runtime local deve **nascer primeiro em `sdk/`**;
4. o restante do sistema consome `sdk/` por:
   - barrel `#copilot/sdk`,
   - façades do `agent/`,
   - projections em `presentation/`.

## 3.2 Estado atual da tese

A leitura atual indica que essa tese já está **bastante operacionalizada**, não apenas documentada.

Evidências:

- o barrel `src/copilot/sdk/index.js` é extremamente amplo e deliberadamente organizado por faixas;
- a arquitetura anexa consolidou explicitamente o princípio “crude call zero”;
- houve guardrails adicionados para barrar import direto do vendor fora de `sdk/`;
- grande parte da promoção recente de capabilities (`session.ui.*`, observabilidade de wrappers,
  mutações de session RPC) aconteceu exatamente no layer `sdk/` antes de subir para `agent/` e
  bordas.

Diagnóstico: **`sdk/` não é apenas uma pasta utilitária; ela já é um subsistema arquitetural de
primeira classe**.

---

## 4. O que `sdk/` parece possuir corretamente hoje

## 4.1 Domínios já consolidados

Pelos READMEs, barrel e documento arquitetural, `sdk/` hoje já possui corretamente:

### A. Client lifecycle

- criação de client;
- start/stop/force stop;
- estado de conexão;
- foreground session;
- ping/auth/quota/status.

### B. Session lifecycle

- create/resume/list/delete;
- send/sendAndWait;
- disconnect/abort;
- session messages;
- workspace path.

### C. Session vanilla capabilities

- `mode.get/set`;
- `plan.read/update/delete`;
- `workspace.read/list/createFile`;
- `session.ui.elicitation/confirm/select/input`;
- shell, compaction, pending permissions, pending tool calls, pending commands.

### D. Tool and permission surface

- `defineTool`;
- tool factories;
- permission handlers vanilla;
- registry/state local de tools do wrapper.

### E. Types and normalization

- `types.js` como SSOT local;
- `errors.js` com `SdkOperationError`;
- helpers de eventos;
- constants e contracts.

### F. Telemetry / metrics de L1

- `sdk/telemetry/operation-metrics.js`;
- wrappers já instrumentados para parte relevante das operações vanilla.

### G. Provider / model surface

- provider config helpers;
- model registry/helpers;
- listagem e metadados de modelos.

---

## 5. Sinais de maturidade já visíveis em `sdk/`

## 5.1 Barrel consciente, não acidental

`src/copilot/sdk/index.js` não é um barrel aleatório.

Ele documenta suas faixas e já incorpora decisões arquiteturais explícitas, como:

- remoção de factories de hooks da superfície `sdk/`;
- remoção de builders que deveriam morar em `config/`;
- comentários de boundary explicando por que certos símbolos não podem mais ser reexportados dali.

Isso mostra algo importante:

> o barrel do `sdk/` já é também uma superfície de governança arquitetural.

## 5.2 Boundary com `hooks/` já explicitada

No próprio barrel aparece a regra:

- hooks factory e permission policy de alto nível devem ser consumidos em `#copilot/hooks`, não em
  `#copilot/sdk`.

Esse tipo de desvio removido é evidência clara de que o sistema já passou por limpeza de fronteira.

## 5.3 Boundary com `config/` também já apareceu como tema real

A remoção de reexports de `buildAlwaysAliveConfig`, `buildReadOnlyConfig`, etc., do `sdk/` em favor
de `#copilot/config/session-config` mostra que já houve drift L1→L2 e correção deliberada.

Conclusão: `sdk/` já tem histórico recente de **desacoplamento intencional**, o que é muito bom.

---

## 6. Fronteiras de `sdk/` com os demais módulos

## 6.1 `sdk/` vs `agent/`

### Situação atual

`agent/` já consome `sdk/` principalmente via:

- `agent/facades/agent-sdk-access.js`
- `agent/facades/agent-sdk-session.js`
- `agent/facades/agent-sdk-runtime.js`
- `agent/ports/tool-port.js`

### Diagnóstico

Essa é a direção correta.

O risco residual já não é o vendor vazar diretamente para fora do `sdk/`.

O risco residual é outro:

> o `agent/` ainda pode **resemantizar demais** o SDK ao subir capabilities para o runtime.

### Situação ideal

- `sdk/` define a capability vanilla e o contrato de erro/telemetria;
- `agent/` define só o que é runtime stateful, lifecycle, orchestration ou policy local.

## 6.2 `sdk/` vs `hooks/`

### Situação atual

A separação teórica está boa:

- `sdk/` = contrato vanilla;
- `hooks/` = composition de callbacks/policies do SDK.

### Diagnóstico

Essa fronteira parece melhor na documentação do que em muitos projetos típicos. Ainda assim, precisa
de auditoria profunda porque hooks sempre tendem a “puxar” integração demais.

### Situação ideal

- `sdk/` não monta policy de negócio sofisticada;
- `hooks/` não reimplementa capability vanilla nem se torna runtime paralelo.

## 6.3 `sdk/` vs `tools/`

### Situação atual

A separação proposta é:

- `sdk/tools/*` = registry/state/factory da superfície vanilla;
- `tools/` = custom tools do agente e domínio operacional local.

### Diagnóstico

Essa fronteira é sensata e precisa ser preservada.

### Situação ideal

- `sdk/` define a infraestrutura vanilla de tool registration e state wrapper;
- `tools/` define as tools de domínio do runtime local.

## 6.4 `sdk/` vs `config/`

### Situação atual

`config/` monta config declarativa; `sdk/` a consome/normaliza no que for diretamente vanilla.

### Diagnóstico

Ainda é uma fronteira sensível, porque sistemas baseados em SDK tendem a deixar “session config”
flutuar entre config builder, boot e wrapper.

### Situação ideal

- `config/` declara;
- `sdk/` transforma em contrato do vendor;
- `boot/` decide quando aplicar;
- `agent/` e bordas não reconstroem config por fora.

## 6.5 `sdk/` vs `presentation/` / `server/` / `terminal/`

### Situação atual

A promoção recente de `session.ui.*` foi um bom teste da arquitetura:

1. capability nasceu/foi endurecida em `sdk/session/ui.js`;
2. depois subiu para façades do `agent/`;
3. depois foi projetada para `presentation/`, `terminal/` e `/sdk` HTTP.

### Diagnóstico

Esse caso é um **exemplo de fluxo ideal** a ser repetido.

---

## 7. O que ainda parece faltar ou exigir verificação profunda em `sdk/`

## 7.1 Gaps já explicitados no documento arquitetural

Os próprios documentos já reconhecem gaps relevantes:

- `sdk/session/permissions.js` — padronização de try/catch;
- `sdk/session/provider.js` — crude calls/provider RPC;
- `sdk/telemetry/` — ampliação de cobertura;
- integração completa com observability event bus ainda pendente.

Esses gaps devem ser tratados como **gaps confirmados**, não apenas hipóteses.

## 7.2 Gaps funcionais do SDK 0.3.x ainda sob suspeita

Pela superfície do SDK oficial e pelo que já foi promovido, ainda merecem auditoria específica os
seguintes temas:

### A. `commands`

O SDK tem suporte a slash commands registradas na sessão.

Pergunta da auditoria:

- esse eixo já está plenamente promovido, end-to-end, em `src/copilot`?
- ou temos apenas suporte parcial, sem tratamento simétrico ao de tools/hooks/ui?

### B. `sessionFs` / `createSessionFsHandler`

O SDK oficial expõe configuração de filesystem de sessão.

Pergunta da auditoria:

- isso já tem owner claro em `src/copilot`?
- ou permanece ausente/latente?

### C. `modelCapabilities` e overrides mais ricos

A superfície oficial tem `modelCapabilities`, `defaultAgent`, `customAgents`, `skills` e settings de
sessão mais sofisticados.

Pergunta da auditoria:

- todos esses campos já passam de modo íntegro pela cadeia `config -> sdk -> agent`?
- ou alguns ainda estão implícitos/ignorados?

### D. `onEvent` precoce e session lifecycle precoce

O SDK suporta `onEvent` em config de sessão.

Pergunta da auditoria:

- a necessidade local disso já está plenamente absorvida por `event-handlers/` e wiring atual?
- ou há espaço para reduzir perda de eventos iniciais usando essa capability vanilla de forma mais
  explícita?

### E. provider / BYOK / session-level auth

A superfície de `ProviderConfig` e session-level GitHub token é rica.

Pergunta da auditoria:

- o runtime local trata isso como capability de primeira classe ou apenas como suporte parcial?

### F. sessão filesystem / multitenancy / trace context

Há sinais de suporte oficial relevante para:

- trace propagation;
- session filesystem provider;
- per-session auth.

Esses pontos precisam de auditoria dedicada para verificar se são:

- não usados por opção consciente,
- ou ainda não encontrados / não promovidos.

---

## 8. Riscos estruturais específicos de `sdk/`

## 8.1 Barrel excessivamente largo

O barrel canônico é excelente para governança, mas também pode virar risco se crescer sem curadoria.

### Risco

- exportar demais;
- exportar symbols que pertencem a outros layers;
- mascarar drift arquitetural por conveniência do barrel.

### Situação atual

O sistema já mostrou autocorreção nisso, o que é positivo.

### Regra proposta

Todo novo export do barrel deve responder:

1. isso é capability vanilla do SDK?
2. isso é helper legítimo do wrapper?
3. isso pertence a L1 de fato?

Se a resposta for “não”, o símbolo não deve entrar no barrel.

## 8.2 `sdk/` virar local de policy de produto

Quanto mais o wrapper fica rico, maior o risco de ele começar a carregar policy local demais.

### Regra proposta

`sdk/` pode carregar:

- validação;
- normalização;
- telemetria do wrapper;
- ergonomia do vanilla;
- error taxonomy.

`SDK/` não deveria carregar:

- policy de negócio local;
- projection HTTP/terminal;
- heurísticas de UX de borda;
- decisões de runtime stateful do agent.

## 8.3 Sobreposição com `hooks/`

Se `hooks/` seguir crescendo em composição e presets, é fácil a fronteira com `sdk/` perder nitidez.

### Regra proposta

- `sdk/` expõe os slots/capabilities vanilla;
- `hooks/` compõe policies sobre esses slots;
- nenhum dos dois deve absorver o papel do outro.

---

## 9. Situação ideal TO-BE para `sdk/`

## 9.1 Missão ideal consolidada

`src/copilot/sdk/` deve ser, simultaneamente:

1. **SSOT do vendor SDK**;
2. **wrapper completo** das capabilities vanilla relevantes ao runtime local;
3. **owner da taxonomia de erro vanilla**;
4. **owner da telemetria operacional de L1**;
5. **surface única a partir da qual qualquer capability do SDK sobe para o resto do sistema**.

## 9.2 O que deve nascer em `sdk/` antes de subir

Toda capability vanilla ou análoga do SDK deve passar pela seguinte cadeia:

```text
vendor capability
  -> sdk/
    -> agent/facades ou agent/ports
      -> presentation/
        -> server/terminal
```

## 9.3 O que deve explicitamente ficar fora de `sdk/`

- policy de hooks de produto;
- projection compartilhada de borda;
- state store do runtime;
- payload HTTP;
- lógica de REPL/render/waiting UX;
- audit trail de negócio.

---

## 10. Decisões preliminares desta etapa

1. **`sdk/` já pode ser tratado como um dos módulos mais maduros de `src/copilot`**.
2. **A principal missão da auditoria aqui não é reinventar `sdk/`, e sim proteger suas fronteiras**.
3. **Qualquer capability nova do SDK deve continuar entrando primeiro por L1**.
4. **`hooks/` deve ser auditado à luz de `sdk/`, não como subsistema independente do vanilla**.
5. **A futura auditoria detalhada deve verificar especificamente commands, sessionFs, provider
   depth, multitenancy e trace/sessionFs surfaces do SDK 0.3.x**.
6. **O barrel `#copilot/sdk` deve continuar sendo tratado como instrumento de governança, não apenas
   conveniência de import**.

---

## 11. Conclusão desta etapa

A conclusão principal é positiva:

> `src/copilot/sdk/` já se comporta como uma camada arquitetural de verdade — e, neste momento, é
> provavelmente o subsistema mais claramente dirigido de todo `src/copilot`.

Isso não significa que esteja terminado.

Significa que o tipo de trabalho que resta aqui é mais refinado:

- ampliar cobertura de funcionalidades oficiais ainda não plenamente auditadas;
- expandir observabilidade L1;
- preservar boundary contra regressão;
- manter `agent/`, `hooks/`, `presentation/` e bordas consumindo o vanilla pela rota correta.

O próximo passo natural é auditar o outro polo desse eixo:

- `08-AGENT-RUNTIME-E-FRONTEIRAS.md`

seguido de:

- `09-HOOKS-E-POLICIES.md`
- `10-EVENTS-E-TRADUCAO-DE-SINAIS.md`
