# Hub Oficial — Tipagem e JSDoc

> **Última revisão**: 4 de março de 2026 **Status**: Canônico — este diretório é o ponto de entrada
> único para tipagem e JSDoc neste repositório.

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

| Arquivo                     | Papel                                                     |
| --------------------------- | --------------------------------------------------------- |
| `PADROES.md`                | Padrões JSDoc e tipagem TS — o "como fazer" obrigatório   |
| `ROADMAP.md`                | Roadmap de execução ativo (fases, erros, checklist)       |
| `SCRIPTS-E-AUTOMACAO.md`    | Scripts de análise, comandos npm, automações disponíveis  |
| `CONFIGURACOES-TSCONFIG.md` | Arquivos tsconfig, lanes strict, flags e suas implicações |

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

1. **`PADROES.md`** — entenda as regras antes de tocar em qualquer arquivo.
2. **`CONFIGURACOES-TSCONFIG.md`** — entenda as lanes para saber o que o TS verifica onde.
3. **`ROADMAP.md`** — entenda onde estamos e o que é a próxima tarefa.
4. **`SCRIPTS-E-AUTOMACAO.md`** — saiba como medir e auditar o progresso.

---

## Estado corrente (4 de março de 2026)

| Indicador                    | Valor         |
| ---------------------------- | ------------- |
| Arquivos com `// @ts-check`  | **670**       |
| `@ts-nocheck` em código real | **0** ✅       |
| Erros `typecheck:node`       | ~1.956        |
| Erros `typecheck:strict:all` | em medição    |
| Lanes com 0 erros            | **10 de 30**  |
| Fase 0 (JSDoc estrutural)    | ✅ Concluída   |
| Fase A (lanes ≤ 400 erros)   | 1/6 concluída |

Ver `ROADMAP.md` para detalhe completo por lane.

---

## Regra absoluta

> **`// @ts-nocheck` é proibido em qualquer arquivo do repositório, sem exceção.**
>
> Se um arquivo tem erros TS, o caminho é corrigir os erros — não suprimir a verificação. A única
> supressão pontual aceita é `/** @type {any} */ (expr)` com justificativa, ou
> `// @ts-expect-error // justificativa` dentro de allowlist controlada.
