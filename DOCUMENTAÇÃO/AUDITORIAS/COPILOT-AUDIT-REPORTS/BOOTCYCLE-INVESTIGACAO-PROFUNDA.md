# Investigação Profunda — Bootcycle e Radar Sistêmico de `src/copilot`

## Escopo e ponto de partida

Auditoria iniciada pelo bootcycle solicitado:

1. VS Code Task `terminal:llm-b` → `.vscode/tasks.json:431-433`
2. Script npm `terminal:llm-b` → `package.json:471`
3. Entrypoint `src/copilot/terminal/bootstrap.js`
4. Orquestração de boot `src/copilot/boot/runtime-bootstrap.js`
5. Plano executável `src/copilot/boot/plan.js` + runner `src/copilot/boot/lifecycle-runner.js`
6. Composition root terminal `src/copilot/terminal/runtime-root.js`
7. Fases de terminal em `src/copilot/terminal/terminal-phases/*`

Também foi feita varredura transversal em todo `src/copilot` para padrões de risco estrutural.

---

## Fluxo canônico confirmado

O fluxo canônico está coerente com contrato e docs (`src/copilot/boot/contract.js`, `src/copilot/README.md`):

`terminal:llm-b` → `terminal/bootstrap.js` → `boot/runtime-bootstrap.js` → `runCopilotBootPlan()` → fases explícitas (`observability` … `repl`).

Ponto forte: a trilha de boot está centralizada e validada por `assertCopilotBootSurfaces(...)`.

---

## Achados principais (bugs, gaps e riscos)

| ID | Tipo | Severidade | Evidência | Impacto |
|---|---|---|---|---|
| BUG-TERM-001 | Sinal/shutdown | P1 | `src/copilot/terminal/bootstrap-lifecycle.js:53-54` | `SIGINT` só é registrado quando `!stdin.isTTY`; em terminal interativo o shutdown central pode não rodar no Ctrl+C. |
| GAP-BOOT-001 | Observabilidade | P2 | `src/copilot/boot/runtime-bootstrap.js:138-143` | `catch {}` na fase `observability` suprime erro de persistência SQLite sem emitir evento estruturado de degradação. |
| LEAK-TERM-001 | Crescimento de estado | P2 | `src/copilot/terminal/dev-watch.js:187-189` | `_status.changedFiles` cresce sem limite em sessões longas com muitas mudanças (risco de crescimento de memória). |
| ARCH-BOOT-001 | Contrato vs runtime | P3 | `src/copilot/boot/config.js` + `src/copilot/boot/plan.js` | `terminal.enabled` é declarativo (não gateia boot), o que pode gerar leitura equivocada de governança operacional. |

---

## Radar sistêmico de todo `src/copilot`

Varredura textual ampla (não substitui leitura semântica arquivo-a-arquivo):

- Inicializações de `Map`: **125** ocorrências (`rg -o 'new Map\(' src/copilot`).
- `catch {}` vazio: **187** ocorrências (`rg -o 'catch\s*\{' src/copilot`).
- I/O síncrono (`readFileSync|writeFileSync`): **16** ocorrências.
- Referências a `@github/copilot-sdk`: **201** ocorrências; fora de `src/copilot/sdk/*`, **7** ocorrências (predominantemente tipagem/docs/introspection).

Leitura arquitetural:

- A base já avançou para SSOT de boot.
- Ainda há superfície relevante para hardening de erro explícito e governança de estado em runtime longo.

---

## Oportunidades de upgrade priorizadas

1. **UPG-TERM-001 (P1)** — Registrar `SIGINT` também em TTY com política explícita (inclusive quando REPL estiver ativo), garantindo shutdown canônico sempre.
2. **UPG-BOOT-001 (P1)** — Trocar `catch {}` de SQLite por evento `runtime.boot.degraded` com causa estruturada + contador em métricas de boot.
3. **UPG-TERM-002 (P2)** — Limitar `_status.changedFiles` (cap configurável + política FIFO) e expor métricas de truncamento.
4. **UPG-OBS-001 (P2)** — Criar regra de observabilidade para `catch` vazio em caminhos de boot/runtime (erro não pode sumir sem trilha).
5. **UPG-ARCH-001 (P3)** — Formalizar em contrato que `terminal.enabled` é somente declarativo (ou promover a flag para gate real, com comportamento consistente).

---

## Testabilidade e cobertura da trilha de boot

Há cobertura unitária relevante para boot (`tests/unit/copilot/test_bootstrap.spec.js`, `test_boot_config.spec.js`, `test_boot_surface_validation.spec.js`, `terminal/test_boot_reflection_loop.spec.js`, `terminal/test_terminal_bootstrap_lifecycle.spec.js`).

Gap de valor: adicionar cenários específicos para **SIGINT em TTY** e para **degradação de SQLite na fase `observability` com emissão de evento canônico**.

---

## Conclusão objetiva

A arquitetura de boot está bem consolidada e canônica, mas há três pontos prioritários para elevar robustez operacional imediata: **tratamento de SIGINT em TTY**, **erro explícito na degradação SQLite** e **controle de crescimento do estado do dev-watch**.
