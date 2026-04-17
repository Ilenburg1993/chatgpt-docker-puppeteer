# Sumário Executivo — `src/copilot`

## Snapshot objetivo

O recorte atual de `src/copilot/` apresenta:

- **20 módulos top-level de código**;
- **1 diretório operacional de logs**;
- **229 arquivos** no recorte estrutural observado até profundidade 2;
- os maiores módulos por volume são:
  - `agent` → **8.392 linhas**;
  - `sdk` → **7.931 linhas**;
  - `tools` → **7.101 linhas**;
  - `terminal` → **7.063 linhas**;
  - `observability` → **5.860 linhas**;
  - `server` → **5.397 linhas**.

## Diagnóstico central

O sistema já não é um monólito simples. Ele é uma plataforma composta por cinco eixos fortes:

1. **runtime** (`agent/`)
2. **vendor wrapper e capacidades** (`sdk/`)
3. **bordas operacionais** (`terminal/`, `server/`, `presentation/`)
4. **memória/sessão/conversa** (`conversation-hub/`, `channel/`, `core/shared-state`)
5. **instrumentação e governança** (`observability/`, `hooks/`, `events/`, `audit/`)

O maior problema arquitetural atual não é “falta de módulos”; é o contrário: o sistema já tem muitos módulos, mas ainda conserva **sobreposição de responsabilidades**, **bridges transitórios demais** e **pontos de verdade múltiplos** em algumas trilhas.

## Achados mais relevantes

### 1. `observability/` continua hipercêntrico

Medição objetiva:

- **91 arestas cross-module apontando para `observability/`**.

Leitura:

- `observability/` continua funcionando parcialmente como utilidade transversal, parcialmente como domínio, parcialmente como reação semântica.
- Isso aumenta o risco de duplicação entre `collectors`, `observers`, `bus-actions`, `health` e `error tracking`.

### 2. `agent/` ainda é o maior centro de coordenação funcional

Medições relevantes:

- `agent -> observability` = **27**
- `agent -> core` = **20**
- `agent -> event-handlers` = **15**
- `agent -> sdk` = **9**

Leitura:

- o runtime está mais modular do que antes, mas ainda carrega alto peso de coordenação e costura.
- `always-alive.js` continua como fachada grande e influente.

### 3. `terminal/` melhorou muito nas fronteiras externas, mas ainda precisa convergir internamente

Achados objetivos:

- `server -> terminal` já foi reduzido para **0 imports estruturais diretos**;
- `terminal/commands/` zerou DI direta no recorte mais trabalhado;
- `terminal/frontend/*` já virou seam canônica importante;
- mas `terminal/` ainda tem **50 arquivos** e **7.063 linhas**, o que indica que o boundary interno ainda está em transformação.

### 4. o sistema ainda convive com muitas estruturas transitórias

Medições:

- **18 arquivos com `@deprecated`**;
- **34 arquivos com padrão de singleton module-level**;
- **45 arquivos com `new Map()`**;
- **26 arquivos com `container.resolve()`**.

Leitura:

- há progresso de SSOT, mas a arquitetura ainda convive com compat shims, caches locais, registries e wiring tardio demais.

### 5. o boundary com o SDK ainda é difuso demais fora da camada `sdk/`

Medição:

- **43 arquivos** com import direto de `@github/copilot-sdk`.

Leitura:

- mesmo que parte desses imports esteja dentro da própria camada `sdk/`, o volume total ainda indica que o wrapper fino não fechou completamente as costuras de vendor.

## Situação ideal proposta

A arquitetura ideal não é “ter mais pastas”; é ter **ownership inequívoco**.

### SSOTs desejadas

| Domínio                                  | SSOT ideal                                    |
| ---------------------------------------- | --------------------------------------------- |
| runtime do agente                        | `agent/`                                      |
| vendor SDK / modelos / sessão SDK        | `sdk/` + `infra/sdk-session-registry.js`      |
| sessão conversacional / replay / memória | `conversation-hub/`                           |
| binding hub ↔ sdk ↔ runtime              | `core/shared-state.js` + helpers de ownership |
| transporte contínuo LLM-A ↔ LLM-B        | `channel/`                                    |
| projections de borda compartilhadas      | `presentation/`                               |
| frontend principal da LLM-B              | `terminal/`                                   |
| borda HTTP/SSE/Socket                    | `server/`                                     |
| política/transformação de hooks          | `hooks/`                                      |
| reação semântica a eventos               | `event-handlers/`                             |
| telemetria/saúde/coleta                  | `observability/`                              |
| ferramentas do runtime                   | `tools/`                                      |

## Critério simples para julgar qualquer refactor futuro

Uma transformação só melhora `src/copilot` se ela reduzir ao mesmo tempo pelo menos três dos quatro itens abaixo:

1. **ownership ambíguo**;
2. **duplicação de projeção ou coordenação**;
3. **dependência direta entre bordas e runtime**;
4. **acesso ad hoc a estado compartilhado**.

Se não reduzir esses quatro vetores, provavelmente é refactor cosmético ou feature prematura.

## Próximo movimento recomendado

O próximo passo mais correto não é “mexer em tudo”.

É:

1. estabilizar o **modelo-alvo de ownership**;
2. atacar os **duplicados estruturais** ainda vivos;
3. terminar a convergência do **terminal como frontend principal**;
4. reduzir a centralidade de `observability/`;
5. continuar a limpeza do ownership de sessão entre `agent`, `sdk` e `conversation-hub`.
