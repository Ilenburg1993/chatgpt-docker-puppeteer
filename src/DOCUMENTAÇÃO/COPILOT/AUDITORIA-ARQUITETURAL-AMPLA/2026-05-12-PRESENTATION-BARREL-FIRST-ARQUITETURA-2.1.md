# 2026-05-12 — Avaliação arquitetural Presentation 2.1+: shared edge layer barrel-first

**Data:** 2026-05-12
**Escopo:** `src/copilot/presentation/**`
**Motivação:** iniciar a próxima onda ampla de reorganização arquitetural após a consolidação barrel-first do `terminal/`, agora adaptando a estratégia para a natureza própria de `presentation/` como **shared edge layer**.

---

## 1) Sínese executiva

> **Delta de execução — 2026-05-12 (rodada atual)**
>
> A implementação já avançou bastante além do diagnóstico-base desta nota:
>
> - `agent/`, `routing/`, `state/`, `system/`, `conversation/`, `contracts/`, `runtime/`, `files/` e `sdk/` já são
>   subdomínios físicos reais;
> - `server/` e `terminal/` já foram religados para consumir `presentation/` via sub-barrels nesses subdomínios;
> - `package.json` já expõe superfícies públicas explícitas para `presentation` (`#copilot/presentation/*` sem
>   curingas);
> - um submódulo `agent/runtime/index.js` já foi introduzido para estreitar a surface de seleção/lookup de runtime e
>   evitar ciclos com `agent/control.js`.
>
> Assim, esta nota passa a servir como **diagnóstico-base + target de governança**, e o próximo foco principal sai da
> taxonomia física inicial para **surface minimization + decomposição de hotspots + enforcement automatizado**.

`presentation/` **não é uma borda final** como `terminal/`. Ele é uma **camada transversal de projeções, payloads, accessors e handlers compartilhados** entre `server/`, `terminal/` e outras bordas/consumidores de runtime.

Isso muda a estratégia arquitetural:

- em `terminal/`, a meta foi isolar a borda humana e impedir que o resto de `src/copilot` dependesse dela;
- em `presentation/`, a meta correta é **permitir dependência controlada**, mas **somente via superfícies públicas deliberadas**.

O diagnóstico atual mostra que `presentation/` já cumpre corretamente o papel de shared edge layer, porém ainda está fisicamente organizado como **pasta plana de leaf files**, com:

1. **nenhuma subpasta estrutural**;
2. **barrel raiz largo demais** (`index.js` com muitos `export *`);
3. **cultura de deep import em arquivos concretos** por `server/`, `terminal/` e testes;
4. mistura no mesmo nível de concerns de:
   - agent control,
   - routing/meta,
   - runtime projections,
   - SDK session façade,
   - system config/metrics,
   - file context,
   - state store/UI,
   - contracts/types.

Conclusão: a próxima onda em `presentation/` deve ser tratada como **programa de taxonomia física + barrels recursivos + superfícies públicas explícitas + decomposição dos hotspots**, e não como simples rename de arquivos.

---

## 2) Evidência consolidada da investigação

### 2.1 Topologia atual

Hoje `src/copilot/presentation/` já está organizado em subdomínios reais:

- `agent/`
- `routing/`
- `runtime/`
- `state/`
- `files/`
- `system/`
- `conversation/`
- `sdk/`
- `contracts/`

e mantém apenas poucos leaf files de raiz deliberados, como:

- `index.js`
- `dialog-timeout-policy.js`
- `README.md`

### 2.2 Volume / hotspots

Total aproximado no módulo:

- **7857 linhas** de código JS

Maiores arquivos hoje:

- `agent-control.js` → **1663** linhas
- `runtime-ui-state-store.js` → **716** linhas
- `system-metrics.js` → **582** linhas
- `runtime-health.js` → **396** linhas
- `runtime-sdk-session.js` → **393** linhas
- `system-config.js` → **354** linhas
- `runtime-file-context.js` → **330** linhas
- `sdk-recovery-policy.js` → **312** linhas
- `runtime-controls.js` → **299** linhas
- `runtime-dialog.js` → **279** linhas

Leitura arquitetural: o risco maior está em **`agent-control.js`** e **`runtime-ui-state-store.js`**, não apenas por tamanho bruto, mas porque concentram múltiplas responsabilidades de alto tráfego.

### 2.3 Dependência interna dentro de `presentation/`

Hubs internos mais consumidos por outros arquivos do próprio módulo:

- `agent-runtime.js` → 10 imports internos
- `runtime-meta.js` → 7
- `runtime-targeting.js` → 6
- `runtime-overview.js` → 5
- `runtime-status.js` → 5
- `runtime-lifecycle.js` → 4
- `runtime-controls.js` → 4
- `runtime-ui-state.js` → 4

Leitura arquitetural: já existe uma **espinha dorsal natural** para organizar a taxonomia futura:

1. seleção/runtime targeting;
2. meta/route binding;
3. overview/status/health;
4. state/ui façade.

### 2.4 Consumers externos reais

#### `server/` consome principalmente

- `runtime-request.js` → 10 imports
- `runtime-meta.js` → 7
- `agent-http-errors.js` → 4
- `runtime-health.js` → 4
- `conversation-hub.js` → 3
- `system-metrics.js` → 3
- `dialog-timeout-policy.js` → 3
- `runtime-status.js` → 3
- `runtime-controls.js` → 3

#### `terminal/` consome principalmente

- `runtime-ui-state-store.js` → 25 imports
- `realtime.js` → 3
- `runtime-file-context.js` → 3
- `system-metrics.js` → 3
- `runtime-overview.js` → 2
- `runtime-file-routing.js` → 2
- `runtime-lifecycle.js` → 2

Leitura arquitetural:

- `server/` usa `presentation/` como **routing/meta/health gateway**;
- `terminal/` usa `presentation/` como **shared state / projections / shared runtime façade**;
- portanto a topologia ideal precisa refletir **dois perfis públicos distintos**, e não um único `index.js` inchado.

### 2.5 Superfície pública atual

O barrel raiz `src/copilot/presentation/index.js` segue puro, e `package.json` já declara superfícies explícitas para:

- `#copilot/presentation`
- `#copilot/presentation/agent`
- `#copilot/presentation/contracts`
- `#copilot/presentation/conversation`
- `#copilot/presentation/files`
- `#copilot/presentation/routing`
- `#copilot/presentation/runtime`
- `#copilot/presentation/sdk`
- `#copilot/presentation/state`
- `#copilot/presentation/system`

O gap remanescente deixou de ser “falta surface pública” e passou a ser **minimizar melhor a surface do root barrel e
dos sub-barrels grandes**.

---

## 3) Diagnóstico estrutural

## 3.1 O principal desvio atual

O principal desvio de `presentation/` não é “falta um barrel”.

O desvio real é:

> uma **camada shared-edge madura** continua fisicamente modelada como **namespace plano de arquivos**.

Isso já não escala para a densidade atual do módulo.

## 3.2 Problemas arquiteturais resultantes

1. **superfície pública implícita**
   consumidores dependem de leaf files porque não existem sub-superfícies canônicas;

2. **mistura de domínios no mesmo nível**
   `agent-control.js`, `runtime-request.js`, `runtime-ui-state-store.js` e `system-metrics.js` coexistem lado a lado embora pertençam a grupos semânticos distintos;

3. **dificuldade de enforcement**
   sem sub-barrels, não dá para distinguir facilmente o que é API pública do que é detalhe interno;

4. **barrel raiz largo demais**
   `index.js` vira hub por conveniência, não por governança deliberada;

5. **risco de `presentation/` virar “segundo runtime”**
   conforme cresce, sem taxonomia clara, fica mais fácil deixar lógica de domínio/runtime vazar para a camada de projeção.

## 3.3 Risco específico desta pasta

Diferente de `terminal/`, o problema aqui **não** é “frontend máximo”.

O risco específico de `presentation/` é:

> virar uma camada transversal tão larga e plana que deixa de ser uma *shared edge layer governada* e passa a ser um *dumping ground de accessors e handlers*.

---

## 4) Arquitetura ideal alvo para `presentation/` (2.1+)

## 4.1 Regra-mãe

**`presentation/` deve ser barrel-first por subdomínio, não apenas por pasta raiz.**

Ou seja:

- `index.js` continua barrel puro;
- novos `index.js` de subpastas também devem ser barrels puros;
- consumidores externos deixam de apontar para leaf files sempre que atravessam fronteiras semânticas relevantes.

## 4.2 Diferença essencial para `terminal/`

Em `terminal/`, a regra era:

> ninguém fora de `terminal/` depende do terminal.

Em `presentation/`, a regra correta passa a ser:

> módulos de fora **podem** depender de `presentation/`, mas **somente via superfícies públicas explícitas**.

## 4.3 Modelo de módulo ideal

Topologia alvo recomendada:

```text
presentation/
  index.js                  # barrel puro da camada shared-edge

  agent/
    index.js
    control.js
    http-errors.js
    runtime.js

  routing/
    index.js
    request.js
    route-deps.js
    targeting.js
    meta.js

  runtime/
    index.js
    capabilities.js
    controls.js
    dialog.js
    health.js
    lifecycle.js
    models.js
    overview.js
    ownership.js
    sdk-session.js
    status.js
    todos.js
    tools.js
    webhooks.js
    fallback-telemetry.js

  state/
    index.js
    realtime.js
    ui-store.js
    ui-state.js

  files/
    index.js
    context.js
    routing.js

  system/
    index.js
    config.js
    metrics.js

  conversation/
    index.js
    hub.js

  sdk/
    index.js
    sessions.js
    recovery-policy.js

  contracts/
    index.js
    types.js
```

---

## 5) Política ideal de imports

## 5.1 Imports externos a `presentation/`

`server/`, `terminal/`, testes e demais consumidores devem migrar progressivamente de leaf files para **sub-barrels explícitos**.

Target desejado:

- `#copilot/presentation`
- `#copilot/presentation/agent`
- `#copilot/presentation/routing`
- `#copilot/presentation/runtime`
- `#copilot/presentation/state`
- `#copilot/presentation/files`
- `#copilot/presentation/system`
- `#copilot/presentation/conversation`
- `#copilot/presentation/sdk`
- `#copilot/presentation/contracts`

E **não**:

- `../../presentation/runtime-request.js`
- `../../presentation/runtime-ui-state-store.js`
- `../../presentation/system-metrics.js`

salvo testes white-box transitórios durante a migração.

## 5.2 Imports internos de `presentation/`

Regra proposta:

- same-folder imports diretos continuam aceitáveis para leaf-private internals;
- cross-folder imports devem passar por sub-barrels;
- o barrel raiz não deve ser consumido de dentro do próprio módulo para evitar acoplamento circular/artificial.

## 5.3 Regra anti-regressão essencial

`presentation/` **não pode importar `terminal/` nem `server/`**.

Ele é a shared edge layer; as bordas consomem `presentation/`, não o inverso.

---

## 6) Política ideal de exports

## 6.1 Root barrel

O root `presentation/index.js` deve exportar **apenas sub-superfícies deliberadas** e, excepcionalmente, alguns símbolos globais muito estáveis.

O target ideal é reduzir bastante os `export *` atuais.

## 6.2 Sub-barrels

Cada sub-barrel deve expor somente o necessário para seu domínio:

- `state/index.js` não deve exportar detalhes acidentais do store;
- `routing/index.js` não deve expor helpers internos de parsing não-canônicos;
- `agent/index.js` não deve reexportar utilitários internos de cada handler;
- `sdk/index.js` não deve misturar projections com detalhes de validação interna.

---

## 7) Ondas recomendadas de migração

## Onda PBF-1 — Taxonomia física inicial

Objetivo:

- criar subpastas semânticas;
- mover arquivos mantendo barrels puros;
- preservar o root `index.js` como barrel puro.

Prioridade recomendada:

1. `state/`
2. `routing/`
3. `system/`
4. `agent/`
5. `runtime/`
6. `files/`, `conversation/`, `sdk/`, `contracts/`

## Onda PBF-2 — Rewiring de consumers

- migrar `server/` para `presentation/routing`, `presentation/agent`, `presentation/system`, `presentation/runtime`;
- migrar `terminal/` para `presentation/state`, `presentation/files`, `presentation/system`, `presentation/runtime`;
- começar a reduzir deep imports em testes.

## Onda PBF-3 — Surface minimization

Foco maior em:

- `state/`
- `routing/`
- `runtime/`
- root `index.js`

> **Status atual:** parcialmente iniciado.
>
> - `agent/runtime/index.js` já estreitou a fronteira entre `agent/` e `runtime/`;
> - `server/` e `terminal/` já deixaram de fazer deep imports nos novos subdomínios barrelizados;
> - ainda falta reduzir o peso deliberado do root `presentation/index.js` e tornar `runtime/index.js` mais explícito.

## Onda PBF-4 — Decomposição dos hotspots

Prioridade absoluta:

1. `agent-control.js`
2. `runtime-ui-state-store.js`
3. `system-metrics.js`
4. `runtime-health.js`
5. `runtime-sdk-session.js`

## Onda PBF-5 — Enforcement automatizado

Adicionar guardrails para:

1. `index.js` barrel-only;
2. imports externos a `presentation/` só via superfícies públicas permitidas;
3. `presentation/` não importa `terminal/` nem `server/`;
4. arquivos acima de thresholds exigem decomposição planejada / ADR local.

> **Status atual:** iniciado nesta rodada com contrato dedicado de governança barrel-first para `presentation/`.

---

## 8) Hotspots que merecem decomposição própria

## 8.1 `agent-control.js`

Este arquivo já justifica **subtaxonomia interna própria**, por exemplo:

```text
presentation/agent/control/
  index.js
  inject.js
  pipeline.js
  dialog.js
  handoff.js
  shared.js
```

## 8.2 `runtime-ui-state-store.js`

Também já justifica corte por responsabilidade:

```text
presentation/state/ui-store/
  index.js
  busy.js
  mailbox.js
  attachments.js
  thinking.js
  toggles.js
  session.js
```

Esses dois eixos não devem ser tratados como simples arquivos grandes; eles já são **mini-domínios operacionais**.

---

## 9) Guardrails arquiteturais recomendados

1. `index.js` nunca contém lógica operacional.
2. `presentation/` não importa `terminal/` nem `server/`.
3. Imports cross-folder em `presentation/` passam por sub-barrels.
4. `server/` e `terminal/` deixam de importar leaf files de `presentation/` quando a superfície pública correspondente existir.
5. O root `presentation/index.js` não deve voltar a crescer como barrel “catch-all”.

---

## 10) Julgamento final

O target certo para `presentation/` **não é copiar mecanicamente o terminal**.

O target correto é:

> **transformar `presentation/` numa shared edge layer barrel-first, com subdomínios explícitos, superfícies públicas estáveis, imports externos via barrels, e sem permitir que a camada se deforme em um segundo runtime plano e sem fronteiras.**

Esse é o análogo correto — e adaptado — da estratégia aplicada com sucesso em `terminal/`.
