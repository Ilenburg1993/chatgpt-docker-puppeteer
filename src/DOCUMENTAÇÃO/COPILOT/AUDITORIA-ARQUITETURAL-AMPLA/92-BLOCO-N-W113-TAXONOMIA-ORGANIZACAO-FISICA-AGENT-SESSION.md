# 92 — Bloco N / W113: taxonomia de organização física em `agent/session`

**Data:** 2026-04-30 **Escopo:** `src/copilot/agent/session/` **Status:** migração física W113
consolidada sem shims

---

## 1) Problema validado

`src/copilot/agent/session/` reúne responsabilidades diferentes no mesmo nível físico:

- `initializer.js` é o ponto primário de criação/retomada de sessão;
- `boot-wiring.js` coordena o pipeline pós-init;
- `boot-steps.js`, `boot-session-prep.js`, `boot-dialog-recovery.js` e `boot-runtime-bind.js` são
  substeps de boot;
- `keepalive.js`, `cleanup.js` e `rotation.js` são lifecycle/policy operacional;
- `event-wirer.js` conecta eventos SDK;
- `history-sync.js` sincroniza histórico;
- `hook-context.js` monta contexto/briefing;
- `ownership.js`, `snapshot.js` e `snapshot-store.js` cuidam de estado e persistência auxiliar.

O diretório era funcional, mas sem inventário executável ficava difícil distinguir owner primário de
detalhe interno antes de novos refactors. Além disso, a raiz plana escondia responsabilidades
distintas no mesmo nível de leitura.

---

## 2) Decisão arquitetural W113

Foi aplicado o mesmo padrão já validado em `agent/dialog`:

1. `README.md` local para navegação humana;
2. `module-map.js` local para inventário executável de papéis, tiers e public/private;
3. contrato unitário que compara o mapa com a árvore real e impede arquivos órfãos.
4. migração física dos owners reais para subpastas semânticas;
5. remoção imediata de shims temporários, com contrato anti-raiz antiga.

Ao final da onda, `agent/session` não preserva arquivos funcionais soltos na raiz. A raiz fica
restrita a `README.md`, `index.js` e `module-map.js`.

---

## 3) Taxonomia aplicada ao session

| Papel         | Significado                                            |
| ------------- | ------------------------------------------------------ |
| `entrypoint`  | superfície pública ou inventário canônico do diretório |
| `initializer` | criação/retomada da sessão SDK persistente             |
| `boot`        | runner, barrel e substeps do boot pós-init             |
| `lifecycle`   | keepalive, cleanup e rotação de sessão                 |
| `wiring`      | ligação de eventos SDK                                 |
| `history`     | sincronização de histórico e cache de mensagens        |
| `context`     | construção/sanitização de briefing e contexto de hooks |
| `state`       | ownership e snapshots                                  |

Tiers:

- `primary`: primeiro nível de leitura e ownership;
- `secondary`: suporte com papel explícito;
- `internal`: detalhe de implementação, normalmente não exportado publicamente.

---

## 4) Estrutura consolidada

```text
src/copilot/agent/session/
  README.md
  index.js
  module-map.js
  boot/
    boot-dialog-recovery.js
    boot-runtime-bind.js
    boot-session-prep.js
    boot-steps.js
    boot-wiring.js
  context/
    hook-context.js
  history/
    history-sync.js
  initializers/
    initializer.js
  lifecycle/
    cleanup.js
    keepalive.js
    rotation.js
  state/
    ownership.js
    snapshot.js
    snapshot-store.js
  wiring/
    event-wirer.js
```

O sub-barrel `index.js` continua sendo a superfície pública do subsistema; consumidores internos
profundos que precisam testar seams específicos importam o caminho semântico real em vez de shims.

## 5) Arquivos e contratos adicionados

Exports adicionados ao sub-barrel:

- `SESSION_MODULE_LAYOUT`;
- `getSessionModuleDescriptor()`;
- `getSessionModuleRole()`;
- `listSessionModulesByRole()`.

Contrato ampliado:

- `tests/unit/copilot/contracts/test_module_layout_governance.spec.js` cobre presença/ausência dos
  arquivos declarados, papéis documentados no README, boot decomposto e ausência de shims de raiz.

---

## 6) Roadmap local

1. W113.1 — mapa executável e README local: concluído neste checkpoint.
2. W113.2 — contrato anti-órfão para `agent/session`: concluído neste checkpoint.
3. W113.3 — mover `boot-*` para `session/boot/`: concluído sem shims persistentes.
4. W113.4 — mover `keepalive`, `cleanup`, `rotation` para `session/lifecycle/`: concluído.
5. W113.5 — mover `ownership`, `snapshot`, `snapshot-store` para `session/state/`: concluído.
6. W113.6 — mover `event-wirer`, `history-sync`, `hook-context` para suas subpastas semânticas:
   concluído.
7. W113.7 — migrar imports internos para caminhos finais e adicionar contrato anti-import de shims:
   concluído para raiz antiga de `session`.
8. W113.8 — próxima revisão: atualizar inventários históricos/scorecards globais quando a onda N
   fechar `agent/lifecycle`, `server` e `terminal`, evitando reescrever documentos antigos a cada
   movimentação parcial.

---

## 7) Critérios objetivos de conclusão

- nenhum arquivo JS em `agent/session` existe sem entrada em `module-map.js`;
- `README.md` documenta todos os papéis declarados;
- `index.js` exporta apenas superfície pública e inventários canônicos;
- boot, lifecycle, state, context e wiring não voltam a se misturar em novos arquivos;
- a raiz antiga (`initializer.js`, `boot-wiring.js`, `event-wirer.js`, etc.) permanece sem shims;
- futuros shims temporários têm remoção registrada e testável no mesmo turno em que forem criados.
