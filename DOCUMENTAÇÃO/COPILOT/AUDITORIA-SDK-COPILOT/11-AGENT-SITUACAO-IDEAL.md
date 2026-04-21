# 11 — Agent Module: Nova Situação Ideal Proposta

**Data de atualização**: 2026-04-21  
**Escopo primário**: `src/copilot/agent/`  
**Escopo contextual**: posicionamento ideal do `agent/` dentro da arquitetura total de `src/copilot/`  
**Status**: proposta arquitetural reescrita, detalhada e alinhada ao código vivo  
**Referências**:

- [09-AGENT-LOGICA-FLUXO.md](./09-AGENT-LOGICA-FLUXO.md)
- [10-AGENT-SITUACAO-ATUAL.md](./10-AGENT-SITUACAO-ATUAL.md)
- [../AUDITORIA-PROFUNDA-ABRIL-2026/14-FLUXO-AGENT-TERMINAL-SDK.md](../AUDITORIA-PROFUNDA-ABRIL-2026/14-FLUXO-AGENT-TERMINAL-SDK.md)
- [../AUDITORIA-PROFUNDA-ABRIL-2026/15-ARQUITETURA-PADRONIZADA-E-CENTRALIZADA.md](../AUDITORIA-PROFUNDA-ABRIL-2026/15-ARQUITETURA-PADRONIZADA-E-CENTRALIZADA.md)

> **Leitura correta deste documento**: ele descreve o estado-alvo rigoroso do `agent/` e da sua relação com o restante de `src/copilot/`. Não é um convite a recomeçar do zero. É um plano de consolidação de uma arquitetura que já evoluiu bastante e agora precisa fechar fronteiras, contratos e governança interna.

---

## 1. Tese central

A situação ideal **não é reescrever o `agent/`**.

A situação ideal é esta:

> **transformar o que já é uma boa arquitetura modular em uma arquitetura modular rigidamente governada, semanticamente explícita, testável, observável e preparada para evolução de multi-runtime/multi-session sem regressão.**

A estratégia correta, portanto, não é “explodir a árvore de módulos de novo”.

A estratégia correta é:

1. concluir o hardening final do `AgentContext`;
2. fechar contratos de capability e remover compatibilidades residuais desnecessárias;
3. tornar a error policy realmente padrão operacional de todo o núcleo;
4. consolidar o singleton lazy como caminho governado, com proxy residual apenas onde for legítimo;
5. aprofundar observabilidade, health e cobertura estrutural;
6. preparar multi-runtime e multi-session em cima da arquitetura atual, e não contra ela.

---

## 2. O que a situação ideal não é

Para evitar regressão conceitual, convém registrar explicitamente o que **não** faz sentido repropor.

## 2.1 Não é voltar para um grande refactor estrutural

Já existe decomposição real em:

- `lifecycle/`
- `dialog/`
- `session/`
- `messaging/`
- `state/`
- `infra/`
- `facades/`

A situação ideal não é redesenhar essa decomposição do zero.

## 2.2 Não é rebaixar `presentation/` de novo

`presentation/` já se mostrou a camada correta para:

- seleção compartilhada de runtime;
- projections comuns;
- deps de router;
- payloads compartilhados;
- targeting e fallback explícitos.

Voltar a espalhar isso entre `server/` e `terminal/` seria regressão.

## 2.3 Não é manter shims/compatibilidade por inércia

Shims e proxies só fazem sentido quando houver uma destas razões:

- boundary de boot lazy legítima;
- rollout controlado de migração;
- suporte temporário a call sites ainda não drenados.

O ideal de longo prazo é:

> **compatibilidade residual explicitamente documentada, pequena e isolada — não espalhada.**

## 2.4 Não é transformar `agent/` em camada de borda

`agent/` não deve virar:

- router HTTP;
- payload factory de SSE;
- camada de parsing de request;
- UI engine do terminal.

Essas responsabilidades devem permanecer fora dele.

---

## 3. Arquitetura-alvo de `src/copilot/`

A situação ideal do `agent` só faz sentido se ele for entendido dentro da arquitetura maior.

```text
sdk/
    -> event-handlers/
        -> agent/
            -> presentation/
                -> server/ e terminal/
```

## 3.1 Papel ideal de cada camada

### `sdk/`

**Deve ser dono de:**

- contratos vanilla do SDK;
- sessions, agents, RPC, mode/plan, foreground/last session;
- helpers que preservam a semântica original do `@github/copilot-sdk`.

**Não deve ser dono de:**

- payloads HTTP/REPL;
- estado contínuo do runtime local;
- narrativa operacional de UX.

### `event-handlers/`

**Deve ser dono de:**

- tradução de `SessionEvent` cru para sinais internos estáveis.

**Não deve ser dono de:**

- health do runtime;
- payload de borda;
- estado mutável do agent;
- regras de UI.

### `agent/`

**Deve ser dono de:**

- lifecycle;
- reconnect;
- dialog loop;
- queue;
- `ask_user`;
- ownership e rotation;
- source-of-truth do health;
- source-of-truth do estado do runtime;
- facades públicas do runtime e da superfície útil do SDK.

**Não deve ser dono de:**

- parsing de request HTTP;
- payloads compartilhados de borda;
- render/prompt final do operador.

### `presentation/`

**Deve ser dono de:**

- seleção compartilhada de runtime;
- targeting e fallback explícitos;
- projections compartilhadas;
- deps de router e handlers compartilhados de borda;
- payloads e shapes reutilizados por `server/` e `terminal/`.

**Não deve ser dono de:**

- source-of-truth do runtime;
- governança do `AgentContext`;
- interpretação de `SessionEvent` cru;
- lógica exclusivamente local de UX.

### `terminal/`

**Deve ser dono de:**

- REPL;
- comandos;
- render;
- prompt;
- narrativa operacional local;
- waiting UX.

**Não deve ser dono de:**

- governança de runtime compartilhado;
- contracts vanilla do SDK;
- parsing compartilhado que já tenha façade em `presentation/`.

### `server/`

**Deve ser dono de:**

- transporte HTTP;
- middleware;
- wiring de rotas;
- serialização web final.

**Não deve ser dono de:**

- source-of-truth do runtime;
- composição manual repetitiva do runtime default;
- lógica compartilhada que já possa subir para `presentation/`.

### `observability/`

**Deve ser dono de:**

- logs;
- métricas;
- tracing;
- timelines;
- stores e observers.

**Não deve ser dono de:**

- semântica do SDK;
- seleção de runtime;
- payloads canônicos de borda.

---

## 4. Arquitetura-alvo interna do `agent/`

```text
┌────────────────────────────────────────────────────────────┐
│                    AlwaysAliveAgent                         │
│  - API pública                                              │
│  - zero lógica de negócio densa                             │
│  - delegação para lifecycle/dialog/messaging/state          │
└───────────────┬────────────────────────────────────────────┘
                │
        ┌───────▼────────────────────────────────────────┐
        │ AgentContext (composição + mutation/read API)  │
        │                                                │
        │ sessionState   -> owner: session/lifecycle     │
        │ dialogState    -> owner: dialog                │
        │ configState    -> owner: facades/config        │
        │ metricsState   -> owner: state/observability   │
        │ runtimeState   -> owner: lifecycle             │
        │ ioState        -> owner: lifecycle/session     │
        │ backgroundTasks -> cross-cutting, read-only    │
        └───────┬────────────────────────────────────────┘
                │
   ┌────────────┼────────────┬────────────┬────────────┬────────────┐
   ▼            ▼            ▼            ▼            ▼            ▼
 lifecycle/   dialog/     session/    messaging/     state/      infra/
```

## 4.1 Papel ideal do `AlwaysAliveAgent`

Na situação ideal, `AlwaysAliveAgent` deve ser:

- fachada previsível;
- API pública e ponto de integração externo;
- emissor de eventos;
- delegado fino para submódulos.

Ele **não** deve voltar a concentrar lógica densa de lifecycle, boot, dialog ou SDK.

## 4.2 Papel ideal do `AgentContext`

Na situação ideal, o `AgentContext` deve ser:

- composição de subestados com ownership explícito;
- superfície semântica de mutation;
- superfície semântica de leitura para hot path;
- ponto de compatibilidade controlada, e não bolsa de mutação livre.

Ele **não** deve ser usado como:

- objeto público de shape cru para qualquer módulo tocar qualquer campo;
- fallback permanente para ausência de contracts;
- substituto de facades ou capabilities mais precisas.

---

## 5. Programas de consolidação arquitetural

Para ficar rigoroso, o ideal precisa ser organizado por programas claros.

## L1 — Hardening final do `AgentContext`

### Situação ideal

- mutation API domina os writes quentes;
- read API domina os reads quentes;
- ownership por subestado é explícito;
- raw access a `ctx.*State` vira exceção de compatibilidade documentada.

### O que já foi entregue

- mutation API relevante;
- snapshots semânticos de pending question, boot report, unsubscribers, etc.;
- redução importante de aliases em `session-setup.js`, `agent-lifecycle.js` e `health-check.js`.

### O que ainda falta

- snapshots/reads semânticos para os poucos campos residuais ainda lidos via fallback estrutural;
- reduzir a quase zero os raw reads remanescentes;
- formalizar melhor quem pode escrever em qual subestado;
- ampliar cobertura de regressão para evitar recaída.

### Critério de done

- o hot path de `messaging`, `dialog`, `lifecycle`, `session wiring`, `health` e `facades` já não depende do shape cru como caminho normal.

## L2 — Contratos de host e capability boundaries

### Situação ideal

- contracts explícitos por capability;
- guards runtime leves e concentrados;
- zero casts residuais no hot path;
- compatibilidade futura isolada em adapters pequenos.

### O que ainda falta

- reduzir ainda mais contracts estruturais difusos;
- formalizar melhor boundaries de capability em algumas fronteiras restantes do runtime.

### Critério de done

- casts de conveniência deixam de existir no hot path;
- compat shims ficam concentrados e raros.

## L3 — Error Policy como padrão total

### Situação ideal

Todo fluxo crítico do runtime deve passar por política comum para:

- normalização;
- classificação;
- retry/ignore/fatal;
- contexto estruturado;
- telemetria consistente.

### O que ainda falta

- boot interno residual;
- cleanup/rotation residuais;
- caminhos assíncronos que ainda operam com tratamento local demais.

### Critério de done

- `withAgentErrorPolicy(...)` e seus wrappers correlatos dominam os fluxos centrais do runtime, sem heurística local duplicada no miolo.

## L4 — Lazy singleton plenamente governado

### Situação ideal

- `getAgent()` é o caminho normal;
- o proxy compatível sobrevive apenas em boundaries explicitamente justificadas;
- não nascem novos consumidores operacionais sobre `alwaysAliveAgent`.

### O que ainda falta

- revisão fina dos poucos call sites remanescentes;
- documentação explícita das exceções legítimas.

### Critério de done

- qualquer uso residual do proxy é deliberado, pequeno e documentado.

## L5 — Boot pipeline acionável

### Situação ideal

Cada step de boot precisa carregar:

- nome canônico;
- fase;
- duração;
- outcome (`ok`, `skipped`, `degraded`, `failed`);
- impacto visível em health e observability.

### O que ainda falta

- enriquecer ainda mais a projeção desse relatório para troubleshooting direto;
- reduzir largura do `BootWiringContext`.

## L6 — Health realmente acionável

### Situação ideal

O health deve explicar, em um único snapshot:

- estado do runtime;
- estado do SDK acoplado;
- estado do boot;
- backlog real;
- drift semântico;
- ação recomendada;
- risco atual para o operador.

### O que ainda falta

- timings mais ricos por step;
- ownership/session rotation mais explícito;
- risk flags adicionais de drift operacional.

## L7 — Malha de testes de consolidação

### Situação ideal

O `agent` só é considerado consolidado quando tiver cobertura estrutural mínima forte em:

- session setup;
- boot;
- reconnect;
- lazy singleton / DI;
- SDK access;
- health routes;
- `AgentContext` semântico;
- runtime registry / shared runtime accessors.

### O que ainda falta

- mais profundidade em boot steps isolados;
- reconnect policy;
- ownership/rotation;
- import-time / lazy behavior;
- contratos de host e capabilities.

## L8 — Multi-session real

### Situação ideal

- múltiplas sessões/runtimes ativos ao mesmo tempo;
- isolamento real entre runtime instances;
- seleção explícita consistente entre bordas;
- scheduling/control real entre sessões.

### Estado atual correto

Hoje existe **multi-runtime path-enabled**, não multi-session real.

### O que ainda falta

- governança de scheduling;
- isolamento operacional de múltiplas sessões ativas;
- contracts explícitos de multi-runtime lifecycle.

## L9 — Superfície SDK consolidada e auditável

### Situação ideal

- qualquer capacidade útil do SDK pode ser acessada de forma canônica;
- o runtime pode inspecionar a cobertura real do SDK acoplado;
- novas capabilities do SDK podem ser expostas sem reinventar surface paralela.

### O que ainda falta

- manter a superfície estável e coerente diante da evolução do SDK;
- blindar a cobertura com testes e contracts adicionais.

## L10 — Governança semântica total de `ask_user`

### Situação ideal

`ask_user` deve operar como protocolo governado de runtime, com:

- persistência seletiva por tipo;
- diferenciação total entre pergunta viva e shadow;
- TTL/expiração;
- health/UX/snapshots coerentes;
- recovery previsível.

### O que ainda falta

- heurísticas mais refinadas por idade e contexto operacional;
- UX ainda melhor para estados intermediários da shadow.

## L11 — Arquitetura padronizada entre SDK, agent e bordas

### Situação ideal

A política geral deve ser esta:

- `sdk/` define capability vanilla;
- `event-handlers/` traduz evento cru;
- `agent/` governa runtime contínuo;
- `presentation/` governa acesso compartilhado de borda;
- `terminal/` e `server/` consomem sem reabrir a topologia interna.

### O que já foi entregue

- registry explícita de runtime;
- accessor compartilhado de runtime;
- targeting compartilhado de `runtimeId`;
- runtime-aware HTTP e REPL em pontos relevantes;
- transparência explícita de fallback.

### O que ainda falta

- expandir de forma disciplinada a mesma política para superfícies secundárias;
- decidir formalmente onde caminhos `default-only` continuam legítimos;
- impedir qualquer regressão para parsing manual ou bypass distribuído.

---

## 6. Política ideal para shims, compatibilidade e legado

Uma fonte grande de confusão nos ciclos anteriores foi tratar “compatibilidade” como se fosse sempre aceitável. O ideal precisa ser mais rigoroso.

## 6.1 Compatibilidade aceitável

Compatibilidade residual só é aceitável quando:

1. evita materialização prematura do runtime;
2. protege uma fronteira de rollout ainda em migração;
3. encapsula call sites antigos que ainda não foram drenados;
4. está explicitamente documentada como temporária ou deliberada.

## 6.2 Compatibilidade inaceitável

Compatibilidade é regressão quando:

- reabre raw access a `ctx.*State` como padrão;
- recoloca lógica de runtime em `server/` ou `terminal/`;
- espalha parsing de `runtimeId` fora das helpers canônicas;
- duplica semantics do SDK ou de `ask_user`;
- mantém proxy/shim apenas por conveniência e sem boundary justificada.

## 6.3 Regra ideal de remoção de shims

Todo shim/compat layer deve ter um destes destinos:

- **consolidar como boundary deliberada**;
- **encolher até ficar residual**;
- **ser removido**.

Ele não deve ficar indefinidamente como “lugar de passagem” sem dono.

---

## 7. Critérios de consolidação arquitetural

O `agent` só deve ser considerado **arquiteturalmente consolidado** quando o conjunto abaixo for verdadeiro ao mesmo tempo.

## CA-1 — Hot path sem casts residuais

Critério verificável:

- `rg -n "@type \{unknown\}|/\*\* @type \{unknown\} \*/" src/copilot/agent --glob '*.js'` retorna `0` matches.

## CA-2 — Boundary de hooks alinhado ao SDK

Critério verificável:

- `sdk/types.js` e `hooks/types.js` refletem o shape real do SDK atual;
- `buildSessionOptions()` registra `hooks` via `SessionConfigBuilder.hooks(...)` sem compat cast artificial.

## CA-3 — Mutation/read API domina o hot path

Critério verificável:

- writes quentes não dependem de `ctx.*State` cru como caminho normal;
- reads quentes também não dependem do shape cru como caminho normal;
- fallbacks estruturais residuais são raros, justificados e testáveis.

## CA-4 — Error policy vira padrão operacional

Critério verificável:

- wrapper e persistência canônica dominam os fluxos centrais;
- não há `try/catch + classify + retry` duplicado espalhado pelo núcleo.

## CA-5 — Lazy singleton totalmente governado

Critério verificável:

- consumidores operacionais usam `getAgent()`;
- `alwaysAliveAgent` permanece apenas em boundaries compatíveis explicitamente documentadas.

## CA-6 — Superfície SDK consolidada e auditável

Critério verificável:

- `AlwaysAliveAgent` expõe `getSdkHandles()` e `getSdkResourceSnapshot()`;
- runtime saudável reporta cobertura plena dos recursos centrais e runtime do SDK.

## CA-7 — Health acionável de verdade

Critério verificável:

- snapshot explica runtime, boot, backlog, drift, `ask_user`, `sdkResources`, `riskFlags` e `recommendedAction` com granularidade suficiente para troubleshooting direto.

## CA-8 — Arquitetura de borda disciplinada

Critério verificável:

- `presentation/` é o hub real de acesso compartilhado das bordas;
- `server/` e `terminal/` não voltam a montar snapshots ou targeting manualmente;
- parsing e fallback de `runtimeId` não se espalham.

## CA-9 — Compatibilidade residual pequena e deliberada

Critério verificável:

- proxies, shims e compat layers restantes são poucos, justificados e nomeados;
- não existe compatibilidade difusa e invisível no hot path.

## CA-10 — Multi-runtime pronto para evolução real

Critério verificável:

- runtime registry, targeting compartilhado, fallback explícito e projections comuns já não dependem do singleton implícito como única política possível.

## CA-11 — Testes de regressão estrutural mínimos

Critério verificável:

- a malha cobre pelo menos `session-setup`, `agent-sdk-access`, `sdk/session/client`, `boot/reconnect`, `health routes`, lazy singleton/DI, runtime registry e accessors compartilhados.

## CA-12 — Documentação viva alinhada ao código

Critério verificável:

- a documentação do `agent` deixa claro:
  - o que já foi entregue;
  - o que ainda falta;
  - o papel de `agent/` vs `presentation/` vs `sdk/` vs `event-handlers/`;
  - o plano futuro sem confundir backlog com dívida já quitada.

---

## 8. Roadmap rigoroso de futuro

A situação ideal precisa virar programa executável, não só descrição estática.

## Programa A — Fechamento do `AgentContext`

### Objetivo

- dominar completamente o hot path via mutation/read API semântica.

### Entregas esperadas

- novos snapshots/helpers onde ainda houver raw reads residuais;
- ownership explícito por subestado;
- redução máxima de fallbacks estruturais.

## Programa B — Error policy total

### Objetivo

- convergir todo o núcleo para wrapper/persistência/contexto estruturado.

### Entregas esperadas

- boot interno;
- cleanup/rotation;
- hooks internos residuais;
- redução forte de heurística local.

## Programa C — Health/boot/troubleshooting

### Objetivo

- tornar o runtime auditável e acionável de ponta a ponta.

### Entregas esperadas

- mais granularidade de boot;
- mais sinais de drift;
- trilha operacional mais rica para o operador.

## Programa D — Lazy singleton e compatibilidade residual

### Objetivo

- reduzir compatibilidade residual ao mínimo necessário.

### Entregas esperadas

- revisão de call sites;
- racionalização de shims;
- documentação explícita das exceções legítimas.

## Programa E — Multi-runtime / multi-session

### Objetivo

- sair de `path-enabled` para governança real de múltiplos runtimes.

### Entregas esperadas

- contracts de runtime selection;
- isolamento entre runtimes;
- multi-session scheduling.

## Programa F — Cobertura estrutural e contracts

### Objetivo

- impedir regressão arquitetural silenciosa.

### Entregas esperadas

- suites adicionais em boot/reconnect/lazy singleton/ownership;
- contracts de fronteira para runtime/bordas;
- reforço de indicadores verificáveis do estado arquitetural.

---

## 9. Conclusão

A situação ideal do `agent` hoje não é “quebrar tudo de novo”.

A situação ideal é:

> **concluir, com rigor, a transição de uma arquitetura já modular para uma arquitetura plenamente consolidada: fronteiras duras, estado governado semanticamente, policy de erro unificada, runtime access disciplinado, health acionável e base pronta para multi-runtime/multi-session real.**

Em resumo:

- a era do grande refactor estrutural já passou;
- a era correta agora é a do **hardening arquitetural profundo e disciplinado**.
