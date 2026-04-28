# 10 — Events e Tradução de Sinais em `src/copilot`

**Status**: auditoria ativa **Última atualização**: 2026-04-27 **Escopo desta etapa**: relação entre
`src/copilot/events/`, `src/copilot/event-handlers/`, os sinais vanilla do SDK e os consumidores
internos (`agent/`, `presentation/`, `terminal/`, `observability/`).

---

## 1. Objetivo deste documento

Este documento audita uma das linhas de fratura mais delicadas do sistema:

> **quem traduz os eventos do SDK, quem define a gramática dos eventos internos e quem apenas
> observa ou consome esses sinais?**

Sistemas desse tipo frequentemente sofrem de um problema clássico:

- uma camada nomeia eventos;
- outra traduz eventos brutos;
- outra observa e cria nomes derivados;
- outra reinterpreta tudo para UI;
- e, ao final, ninguém sabe qual é o contrato canônico.

Este documento existe para evitar exatamente isso.

---

## 2. Base factual utilizada nesta etapa

A análise se apoia em:

- `src/copilot/event-handlers/README.md`
- `src/copilot/event-handlers/catch-all.js`
- `src/copilot/events/index.js`
- `src/copilot/README.md`
- `src/copilot/observability/README.md`
- `DOCUMENTAÇÃO/ARQUITETURA/SDK-WRAPPER-IDEAL-ARCHITECTURE.md`

---

## 3. Tese arquitetural declarada para o eixo de eventos

## 3.1 Tese canônica

Os documentos atuais apontam para uma arquitetura tripartida:

1. **SDK vanilla emite `SessionEvent`**;
2. **`event-handlers/` traduz o vanilla para sinais internos estáveis**;
3. **`events/` consolida a gramática/catálogo dos nomes de eventos do sistema**.

Em paralelo:

- `agent/` orquestra o runtime usando esses sinais;
- `observability/` coleta sinais estabilizados;
- `terminal/` e `presentation/` consomem projeções desses sinais.

Essa tese é boa e sofisticada.

O problema é que ela também é frágil: três módulos vizinhos podem facilmente começar a competir por
papéis parecidos.

---

## 4. O que `event-handlers/` parece fazer corretamente hoje

## 4.1 Boundary de tradução do vanilla

O README do módulo é muito explícito:

- se o SDK já emite um evento vanilla,
- o primeiro lugar a tocar esse evento deve ser `event-handlers/`.

Isso é uma regra arquitetural excelente.

## 4.2 Especialização por subdomínio de evento

A pasta está organizada por tipos de fluxo:

- lifecycle;
- streaming;
- tool lifecycle;
- mode/plan;
- sdk responses;
- interaction events;
- usage;
- compaction;
- MCP;
- notificações sistêmicas;
- catch-all.

### Diagnóstico

Isso indica um boundary de tradução maduro, não um arquivo único improvisado.

## 4.3 `catch-all.js` como proteção contra drift do SDK

O arquivo `catch-all.js` é especialmente importante.

Ele mantém um conjunto de eventos conhecidos do SDK e emite warning para eventos não mapeados.

### Diagnóstico

Esse é um padrão de maturidade arquitetural forte, porque transforma atualização do SDK em:

- evento observável;
- risco detectável;
- gatilho para evolução do tradutor.

---

## 5. O que `events/` parece fazer corretamente hoje

## 5.1 Barrel SSOT de nomes de eventos internos

`events/index.js` se declara explicitamente como:

- SSOT de strings de eventos cross-module do sistema Copilot.

Ele reexporta submódulos temáticos como:

- `agent-events`;
- `hook-events`;
- `hub-events`;
- `terminal-events`;
- `system-events`;
- `service-events`;
- `nerv-events`;
- emitter events internos.

### Diagnóstico

Isso é exatamente o que se espera de um catálogo de eventos do sistema: uma gramática explícita e
central.

## 5.2 Regra anti-string-inline

O próprio arquivo declara que usar strings inline fora desse módulo é violação arquitetural.

### Diagnóstico

Essa é uma decisão excelente de governança porque reduz:

- drift de nomenclatura;
- typos;
- proliferação de contratos informais.

---

## 6. Onde está a tensão real

## 6.1 `event-handlers/` vs `events/`

### Situação atual

A teoria atual é:

- `event-handlers/` traduz;
- `events/` nomeia/catalogue.

### Diagnóstico

Essa divisão é correta, mas a sobreposição potencial é alta porque ambos operam no domínio
“eventos”.

### Situação ideal

- `event-handlers/` deve saber **como um evento vanilla vira um sinal operacional**;
- `events/` deve saber **quais nomes/eventos existem no sistema interno**;
- `events/` não deve virar transdutor;
- `event-handlers/` não deve virar catálogo universal do sistema.

## 6.2 `event-handlers/` vs `observability/`

### Situação atual

`observability/` se declara consumer/correlator dos sinais estabilizados.

### Diagnóstico

Isso é a fronteira correta, mas sempre ameaçada por tentação operacional:

- observability é o lugar natural para "entender o evento" novamente.

### Situação ideal

- `event-handlers/` interpreta o vanilla uma vez;
- `observability/` mede, correlaciona, timeline-iza esse resultado;
- observability não reinventa tradução semântica paralela.

## 6.3 `event-handlers/` vs `terminal/`

### Situação atual

O terminal consome sinais traduzidos e também observa sinais de runtime/SDK para render/sse.

### Diagnóstico

O risco aqui é que UX local acabe criando uma segunda camada de “quase tradução” por conveniência.

### Situação ideal

- `event-handlers/` traduz para um contrato interno confiável;
- `agent/` orquestra esse contrato;
- `terminal/` faz narrativa/render sobre o contrato já estabilizado.

## 6.4 `events/` vs `hooks/`

### Situação atual

Há `hook-events` dentro do catálogo `events/`, enquanto `hooks/` cuida do subsistema de hooks.

### Diagnóstico

Isso é aceitável e até desejável, desde que a linha seja clara:

- `hooks/` define/compõe o comportamento do subsistema;
- `events/` apenas dá nome/catálogo aos eventos gerados por ele.

---

## 7. Mapa ideal do pipeline de eventos

## 7.1 Pipeline vanilla -> runtime

```text
@github/copilot-sdk SessionEvent
  -> sdk/session/events.js (typed helpers do wrapper)
    -> event-handlers/*
      -> callbacks / agent event wiring
        -> agent runtime emitter
          -> presentation / terminal / observability / server
```

## 7.2 Papel de cada camada nesse pipeline

| Camada                  | Papel ideal                                                         |
| ----------------------- | ------------------------------------------------------------------- |
| `sdk/session/events.js` | typed helpers e acesso seguro aos eventos vanilla                   |
| `event-handlers/`       | tradução do vanilla para sinais internos estáveis                   |
| `events/`               | nomes e gramática de eventos do sistema                             |
| `agent/`                | uso desses sinais para lifecycle e runtime                          |
| `presentation/`         | projeções compartilhadas dos sinais relevantes                      |
| `terminal/`             | narrativa e UX local sobre os sinais                                |
| `observability/`        | coleta, métricas, tracing e timelines sobre sinais já estabilizados |

---

## 8. Riscos estruturais específicos do eixo de eventos

## 8.1 Tradução duplicada em múltiplos lugares

Este é o risco mais sério.

### Sinal de regressão

O mesmo evento vanilla passa a ser:

- interpretado em `event-handlers/`;
- reinterpretado em `agent/`;
- reinterpretado em `terminal/`;
- reinterpretado em `observability/`.

### Regra proposta

A primeira interpretação semântica do vanilla deve acontecer **uma vez** em `event-handlers/`.

## 8.2 `events/` virar "balcão universal de strings" sem governança

`events/index.js` é poderoso e amplo.

### Risco

- criar nomes demais;
- criar aliases concorrentes;
- catalogar coisas que não deveriam existir como eventos próprios;
- esconder duplicação conceitual sob nomes diferentes.

### Regra proposta

Novo evento só entra no catálogo se responder:

1. isso representa um acontecimento semântico realmente distinto?
2. há owner claro desse evento?
3. ele não duplica outro evento já existente com outro nome?

## 8.3 `catch-all.js` envelhecer e perder poder de detecção

O catch-all é muito útil, mas depende de manutenção.

### Risco

Se a lista de conhecidos ficar desatualizada, o sistema pode normalizar drift sem revisão adequada.

### Regra proposta

Todo upgrade do SDK deve incluir revisão explícita do catch-all e do coverage map de eventos.

---

## 9. Situação ideal TO-BE para o eixo `events`

## 9.1 Missão ideal de `event-handlers/`

Responder à pergunta:

> **como um `SessionEvent` vanilla se transforma em um sinal operacional interno, estável e seguro
> para o runtime local?**

## 9.2 Missão ideal de `events/`

Responder à pergunta:

> **quais são os eventos internos canônicos do sistema Copilot e como eles são nomeados?**

## 9.3 Regras ideais de convivência

### `event-handlers/`

Pode possuir:

- tradutores por tipo de evento;
- guards contra drift;
- mapping de payloads vanilla para sinais internos.

Não deve possuir:

- payload HTTP canônico;
- state store do runtime;
- métricas/tracing como missão primária;
- catálogo global de eventos de todo o sistema.

### `events/`

Pode possuir:

- catálogo;
- barrel SSOT de nomes;
- classificação temática;
- agrupamentos/sets de eventos.

Não deve possuir:

- tradução de payloads vanilla;
- execução de side effects;
- knowledge profunda do SDK beyond nomenclatura necessária.

---

## 10. Decisões preliminares desta etapa

1. **A arquitetura atual do eixo de eventos é conceitualmente forte**.
2. **`event-handlers/` parece estar no papel correto de boundary de tradução do SDK**.
3. **`events/` parece estar no papel correto de gramática/catalogação do sistema**.
4. **O maior risco não é a tese estar errada; é a tese regredir por duplicação de tradução em outras
   camadas**.
5. **`observability/`, `terminal/` e `presentation/` devem continuar sendo tratados como consumers e
   projectors, não como tradutores concorrentes do vanilla**.
6. **O catch-all deve ser tratado como guardrail estratégico contra drift do SDK**.

---

## 11. Conclusão desta etapa

A conclusão principal é fortemente positiva:

> o eixo `events/` + `event-handlers/` já possui uma arquitetura melhor do que a média de sistemas
> equivalentes — mas também depende de disciplina contínua para não se degradar silenciosamente.

A auditoria confirma que:

- `event-handlers/` tem papel legítimo e claro;
- `events/` também;
- a separação entre os dois é boa, porém naturalmente delicada.

O que vem agora é auditar as bordas e o restante dos polos de tensão:

- `11-PRESENTATION-SHARED-EDGE-LAYER.md`
- `12-SERVER-HTTP-SSE-SOCKET-BOUNDARY.md`
- `13-TERMINAL-UX-E-CONSUMO-DO-RUNTIME.md`
