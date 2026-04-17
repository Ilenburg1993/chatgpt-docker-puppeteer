# Grafos, Acoplamentos e Smells Estruturais — `src/copilot`

## 1. Grafo top-level: principais arestas cross-module

As medições abaixo foram obtidas diretamente dos imports `#copilot/*` entre módulos top-level.

| Aresta                            | Contagem | Leitura arquitetural                                        |
| --------------------------------- | -------: | ----------------------------------------------------------- |
| `agent -> observability`          |       27 | runtime depende demais do subsistema de instrumentação      |
| `agent -> core`                   |       20 | esperado, mas alto; `core` precisa permanecer muito estável |
| `server -> observability`         |       18 | a borda HTTP ainda lê muito detalhe operacional             |
| `agent -> event-handlers`         |       15 | runtime ainda coordena muito da reação semântica            |
| `tools -> sdk`                    |       14 | ferramentas dependem bastante do wrapper do vendor          |
| `agent -> events`                 |       12 | runtime ainda fortemente amarrado à taxonomia de eventos    |
| `event-handlers -> observability` |       11 | reação semântica e coleta ainda se tocam demais             |
| `event-handlers -> sdk`           |       11 | handlers ainda conhecem demais o wrapper                    |
| `server -> config`                |       11 | expected, mas indica muito endpoint acoplado a config       |
| `terminal -> core`                |       11 | terminal usa muitas utilidades centrais diretamente         |

## 2. Métricas-chave do grafo

| Métrica                        | Valor | Interpretação                                            |
| ------------------------------ | ----: | -------------------------------------------------------- |
| `server -> terminal`           |     0 | excelente melhora: bordas já não se importam diretamente |
| `terminal -> server`           |     0 | terminal deixou de depender da borda HTTP                |
| `sdk -> agent`                 |     0 | bom sinal de camada: wrapper não depende do runtime      |
| `agent -> sdk`                 |     9 | esperado, mas ainda alto                                 |
| `terminal -> agent`            |     2 | saudável se via seam/gateway, perigoso se direto         |
| `terminal -> conversation-hub` |     3 | aceitável para frontend principal                        |
| `terminal -> channel`          |     1 | desejável para interface contínua da LLM-B               |
| `cross -> observability`       |    91 | grande alerta de hipercapitalização arquitetural         |

## 3. Centralidade implícita por módulo

### `observability/` — hiperhub transversal

Com 91 arestas apontando para ele, `observability/` ainda é o maior polo de acoplamento do sistema.

Isso significa que ele é tratado, ao mesmo tempo, como:

- logger;
- métricas;
- tracking de erro;
- health updater;
- observers de bus;
- coletores de eventos;
- fonte de dados para borda HTTP.

**Risco:** virar módulo “faz-tudo” em vez de camada utilitária especializada.

### `agent/` — orquestrador ainda dominante

`agent/` concentra o coração do sistema. Isso é esperado, mas o grafo mostra que ele ainda precisa perder parte da coordenação incidental para:

- `event-handlers/`;
- `conversation-hub/`;
- `presentation/`;
- `hooks/`.

### `terminal/` — já desacoplado das bordas, ainda em consolidação interna

O terminal deixou de ser pseudo-backend do `server`, mas ainda é um macro-módulo grande o bastante para exigir disciplina interna: `commands`, `dialog`, `frontend`, `handlers`, `repl` e wiring não podem voltar a se acoplar por conveniência.

### `sdk/` — wrapper ainda mais espesso do que deveria

O `sdk/` já ganhou uma identidade de camada própria, mas continua extenso, com muita lógica interna e alto volume de imports diretos de vendor no sistema como um todo.

## 4. Smells estruturais medidos

### 4.1 Singletons module-level

| Indicador                               | Valor |
| --------------------------------------- | ----: |
| arquivos com padrões de singleton local |    34 |

Exemplos:

- `agent/always-alive.js`
- `core/shared-state.js`
- `sdk/session/client.js`
- `terminal/index.js`
- `conversation-hub/orchestrator.js`

**Leitura:** ainda existe muito estado de processo pendurado em módulos, o que dificulta isolamento, replay, teardown e testes mais determinísticos.

### 4.2 Uso de `container.resolve()`

| Indicador                          | Valor |
| ---------------------------------- | ----: |
| arquivos com `container.resolve()` |    26 |

Mais preocupantes porque são módulos operacionais centrais:

- `agent/lifecycle/agent-lifecycle.js`
- `agent/lifecycle/entry.js`
- `presentation/system-metrics.js`
- `server/routes/sessions.js`
- `terminal/index.js`

**Leitura:** DI ainda é usada parcialmente como service locator, não só como wiring controlado.

### 4.3 Imports diretos de `@github/copilot-sdk`

| Indicador                                | Valor |
| ---------------------------------------- | ----: |
| arquivos com import direto do vendor SDK |    43 |

Mais pesados:

- `sdk/types.js`
- `sdk/session/lifecycle.js`
- `sdk/session/client.js`
- `config/session-config.js`

**Leitura:** o wrapper está evoluindo, mas o boundary do vendor ainda não está suficientemente “encapsulado” no sentido arquitetural.

### 4.4 Estruturas mutáveis locais

| Indicador                | Valor |
| ------------------------ | ----: |
| arquivos com `new Map()` |    45 |

**Leitura:** o sistema usa muitos registries/caches/índices locais. Isso não é necessariamente ruim, mas exige disciplina de TTL, limpeza e ownership.

### 4.5 Código transitório / compatibilidade

| Indicador                  | Valor |
| -------------------------- | ----: |
| arquivos com `@deprecated` |    18 |

Essa quantidade confirma que parte do custo atual da arquitetura é carregar **estruturas antigas ainda não removidas**.

## 5. Grafos problemáticos por tema

### Grafo A — Runtime + Instrumentação

```
agent -> observability
event-handlers -> observability
server -> observability
terminal -> observability
channel -> observability
conversation-hub -> observability
```

**Problema:** observability recebe chamadas de quase todos os lados; isso mistura coleta, reação e leitura operacional.

### Grafo B — Runtime + Eventos

```
agent -> events
agent -> event-handlers
event-handlers -> sdk
event-handlers -> observability
hooks -> events
conversation-hub -> events
```

**Problema:** a taxonomia de eventos e a reação semântica ainda não estão 100% separadas da orquestração.

### Grafo C — Terminal como frontend principal

```
terminal -> agent
terminal -> channel
terminal -> conversation-hub
terminal -> config
terminal -> bridges
terminal -> core
```

**Leitura:** esse grafo é aceitável se o terminal continuar sendo frontend principal e usar seams locais claras. Se não houver seam, ele volta a virar orquestrador acidental.

## 6. Conclusões do grafo

1. O sistema já avançou bastante nas bordas, principalmente ao zerar `server -> terminal`.
2. O maior problema estrutural restante é a **centralidade excessiva de `observability/`**.
3. O segundo problema é a **espessura combinada de `agent/` + `sdk/` + `terminal/`**, que ainda carregam parte demais da coordenação sistêmica.
4. A próxima arquitetura ideal deve ser desenhada para reduzir:
   - arestas para `observability/`;
   - imports diretos de vendor SDK;
   - service-locator em runtime;
   - compatibilidade residual sem owner explícito.
