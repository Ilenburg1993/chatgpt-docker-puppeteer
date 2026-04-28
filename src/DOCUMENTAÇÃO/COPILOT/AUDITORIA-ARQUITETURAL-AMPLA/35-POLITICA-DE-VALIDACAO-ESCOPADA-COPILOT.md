# 35 — Política de Validação Escopada da Revolução (`src/copilot`)

**Status**: decisão operacional ativa **Última atualização**: 2026-04-27 **Escopo**: todas as ondas
da revolução arquitetural de `src/copilot/`

---

## 1. Decisão

Fica registrada a seguinte política operacional para validação durante a revolução arquitetural de
`src/copilot/`:

1. o **escopo máximo** de typecheck/lint/format/testes estruturais deve ser `src/copilot/` e seus
   testes/documentos diretamente relacionados;
2. o **escopo mínimo** deve ser o conjunto de arquivos efetivamente criados/editados no worktree da
   onda atual;
3. não devemos disparar varreduras de repositório inteiro quando o objetivo da onda está restrito a
   `src/copilot/`;
4. a validação deve começar sempre pelo menor conjunto que preserve segurança arquitetural e só
   escalar para `src/copilot/**` quando necessário.

---

## 2. Motivação

Esta decisão existe para:

- reduzir tempo de feedback;
- aumentar cadência de ondas curtas e verificáveis;
- impedir que a revolução arquitetural fique refém do custo de validações fora do subsistema alvo;
- manter disciplina metodológica durante o programa longo descrito nos documentos 23 e 24.

---

## 3. Regra prática

### Nível mínimo

- `prettier --check <arquivos editados>`
- `eslint <arquivos editados>` quando tecnicamente viável
- lote focado de testes diretamente ligados aos arquivos alterados

### Nível intermediário

- `prettier --check src/copilot/...` da subárvore tocada
- `eslint src/copilot/...` da subárvore tocada
- `tsc`/testes focados do módulo owner afetado

### Nível máximo permitido nesta fase

- `src/copilot/**`
- testes unitários/contratuais de `tests/unit/copilot/**`
- documentos em `src/DOCUMENTAÇÃO/COPILOT/**` quando a onda tocar auditoria/arquitetura

---

## 4. Aplicação por tipo de mudança

| Tipo de mudança   | Validação mínima recomendada                                      |
| ----------------- | ----------------------------------------------------------------- |
| Wrapper SDK       | arquivos editados + testes `tests/unit/copilot/sdk/**` correlatos |
| Runtime `agent/`  | arquivos editados + testes `tests/unit/copilot/test_*` correlatos |
| Boot/config       | arquivos editados + `test_boot_*`/`config/*` correlatos           |
| Docs da auditoria | markdown tocado + índice/README correlato                         |
| Gates estruturais | script/gate + contract tests correlatos                           |

---

## 5. Invariante operacional

> Durante a revolução de `src/copilot/`, validar menos não significa validar frouxamente; significa
> validar com escopo deliberado e proporcional ao owner tocado.

---

## 6. Próximos passos

Esta política deve ser referenciada nas próximas ondas do Bloco B em diante sempre que a estratégia
de validação for descrita nos checkpoints da auditoria.
