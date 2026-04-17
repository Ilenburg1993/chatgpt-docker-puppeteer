# Roadmap Independente de Transformação — `src/copilot`

## 1. Objetivo

Este roadmap não deriva da linha clean atual; ele deriva da análise direta do código.

Seu foco é transformar `src/copilot/` até o endstate descrito em [`05-ARQUITETURA-ALVO-E-ENDSTATE.md`](./05-ARQUITETURA-ALVO-E-ENDSTATE.md).

## 2. Ondas propostas

### Onda 0 — Congelamento factual

Objetivo:

- congelar baseline do sistema real;
- aceitar explicitamente os owners desejados;
- impedir regressões de fronteira.

### Onda 1 — Fechamento do runtime e ownership de sessão

Objetivo:

- terminar a convergência de `agent/`;
- estabilizar ownership `hub ↔ sdk ↔ runtime`;
- reduzir compatibilidade residual crítica.

### Onda 2 — Vendor boundary e sessões SDK

Objetivo:

- emagrecer o `sdk/`;
- reduzir imports diretos do vendor;
- separar sessão SDK do restante do sistema.

### Onda 3 — Eventos e observabilidade

Objetivo:

- reduzir a centralidade de `observability/`;
- clarificar papel de `events/`, `event-handlers/`, `hooks/` e `audit/`.

### Onda 4 — Terminal-first completo

Objetivo:

- terminar a convergência do terminal como frontend principal;
- refinar `dialog`, `repl`, listeners e wiring;
- ampliar contract tests do frontend local.

### Onda 5 — Ferramentas, plugins e plataforma interna

Objetivo:

- revisar `tools/`, `plugins/`, `infra/`, `core/` e `types/` como plataforma.

## 3. Programas prioritários

## Programa P1 — Runtime único e limpo

### P1.1
- terminar B1.x: background tasks, health, error policy, compat residual

### P1.2
- concluir B2/C1: binding de sessão e ownership explícito

### P1.3
- remover duplicidade entre `agent/session/event-handlers/*` e `event-handlers/*`

### P1.4
- reduzir o tamanho e a responsabilidade de `always-alive.js`

## Programa P2 — Boundary do vendor SDK

### P2.1
- reduzir drasticamente imports diretos de `@github/copilot-sdk`

### P2.2
- consolidar `sdk-session-registry` e `sdk/session/client.js`

### P2.3
- separar claramente builders/config/contracts do runtime operacional

## Programa P3 — Sessão e replay conversacional

### P3.1
- tornar `conversation-hub/` o owner inequívoco de turns, memórias e replay

### P3.2
- revisar `store`, `store-memories`, `store-sync`, `orchestrator`

### P3.3
- alinhar resume/restart com binding `hub ↔ sdk`

## Programa P4 — Terminal-first total

### P4.1
- concluir `terminal/frontend/*` como seam local única

### P4.2
- reduzir wiring residual em `terminal/index.js` e `terminal-agent-wiring.js`

### P4.3
- refinar boundary de `dialog/*` e `repl-listeners.js`

### P4.4
- ampliar tests de contrato do terminal como frontend principal da LLM-B

## Programa P5 — Eventos, políticas e telemetria

### P5.1
- distinguir taxonomia (`events/`) de reação (`event-handlers/`)

### P5.2
- estreitar `hooks/` para política e transformação

### P5.3
- reduzir centralidade operacional de `observability/`

### P5.4
- impedir que collectors/observers/bus-actions voltem a duplicar semântica de domínio

## Programa P6 — Plataforma técnica interna

### P6.1
- revisar `tools/` por domínio real, não só por conveniência histórica

### P6.2
- revisar `infra/` e `core/` para manter apenas utilidades e registries legítimos

### P6.3
- decidir papel real de `plugins/`

## 4. Primeiros cortes recomendados

1. **eliminar a duplicidade residual de handlers** entre `agent/session/event-handlers/*` e `event-handlers/*`;
2. **continuar a limpeza do ownership de sessão** nas rotas `server/routes/sdk/*` e consumidores do runtime;
3. **reduzir a centralidade de `observability/`**, começando pela separação entre coleta, reação e health projection;
4. **terminar a convergência interna do terminal** (`dialog`, `repl`, listeners, wiring);
5. **continuar a dieta de imports diretos do vendor SDK**.

## 4.1 Prioridade imediata escolhida

O primeiro módulo prioritário eleito para execução profunda é **`observability/`**.

Motivos objetivos:

- maior polo de acoplamento transversal (`91` arestas cross-module apontando para ele);
- coexistência de três famílias internas parcialmente sobrepostas (`collectors`, `observers`, `bus-actions`);
- ausência, até aqui, de um owner único da runtime pipeline observacional do EventBus.

Primeiro corte escolhido:

- criar um runtime canônico de `observability/` sobre o EventBus;
- reduzir `event-bus-observers.js` a compat shim;
- publicar health do próprio módulo no registry de health.

Esse primeiro corte já foi executado e validado. O próximo subcorte dentro da prioridade de `observability/` passa a ser a limpeza da superfície restante do módulo, especialmente na fronteira entre `agent-event-observer.js`, `collectors/*` e as projections operacionais consumidas pelas bordas.

## 5. Critérios de aceite por programa

### P1
- runtime com menos coordenação incidental;
- compat residual menor;
- ownership de sessão explícito.

### P2
- imports de vendor reduzidos;
- session ownership fora do wrapper onde fizer sentido;
- contracts mais claros.

### P3
- replay/resume previsíveis;
- conversa persistida com owner inequívoco.

### P4
- terminal claramente frontend, não pseudo-runtime.

### P5
- `observability/` menos central e menos semântico.

### P6
- plataforma interna com menos módulos “faz-tudo”.

## 6. Conclusão

O ponto central deste roadmap é simples:

- não faltam módulos;
- faltam **owners finais**;
- faltam **fronteiras finais**;
- faltam **remoções definitivas** do que hoje ainda existe só por transição.

Enquanto mais de um lugar fizer a mesma coisa, `src/copilot` continuará funcional, mas não plenamente limpo.
