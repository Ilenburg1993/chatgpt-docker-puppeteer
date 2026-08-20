# Hub Oficial — Tipagem e JSDoc

> **Última revisão**: 7 de março de 2026 **Status**: Canônico — este diretório é o ponto de entrada
> único para tipagem e JSDoc neste repositório. **Estado atual**: Fases 0–D concluídas.
> `strict: true` ativo globalmente. 41 lanes com 0 erros. `typecheck:repo` = 0 erros.

---

## O que é este diretório

`DOCUMENTAÇÃO/TIPAGEM E JSDOC/` consolida tudo o que um agente ou desenvolvedor precisa saber para
trabalhar com tipagem e JSDoc neste repositório:

- Os **padrões** que devemos seguir (o "como fazer")
- O **roadmap de execução** ativo (onde estamos, o que falta)
- Os **scripts e automações** disponíveis
- As **configurações tsconfig** e lanes de verificação

---

## Documentos deste hub

| Arquivo                                                           | Papel                                                                  |
| ----------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `../PLANOS/MIGRACAO_TYPESCRIPT_7_WORKSPACE_ROADMAP_2026-08-19.md` | Roadmap ativo da migração TS7 do workspace                             |
| `PADROES.md`                                                      | Padrões JSDoc e tipagem TS — o "como fazer" obrigatório                |
| `ROADMAP.md`                                                      | Roadmap de execução ativo (fases, erros, checklist)                    |
| `SCRIPTS-E-AUTOMACAO.md`                                          | Scripts de análise, comandos npm, automações disponíveis               |
| `CONFIGURACOES-TSCONFIG.md`                                       | Arquivos tsconfig, 41 lanes strict, flags e suas implicações           |
| `SISTEMA-TIPAGEM-COMPLETO.md`                                     | 📖 Guia completo do sistema — arquitetura, fluxo, todos os componentes |
| `AUDITORIA-2026-03-07.md`                                         | Auditoria completa do sistema (7 mar 2026) — Fases 0–D ✅ — **Atual**  |
| `AUDITORIA-2026-03-06.md`                                         | Auditoria anterior (6 mar 2026) — histórico                            |

---

## Referência canônica de governança

Para regras de governança de documentos, contrato de automação e change control, consulte:

- [`../REFERENCIA/TYPING_JSDOC_CANON.md`](../REFERENCIA/TYPING_JSDOC_CANON.md) — canon normativo
- [`../REFERENCIA/TYPING_AUTOMATION_INDEX.md`](../REFERENCIA/TYPING_AUTOMATION_INDEX.md) — índice de
  automação canônica
- [`../REFERENCIA/TYPING_CONTRACT_MATRIX.md`](../REFERENCIA/TYPING_CONTRACT_MATRIX.md) — mapa de
  propriedade por contrato
- [`../REFERENCIA/TYPING_SCHEMA_TSSERVER_CANON.md`](../REFERENCIA/TYPING_SCHEMA_TSSERVER_CANON.md) —
  camada de schemas

Skills de apoio (carregar antes de executar):

- `.github/skills/jsdoc-authoring/SKILL.md`
- `.github/skills/typing-node24-esm-tsserver/SKILL.md`

---

## Ordem de leitura recomendada

1. **`SISTEMA-TIPAGEM-COMPLETO.md`** — visão geral completa do sistema de tipagem (novo).
2. **`PADROES.md`** — entenda as regras antes de tocar em qualquer arquivo.
3. **`CONFIGURACOES-TSCONFIG.md`** — entenda as lanes para saber o que o TS verifica onde.
4. **`ROADMAP.md`** — entenda onde estamos e o que é a próxima tarefa.
5. **`SCRIPTS-E-AUTOMACAO.md`** — saiba como medir e auditar o progresso.

---

## Estado corrente (7 de março de 2026) — 🎉 FASES 0–D CONCLUÍDAS

| Indicador                           | Valor                                       |
| ----------------------------------- | ------------------------------------------- |
| TypeScript                          | **5.9.3**                                   |
| Node.js                             | **v24.13.0**                                |
| Arquivos com `// @ts-check`         | **721** (src/ + tests/ + scripts/ + tools/) |
| `@ts-nocheck` em código real        | **0** ✅                                    |
| `@ts-ignore` em código real         | **0** ✅                                    |
| Erros `typecheck:node`              | **0** ✅                                    |
| Erros `typecheck:tools`             | **0** ✅                                    |
| Erros `typecheck:browser`           | **0** ✅                                    |
| Erros `typecheck:tests`             | **0** ✅                                    |
| Erros `typecheck:isolated`          | **0** ✅                                    |
| Erros `typecheck:strict:all`        | **0** ✅ (41/41 lanes)                      |
| `strict: true` em tsconfig.base     | **sim** ✅ (Fase D concluída)               |
| JSDoc cobertura de exports          | **100%** (1.115/1.115)                      |
| `unsafe_generic_tags` (JSDoc)       | **511** — reduzir em Fase E                 |
| `functions_missing_options_typedef` | **52** — corrigir em Fase E                 |
| `@type {any}` em src/               | **~3.276** — reduzir em Fase E              |
| Fase 0 (JSDoc estrutural)           | ✅ Concluída                                |
| Grupos 1–2 (30 lanes)               | ✅ Concluídas                               |
| Fase D (strict base + tests)        | ✅ Concluída (7/3/2026)                     |
| Fase E (any reduction + @import)    | ⬜ Próxima fase                             |

Ver `ROADMAP.md` para detalhe completo por lane e `AUDITORIA-2026-03-07.md` para análise profunda.
Ver `SISTEMA-TIPAGEM-COMPLETO.md` para a visão arquitetural completa do sistema.

---

## Regra absoluta

> **`// @ts-nocheck` é proibido em qualquer arquivo do repositório, sem exceção.**
>
> Se um arquivo tem erros TS, o caminho é corrigir os erros — não suprimir a verificação. A única
> supressão pontual aceita é `/** @type {any} */ (expr)` com justificativa, ou
> `// @ts-expect-error // justificativa` dentro de allowlist controlada.
