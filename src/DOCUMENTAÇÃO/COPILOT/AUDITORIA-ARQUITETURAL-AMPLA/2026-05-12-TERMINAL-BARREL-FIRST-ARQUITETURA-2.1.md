# 2026-05-12 — Avaliação arquitetural Terminal 2.1+: política barrel-first e fronteiras de import/export

**Data:** 2026-05-12  
**Escopo:** `src/copilot/terminal/**`  
**Motivação:** iniciar a próxima onda ampla de consolidação arquitetural, com foco em boundary enforcement e convergência para o modelo 2.0/2.1 onde `index.js` é sempre barrel puro.

---

## 1) Síntese executiva

O estado atual do `terminal/` já evoluiu bastante em taxonomia, module map e decomposição de eventos, mas **ainda não está aderente ao regime barrel-first que queremos como target final**.

Os principais gaps objetivos são:

1. `terminal/index.js` ainda é **composition root operacional**, não barrel puro;
2. `terminal/dialog/index.js` ainda concentra **lógica lazy/runtime**, não apenas re-exports;
3. múltiplas subpastas importantes ainda **não possuem `index.js`**;
4. há **muitos imports cruzando subpastas por arquivo concreto**, o que enfraquece boundaries e aumenta acoplamento físico;
5. a superfície pública real do terminal ainda está **implícita no grafo de imports**, não plenamente governada por barrels recursivos.

Conclusão: a próxima fase do terminal deve ser tratada como **programa de barrelização recursiva + pureza de `index.js` + enforcement contratual**, e não apenas como refactor pontual de arquivos grandes.

---

## 2) Evidência consolidada da investigação

### 2.1 Subpastas sem barrel hoje

Na leitura do workspace atual, as seguintes pastas ainda não possuem `index.js`:

- `terminal/frontend/gateways/`
- `terminal/frontend/projections/`
- `terminal/repl/`
- `terminal/state/`
- `terminal/stores/`
- `terminal/terminal-phases/`
- `terminal/wiring/`

### 2.2 Barrels já existentes

Hoje existem `index.js` em:

- `terminal/index.js`
- `terminal/commands/index.js`
- `terminal/dialog/index.js`
- `terminal/frontend/index.js`
- `terminal/handlers/index.js`

Mas **nem todo `index.js` existente é barrel puro**.

### 2.3 Principais pontos de bypass físico

Os diretórios com maior volume de imports relativos para arquivos concretos são:

- `frontend/` → 35
- `events/` → 33
- `commands/` → 27
- `repl/` → 26
- `terminal-phases/` → 23
- `dialog/` → 21
- `wiring/` → 8

Arquivos com mais bypasses relativos:

- `repl/repl-lifecycle.js` → 12
- `terminal-phases/boot-listeners.js` → 11
- `frontend/projections/now.js` → 9
- `index.js` → 8
- `dialog/engine.js` → 8
- `wiring/terminal-agent-wiring.js` → 8
- `events/sdk-session-events.js` → 8
- `events/agent-runtime-events.js` → 8

### 2.4 Hotspots de tamanho que devem guiar a ordem da migração

Arquivos grandes do terminal hoje:

- `commands/sdk.js` → 1350 linhas
- `events/sdk-session-events.js` → 958 linhas
- `frontend/projections/timeline.js` → 906 linhas
- `commands/session.js` → 855 linhas
- `repl/repl-command-router.js` → 618 linhas
- `state/sdk-interactions.js` → 571 linhas
- `dialog/engine.js` → 564 linhas
- `events/tool-lifecycle-runtime.js` → 553 linhas
- `module-map.js` → 537 linhas

Leitura arquitetural: a barrelização deve começar **onde há ao mesmo tempo alta densidade de imports + hotspot semântico**, e não por microarquivos estáveis.

---

## 3) Diagnóstico estrutural

## 3.1 O principal desvio atual

O principal desvio não é apenas “faltam alguns barrels”. O desvio real é:

> o terminal ainda mistura **barrels**, **composition roots** e **leaf modules** na mesma convenção de nomes.

Enquanto isso continuar, `index.js` não poderá ser tratado como superfície pública totalmente confiável.

## 3.2 Consequência direta

Se `index.js` pode conter lógica operacional, o sistema perde três garantias importantes:

1. **legibilidade arquitetural** — `index.js` deixa de sinalizar “ponto de acesso público”;  
2. **governança de boundaries** — consumers podem importar a raíz e acoplar a detalhes de runtime sem perceber;  
3. **migração segura** — qualquer reestruturação física passa a exigir leitura profunda de arquivos que deveriam ser barrels triviais.

## 3.3 O caso do terminal hoje

Atualmente:

- `terminal/index.js` = orchestrator + exports públicos;
- `terminal/dialog/index.js` = barrel parcial + lazy loader + runtime shim;
- `terminal/frontend/index.js` = barrel puro;
- `terminal/commands/index.js` = barrel puro.

Isso mostra que o módulo já está **meio migrado**, mas ainda sem uma política única aplicada de ponta a ponta.

---

## 4) Arquitetura ideal alvo para o terminal (2.1+)

## 4.1 Regra-mãe

**Todo `index.js` deve ser barrel puro. Sempre.**

Ou seja:

- sem estado local;
- sem lazy loader;
- sem validação de runtime;
- sem composition root;
- sem cache;
- sem side effects;
- apenas re-exports.

## 4.2 Consequência da regra-mãe

Todo arquivo operacional que hoje usa o nome `index.js` deve migrar para um nome explícito, por exemplo:

- `terminal/index.js` → barrel puro re-exportando `./runtime-root.js` ou `./orchestrator.js`;
- `terminal/dialog/index.js` → barrel puro re-exportando `./dialog-runtime.js`, `./output.js`, `./sse.js` etc.

## 4.3 Modelo de módulo ideal

Cada pasta relevante do terminal passa a ser tratada como **módulo local com três níveis**:

1. **leaf files** — implementação concreta;
2. **sub-barrel (`index.js`)** — superfície pública da pasta;
3. **barrel de nível acima** — re-export opcional para consumers mais amplos.

Exemplo ideal:

```text
terminal/
  index.js                # barrel puro da borda terminal
  runtime-root.js         # composition root do terminal
  repl/
    index.js              # barrel puro de repl
    repl-runtime.js       # owner do lifecycle
    command-router.js
    command-parser.js
  terminal-phases/
    index.js              # barrel puro das fases
    boot-http.js
    boot-hub.js
    boot-listeners.js
```

---

## 5) Política ideal de imports

## 5.1 Regra de import canônica

**Todo import que cruza fronteira de pasta/módulo deve passar por barrel.**

Exemplos desejados:

- `terminal/index.js` importa `./repl/index.js`, não `./repl/repl.js`;
- `terminal/repl/*` importa `../events/index.js`, não `../events/event-adapters.js`;
- `terminal/events/*` importa `../state/index.js`, não `../state/activity-state.js`;
- `terminal/frontend/projections/*` importa `../gateways/index.js`, não `../gateways/agent-runtime.js`.

## 5.2 Regra para same-folder imports

Avaliação arquitetural recomendada:

- **same-folder imports diretos podem existir** entre leaf files privados do mesmo micro-módulo;
- **cross-folder imports não**;
- quando a pasta cresce e passa a representar módulo autônomo, seu consumo externo deve ser **exclusivamente via `index.js`**.

Isso evita cair num absolutismo que cria barrels cíclicos e “importa o próprio módulo público de dentro dele mesmo”.

Portanto, o objetivo prático final deve ser lido assim:

> **todos os imports entre módulos/pastas passam via barrels; imports internos locais podem permanecer diretos quando forem estritamente privados ao mesmo micro-módulo.**

Se quisermos endurecer ainda mais no futuro, isso deve ocorrer **depois** da barrelização recursiva estabilizada.

## 5.3 Regra para imports externos ao terminal

Fora de `terminal/`, ninguém deve importar arquivos concretos do terminal.

Superfícies válidas no target:

- `#copilot/terminal` (barrel raiz);
- sub-barrels públicos específicos, quando existirem e forem declarados como públicos.

Exemplo de target aceitável:

- `#copilot/terminal`
- `#copilot/terminal/frontend`
- `#copilot/terminal/commands`
- `#copilot/terminal/dialog`

Mas **não**:

- `terminal/repl/repl-lifecycle.js`
- `terminal/events/sdk-session-events.js`
- `terminal/state/activity-state.js`

exceto em testes white-box explicitamente transitórios durante a migração.

---

## 6) Política ideal de exports

## 6.1 Barrels exportam superfície, não detalhe acidental

Cada `index.js` deve exportar apenas:

- funções públicas do módulo;
- tipos/constantes de contrato;
- adapters ou façades deliberadamente públicas.

Não deve exportar automaticamente:

- utilitários privados de arquivo;
- caches internos;
- registries efêmeros;
- helpers de teste;
- detalhes de lazy loading;
- artefatos de compatibilidade que não queremos perpetuar.

## 6.2 Composition roots não devem morar em barrels

Composition root é importante demais para ficar oculto em `index.js`.

Ele deve ter nome explícito, por exemplo:

- `runtime-root.js`
- `terminal-orchestrator.js`
- `dialog-runtime.js`

O barrel apenas re-exporta, se essa surface for pública.

---

## 7) Topologia ideal do terminal sob política barrel-first

```text
terminal/
  index.js                    # barrel puro da borda
  runtime-root.js             # composition root
  bootstrap.js                # entrypoint executável
  bootstrap-lifecycle.js      # fatal boot lifecycle
  module-map.js               # inventário/scorecard

  commands/
    index.js
    ...

  dialog/
    index.js
    dialog-runtime.js
    output.js
    sse.js
    turn-display.js

  events/
    index.js
    event-adapters.js
    agent-runtime-events.js
    sdk-session-events.js
    io-activity-events.js
    task-stream-events.js
    tool-lifecycle-runtime.js

  frontend/
    index.js
    gateways/
      index.js
      agent-runtime.js
      dialog.js
      hub.js
      sdk-session.js
    projections/
      index.js
      now.js
      status.js
      timeline.js
      metrics.js
      usage.js

  repl/
    index.js
    repl-runtime.js
    repl-lifecycle.js
    repl-command-router.js
    repl-command-parser.js
    repl-banner.js

  state/
    index.js
    activity-state.js
    display-policy.js
    sdk-interactions.js
    turn-trace-state.js

  stores/
    index.js
    alias-store.js

  terminal-phases/
    index.js
    boot-banner.js
    boot-http.js
    boot-hub.js
    boot-listeners.js
    boot-pinned.js
    boot-reflection-loop.js
    boot-shutdown.js

  wiring/
    index.js
    terminal-agent-wiring.js
```

---

## 8) Ondas recomendadas de migração

## Onda TBF-1 — Pureza de barrels existentes

Objetivo:

- converter `terminal/index.js` em barrel puro;
- converter `terminal/dialog/index.js` em barrel puro;
- mover lógica operacional para arquivos nomeados explicitamente.

Resultado esperado:

- `index.js` deixa de ser ambiguamente barrel/orchestrator;
- boot/surface-validation continuam funcionando por re-export.

## Onda TBF-2 — Barrelização recursiva das subpastas faltantes

Criar `index.js` em:

- `repl/`
- `state/`
- `stores/`
- `wiring/`
- `terminal-phases/`
- `frontend/gateways/`
- `frontend/projections/`
- idealmente também `events/`

## Onda TBF-3 — Reescrita dos imports cruzados

Trocar imports do tipo:

- `../state/activity-state.js`
- `../frontend/gateways/agent-runtime.js`
- `./boot-http.js`

por barrels correspondentes:

- `../state/index.js`
- `../frontend/gateways/index.js`
- `./index.js`

## Onda TBF-4 — Surface minimization

Depois da barrelização, revisar cada barrel para expor somente o necessário.

Foco especial:

- `events/`
- `state/`
- `frontend/projections/`

## Onda TBF-5 — Enforcement automatizado

Adicionar guardrails em CI/lint/contracts para impedir regressão:

1. `index.js` barrel-only;
2. imports cross-folder no terminal só via barrels;
3. imports externos a `terminal/` só via surfaces públicas autorizadas;
4. arquivos acima de certo tamanho obrigam decomposição ou ADR local.

---

## 9) Guardrails arquiteturais recomendados

## 9.1 Regras obrigatórias

1. `index.js` nunca contém lógica operacional.
2. Composition root nunca usa nome `index.js`.
3. Import entre subpastas irmãs do terminal só via barrel.
4. Import vindo de fora do terminal só usa barrel público.
5. Barrel não importa arquivos de fora do próprio módulo, exceto outros barrels explicitamente autorizados do mesmo domínio terminal.

## 9.2 Exceções aceitáveis

Somente temporariamente:

- testes white-box durante a migração;
- arquivos legacy ainda não barrelizados, desde que rastreados por backlog explícito;
- módulos com lazy-loading especial, mas a lógica deve morar fora do `index.js`.

---

## 10) Próximas ações recomendadas

1. Converter `terminal/index.js` em barrel puro, movendo a composição para `runtime-root.js`.
2. Converter `dialog/index.js` em barrel puro, movendo lazy/runtime para `dialog-runtime.js`.
3. Criar barrels faltantes em `repl/state/stores/wiring/terminal-phases/frontend/gateways/frontend/projections/events`.
4. Reescrever imports cross-folder do terminal via barrels.
5. Atualizar testes para privilegiar sub-barrels em vez de leaf files.
6. Adicionar contratos/lint anti-bypass.

---

## 11) Julgamento final

O target arquitetural ideal para o terminal **não é apenas “mais barrels”**.

O target correto é:

> **terminal com barrels puros em todos os níveis relevantes, composition roots nomeados explicitamente, imports cross-folder exclusivamente via barrels, e superfície pública governada por exports deliberados.**

Esse é o formato mais coerente com a Arquitetura 2.0/2.1 que já estamos consolidando no restante de `src/copilot`.