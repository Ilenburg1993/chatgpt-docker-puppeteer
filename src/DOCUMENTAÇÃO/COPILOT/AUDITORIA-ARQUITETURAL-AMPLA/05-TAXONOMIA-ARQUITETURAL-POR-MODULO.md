# 05 — Taxonomia Arquitetural por Módulo de `src/copilot`

**Status**: auditoria ativa **Última atualização**: 2026-04-27 **Escopo desta etapa**: classificar
cada módulo de primeiro nível de `src/copilot/` por missão atual, fronteira ideal, owners prováveis,
antiobjetivos e pontos de confusão.

---

## 1. Objetivo deste documento

Este documento inaugura a auditoria propriamente dita.

Se a pré-auditoria respondeu **"o que existe e o que precisa ser investigado?"**, este documento
começa a responder:

1. **qual é a natureza arquitetural de cada módulo**;
2. **que tipo de responsabilidade ele exerce hoje**;
3. **qual deveria ser sua missão ideal**;
4. **quais módulos parecem owner real, owner parcial ou owner acidental**;
5. **quais limites devem ser reforçados, fundidos, reduzidos ou rebaixados**.

Em outras palavras: a taxonomia abaixo não é apenas descritiva. Ela é uma primeira proposta de
**classificação operacional** de `src/copilot/`.

---

## 2. Premissas de classificação

A classificação desta auditoria segue cinco eixos:

### 2.1 Tipo de módulo

Cada pasta de primeiro nível será classificada como predominante em uma destas categorias:

- **foundation** — primitives, contratos base, infraestrutura essencial, boot e base técnica;
- **vanilla boundary** — camada que fala com sistema externo canônico e preserva sua semântica;
- **runtime domain** — owner de comportamento vivo, lifecycle, estado e invariantes de domínio;
- **edge projection** — camada que prepara consumo por bordas externas sem virar source-of-truth;
- **edge adapter** — borda externa, protocolo, UX ou integração com operador;
- **cross-cutting** — coleta, auditoria, tracing, políticas ou concerns transversais;
- **artifact/runtime residue** — estado, snapshots, logs ou material que não deveria competir com
  módulos de código como owner funcional.

### 2.2 Tipo de owner

- **owner canônico** — deveria ser o lugar primário de uma responsabilidade;
- **owner secundário legítimo** — participa da responsabilidade, mas não define a semântica raiz;
- **consumer** — apenas consome uma semântica definida em outro lugar;
- **owner acidental** — carrega semântica relevante hoje por conveniência, drift ou legado.

### 2.3 Função declarada vs função real

A auditoria distingue:

- **função declarada** — o que READMEs, nomes e guardrails dizem;
- **função real observada** — o que o módulo parece fazer no código e na topologia atual.

### 2.4 Risco arquitetural

Cada módulo recebe um risco primário:

- **baixo** — missão razoavelmente clara;
- **médio** — fronteira clara, mas com overlap relevante;
- **alto** — owner ambíguo, semântica duplicada ou posição estrutural questionável.

### 2.5 Direção TO-BE

Para cada módulo, a auditoria registra uma direção predominante:

- **endurecer** — preservar e fortalecer;
- **convergir** — reduzir seams e tornar owner mais claro;
- **rebaixar** — tirar protagonismo arquitetural indevido;
- **dividir** — desmembrar papéis hoje colapsados;
- **absorver** — mover para um owner mais adequado;
- **realocar** — sair da árvore de código-dominio.

---

## 3. Taxonomia-mestra por módulo

## 3.1 Núcleo canônico do runtime

| Módulo            | Tipo                          | Owner atual            | Missão atual observada                                                      | Missão ideal proposta                                                                   | Risco       | Direção               |
| ----------------- | ----------------------------- | ---------------------- | --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | ----------- | --------------------- |
| `sdk/`            | vanilla boundary              | owner canônico         | wrapper do `@github/copilot-sdk`, tipos, lifecycle, RPC, surface vanilla    | permanecer como **única** fronteira com o vendor SDK, SSOT de capacidades vanilla       | baixo       | endurecer             |
| `agent/`          | runtime domain                | owner canônico         | runtime contínuo, session lifecycle, dialog loop, health, registry, façades | permanecer owner do runtime vivo, reduzindo mutação crua e consolidando API semântica   | médio       | endurecer + convergir |
| `event-handlers/` | vanilla boundary / translator | owner canônico parcial | traduz `SessionEvent` do SDK para sinais internos                           | permanecer como boundary exclusiva de tradução do SDK para sinais internos              | médio       | endurecer             |
| `events/`         | foundation / event grammar    | owner parcial          | catálogo de eventos, nomes, schemas e sinalização interna                   | consolidar gramática do sistema sem sobrepor `event-handlers/`                          | médio       | convergir             |
| `presentation/`   | edge projection               | owner canônico         | projeções/handlers compartilhados entre terminal e server                   | virar camada única de projeção compartilhada das bordas                                 | médio       | endurecer + expandir  |
| `server/`         | edge adapter                  | owner canônico         | HTTP/SSE/Socket do runtime                                                  | continuar como borda externa, cada vez menos conhecendo topologia interna               | baixo-médio | convergir             |
| `terminal/`       | edge adapter                  | owner canônico         | UX humana local, REPL, render, comandos, SSE local                          | continuar como borda humana, consumindo `presentation/` e `sdk/` sem semântica paralela | médio       | convergir             |

### Leitura desta célula central

Esses seis módulos formam a espinha dorsal do runtime Copilot:

```text
sdk -> event-handlers -> agent -> presentation -> server/terminal
```

A situação atual já aponta nessa direção, mas com três tensões importantes:

1. `agent/` ainda concentra muita superfície e parte dela poderia ser mais rigidamente exposta por
   façades;
2. `presentation/` cresceu corretamente, mas precisa monopolizar melhor payloads compartilhados;
3. `events/` e `event-handlers/` ainda precisam ficar semanticamente mais inconfundíveis.

---

## 3.2 Camada de policy, tools e integração transversal

| Módulo     | Tipo                                | Owner atual            | Missão atual observada                                                                       | Missão ideal proposta                                                                         | Risco | Direção               |
| ---------- | ----------------------------------- | ---------------------- | -------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | ----- | --------------------- |
| `hooks/`   | cross-cutting / policy              | owner parcial          | policies e callbacks do SDK: permission, prompt, session hooks, elicitation provider helpers | tornar-se owner inequívoco de **policies e callbacks do SDK**, não de runtime nem de tradução | alto  | endurecer + podar     |
| `tools/`   | runtime domain auxiliar             | owner canônico parcial | implementação e registro de custom tools do agente                                           | separar claramente tool implementation de registry/state vanilla do SDK e de policy de hooks  | médio | convergir             |
| `bridges/` | cross-cutting / adapter             | owner parcial          | integração com NERV, MCP, Git, GitHub e externos                                             | permanecer como adapters externos, sem virar orquestrador paralelo do runtime                 | médio | endurecer             |
| `infra/`   | foundation / technical substrate    | owner parcial          | SSE, queues, registries e utilidades técnicas de infra                                       | ficar estritamente técnico, sem absorver responsabilidade de domínio                          | alto  | dividir / convergir   |
| `channel/` | runtime domain auxiliar / transport | owner ambíguo          | transporte e inject entre clientes/agente                                                    | clarificar se é transporte do runtime, adapter de injeção ou bridge de borda                  | alto  | convergir             |
| `plugins/` | cross-cutting / extension surface   | owner indefinido       | registry/tokens de plugins                                                                   | definir se é extensão real de produto ou compat shim de baixa centralidade                    | alto  | clarificar / rebaixar |

### Leitura do grupo

Este grupo concentra boa parte da confusão arquitetural típica de sistemas em crescimento:

- concerns transversais;
- adapters externos;
- extensões;
- infraestrutura técnica;
- helpers que acabam acumulando semântica de domínio.

A pasta **mais crítica aqui é `hooks/`**. O README dela é forte e organizado, mas a auditoria ampla
precisa provar se `hooks/` continua estritamente dentro do papel de:

- callback/policy do SDK,
- ou se já absorveu pedaços de integração, fluxo e runtime que deveriam ficar em `agent/`,
  `event-handlers/` ou `presentation/`.

`infra/` e `channel/` também merecem atenção máxima porque frequentemente esse tipo de módulo vira
"zona cinzenta" entre técnica pura e domínio operacional.

---

## 3.3 Persistência, memória e multi-sessão

| Módulo              | Tipo                     | Owner atual             | Missão atual observada                                                | Missão ideal proposta                                                               | Risco | Direção   |
| ------------------- | ------------------------ | ----------------------- | --------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | ----- | --------- |
| `conversation-hub/` | runtime domain           | owner parcial relevante | store persistente, multi-sessão, orquestração e realtime de conversas | clarificar fronteira com `agent/` sobre ownership de sessão, replay, memory e turns | alto  | convergir |
| `db/`               | foundation               | owner subordinado       | SQLite SSOT e migrations locais ao copilot                            | permanecer pequeno e subordinado ao domínio que o consome                           | baixo | endurecer |
| `logs/`             | artifact/runtime residue | não deveria ser owner   | artefatos e logs dentro da árvore de código                           | sair da competição arquitetural com código de domínio                               | alto  | realocar  |
| `.github/`          | artifact/runtime residue | não deveria ser owner   | snapshots/estado internos ao runtime                                  | reavaliar pertencimento; forte candidato a sair da árvore de código                 | alto  | realocar  |

### Leitura do grupo

O problema aqui não é apenas persistência. É **ownership de sessão e memória**.

Hoje existem ao menos três polos relacionados à sessão:

- `sdk/` — sessão vanilla e suas capabilities;
- `agent/` — runtime vivo dessa sessão;
- `conversation-hub/` — store/orquestração multi-sessão e persistência.

A auditoria ampla deverá provar com precisão:

1. quem é dono da sessão ativa;
2. quem é dono da sessão persistida;
3. quem é dono do replay, turn history, memory e ownership cross-surface.

---

## 3.4 Configuração, base e contratos centrais

| Módulo    | Tipo                              | Owner atual            | Missão atual observada                                            | Missão ideal proposta                                                           | Risco | Direção               |
| --------- | --------------------------------- | ---------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------- | ----- | --------------------- |
| `boot/`   | foundation / composition contract | owner canônico parcial | contrato/config/plano de boot, workspace, skills, env operacional | consolidar-se como contrato exclusivo do processo de inicialização              | médio | endurecer             |
| `config/` | foundation / declarative config   | owner canônico parcial | env, builders, prompt, custom agents, session config              | permanecer declarativo e port-driven, sem lógica operacional de runtime         | médio | endurecer             |
| `core/`   | foundation                        | owner canônico         | DI, erros, shutdown, timers, shared state, primitives             | permanecer base estável e de baixo nível                                        | baixo | endurecer             |
| `types/`  | foundation                        | owner parcial          | typedef surface do subsistema copilot                             | definir se é barrel/contrato puro ou se deve absorver contratos hoje espalhados | médio | convergir             |
| `dialog/` | domain residue / proto-domain     | owner indefinido       | protocolo/índice mínimos                                          | decidir se é domínio real ou resíduo de desmembramento incompleto               | alto  | clarificar / absorver |

### Leitura do grupo

`boot/`, `config/` e `core/` são estruturalmente importantes e relativamente saudáveis, mas por
motivos diferentes:

- `core/` tende a estar arquiteturalmente certo quando fica pequeno e duro;
- `config/` tende a sofrer quando começa a puxar comportamento;
- `boot/` tende a sofrer quando runtime e bootstrap se misturam demais.

`dialog/` de topo é o módulo mais suspeito deste grupo: pequeno demais para parecer domínio robusto,
mas grande o suficiente para levantar a hipótese de resíduo arquitetural.

---

## 3.5 Cross-cutting de observação e governança

| Módulo           | Tipo          | Owner atual    | Missão atual observada                                              | Missão ideal proposta                                                              | Risco | Direção   |
| ---------------- | ------------- | -------------- | ------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | ----- | --------- |
| `observability/` | cross-cutting | owner canônico | coleta de logs, métricas, tracing, timelines, snapshots observáveis | permanecer estritamente consumer/correlator, sem reinterpretar runtime ou SDK      | médio | endurecer |
| `audit/`         | cross-cutting | owner parcial  | pipeline, writer, ring buffer, audit trail, permissões              | clarificar separação entre telemetria operacional e trilha de auditoria/governança | alto  | convergir |

### Leitura do grupo

Este é um eixo clássico de sistemas complexos: quando observabilidade e auditoria crescem juntas,
fica fácil sobrepor:

- logging;
- métricas;
- tracing;
- timeline;
- audit trail;
- persistência de evidência;
- interpretação semântica do evento.

A situação ideal aqui não é “unificar tudo”.

A situação ideal é:

- `observability/` medir e correlacionar;
- `audit/` preservar e governar evidências/decisões;
- ambos consumirem sinais estáveis definidos noutros lugares.

---

## 4. Mapa de owners canônicos propostos

## 4.1 Owners canônicos que já parecem corretos

| Domínio                           | Owner canônico proposto |
| --------------------------------- | ----------------------- |
| capacidade vanilla do SDK         | `sdk/`                  |
| tradução do vanilla SDK           | `event-handlers/`       |
| runtime contínuo do agente        | `agent/`                |
| projeções compartilhadas de borda | `presentation/`         |
| borda HTTP/SSE/Socket             | `server/`               |
| borda humana/REPL                 | `terminal/`             |
| base técnica comum                | `core/`                 |
| configuração declarativa          | `config/`               |

## 4.2 Owners que ainda precisam ser provados ou refinados

| Domínio                                   | Owner hoje          | Diagnóstico preliminar                                               |
| ----------------------------------------- | ------------------- | -------------------------------------------------------------------- |
| policies e callbacks do SDK               | `hooks/`            | parece correto, mas precisa ser podado contra integrações indevidas  |
| memória/replay/store multi-sessão         | `conversation-hub/` | owner relevante, mas fronteira com `agent/` precisa ficar mais exata |
| audit trail do copilot                    | `audit/`            | owner provável, mas overlap com `observability/` é plausível         |
| transporte/injeção entre clientes e agent | `channel/`          | owner ainda ambíguo                                                  |
| extensibilidade/plugin surface            | `plugins/`          | owner ainda subdefinido                                              |
| domínio `dialog` transversal              | `dialog/`           | owner possivelmente acidental ou incompleto                          |

---

## 5. Principais tensões arquiteturais por módulo

## 5.1 `sdk/` vs `agent/`

### Situação atual

- `sdk/` é a base vanilla correta e vem sendo endurecido;
- `agent/` já consome muitas capabilities pela rota certa (`facades`, `ports`, barrel);
- ainda assim, `agent/` continua extremamente volumoso e parcialmente responsável por semântica que
  pode estar em transição entre runtime puro e façade pública.

### Diagnóstico

A fronteira está **muito melhor do que em ondas anteriores**, mas ainda não totalmente esgotada.

### Situação ideal

- `sdk/` define a capability vanilla e sua semântica de erro/telemetria;
- `agent/` define apenas o que é runtime contínuo, stateful e policy operacional local.

## 5.2 `hooks/` vs `event-handlers/` vs `events/`

### Situação atual

A teoria está boa:

- `hooks/` = callbacks/policies do SDK;
- `event-handlers/` = tradução do SDK;
- `events/` = gramática do sistema.

### Diagnóstico

Essa tripartição é **conceitualmente elegante**, mas também é um ponto de alto risco de drift,
porque os três módulos tangenciam:

- eventos;
- callbacks;
- nomenclaturas;
- side-effects;
- observabilidade.

### Situação ideal

- `hooks/` não traduz eventos e não guarda estado de runtime;
- `event-handlers/` não define policies;
- `events/` não vira executor de tradução.

## 5.3 `agent/` vs `presentation/`

### Situação atual

`presentation/` já ganhou corpo real e parece cumprir a direção correta.

### Diagnóstico

Ainda assim, é típico que parte da semântica de borda sobreviva no `agent/` por conveniência.

### Situação ideal

- `agent/` guarda truth e invariantes;
- `presentation/` projeta e compartilha;
- `server/` e `terminal/` consomem.

## 5.4 `observability/` vs `audit/`

### Situação atual

As duas pastas têm papéis potencialmente próximos.

### Situação ideal

- `observability/` = telemetria operacional;
- `audit/` = trilha de governança e evidência;
- nenhuma das duas redefine o significado do runtime ou do SDK.

---

## 6. Antiobjetivos arquiteturais por módulo

## 6.1 Antiobjetivos globais

Nenhum módulo deveria:

1. redefinir semântica vanilla do SDK fora de `sdk/`;
2. reabrir topologia interna do runtime em cada borda;
3. traduzir o mesmo evento de formas concorrentes;
4. manter estado runtime em módulo cujo papel deveria ser apenas projection ou adapter;
5. competir com artefatos (`logs`, `.github`) por protagonismo arquitetural.

## 6.2 Antiobjetivos específicos

| Módulo               | Antiobjetivo principal                                                  |
| -------------------- | ----------------------------------------------------------------------- |
| `sdk/`               | virar camada de UX, HTTP payload ou projection de borda                 |
| `agent/`             | virar façade gigante sem delimitação entre runtime, projection e compat |
| `hooks/`             | virar runtime secundário ou tradutor de eventos                         |
| `event-handlers/`    | virar state store ou HTTP mapper                                        |
| `events/`            | virar executor/transdutor em vez de gramática                           |
| `presentation/`      | virar source-of-truth do runtime                                        |
| `server/`            | conhecer a topologia do runtime tão bem quanto o `agent/`               |
| `terminal/`          | recriar semântica do SDK ou do agent localmente                         |
| `tools/`             | absorver policy de permissão/interceptação que pertence a hooks         |
| `bridges/`           | orquestrar runtime fora de contratos explícitos                         |
| `infra/`             | misturar substrate técnico com domínio operacional                      |
| `channel/`           | permanecer semanticamente ambíguo                                       |
| `conversation-hub/`  | competir com `agent/` pela ownership da sessão ativa                    |
| `observability/`     | reinterpretar SDK ou runtime em paralelo aos owners reais               |
| `audit/`             | virar sinônimo de logging genérico                                      |
| `logs/` / `.github/` | serem tratados como módulos de código de domínio                        |

---

## 7. Situação ideal macro proposta

## 7.1 Agrupamento TO-BE por famílias

### Família A — Base e composição

- `core/`
- `config/`
- `boot/`
- `types/`
- `db/`

### Família B — Vanilla boundary do SDK

- `sdk/`
- `event-handlers/`
- `events/`
- `hooks/`

### Família C — Runtime de domínio

- `agent/`
- `conversation-hub/`
- `tools/`
- `channel/` (se confirmado como transporte legítimo)

### Família D — Edge and projections

- `presentation/`
- `server/`
- `terminal/`

### Família E — Adapters e extensões

- `bridges/`
- `infra/`
- `plugins/`

### Família F — Cross-cutting

- `observability/`
- `audit/`

### Família G — Artefatos / resíduo

- `logs/`
- `.github/`
- eventualmente `dialog/`, caso se prove resíduo e não domínio real

---

## 8. Decisões arquiteturais preliminares desta auditoria

As seguintes decisões preliminares já podem ser tomadas como hipótese forte de trabalho:

1. **`sdk/` continuará sendo o SSOT do vendor**.
2. **`agent/` continuará sendo o owner do runtime vivo**.
3. **`presentation/` deve seguir crescendo como shared edge layer**.
4. **`hooks/` deve ser endurecido como módulo de policies e callbacks do SDK, não de runtime**.
5. **`event-handlers/` deve ser tratado como boundary formal de tradução do SDK**.
6. **`observability/` não deve ser autorizado a reinterpretar o SDK por conta própria**.
7. **`logs/` e `.github/` devem ser auditados como localização/pertencimento, não como domínios
   legítimos**.
8. **`dialog/`, `plugins/` e `channel/` são módulos sob suspeita taxonômica e exigem clarificação
   explícita**.

---

## 9. Perguntas abertas que passam para os próximos documentos

### Para `06-COMPOSITION-ROOTS-E-BOOT.md`

1. Qual é exatamente o root canônico do processo?
2. `agent.js` é apenas compat ou ainda carrega riscos de dupla autoridade?
3. Onde termina `bootstrap.js` e onde começa `runtime-wiring.js`?
4. Qual é o papel exato de `terminal/index.js` dentro do boot canônico?
5. `agent/lifecycle/runtime-host.js` é host de processo legítimo ou já absorve boot paralelo?

### Para `07-SDK-E-FRONTEIRA-VANILLA.md`

1. O escopo de `sdk/` está de fato completo frente ao SDK 0.3.x?
2. `hooks/` ainda segue fiel à divisão caller/provider/policy?
3. Há capabilities centrais do SDK ainda não promovidas em `src/copilot/`?

### Para `08-AGENT-RUNTIME-E-FRONTEIRAS.md`

1. Qual parte de `agent/` é runtime puro e qual parte ainda é projection/compat?
2. Quais façades precisam se tornar autoridades únicas?
3. O `AgentContext` ainda expõe semântica demais por shape cru?

---

## 10. Conclusão desta etapa

A taxonomia inicial confirma um ponto importante:

> O problema principal de `src/copilot/` já não parece ser ausência total de arquitetura — e sim a
> convivência entre **owners corretos**, **owners parciais**, **owners acidentais** e **artefatos
> que ainda ocupam espaço semântico demais**.

A boa notícia é que o sistema já possui uma direção forte:

- `sdk/` forte;
- `agent/` forte;
- `presentation/` emergindo corretamente;
- `boot` e `runtime-wiring` explícitos;
- guardrails executáveis.

A má notícia é que isso convive com áreas cinzentas importantes:

- `hooks/`
- `infra/`
- `channel/`
- `dialog/`
- `plugins/`
- `conversation-hub/` vs `agent/`
- `observability/` vs `audit/`
- artefatos (`logs/`, `.github/`) dentro da árvore de código

Essas zonas cinzentas passam a ser o foco principal das próximas fases da auditoria.
