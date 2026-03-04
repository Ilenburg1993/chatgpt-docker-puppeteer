# Migração incremental para `strict` 🛡️

Este documento descreve o processo incremental de expansão do `strict` no projeto e os passos
subsequentes para garantir que a base permaneça tipo-segura. O baseline atual continua em JavaScript
com `checkJs`, enquanto a trilha de endurecimento progressivo passa a viver em
`tsconfig.strict.json`. Use as caixas de seleção para acompanhar o progresso.

> **Observação**: este é um fluxograma incremental. Não precisa concluir tudo de uma só vez. O
> objetivo imediato é manter `typecheck` verde no baseline e expandir a cobertura `strict` por
> domínio, sem assumir `strict` global ainda.

---

## 1. Preparação inicial

- [ ] Criar branch de trabalho (`strict/enable` ou similar).
- [ ] Garantir que `npm test` e `npm run typecheck:full` rodem sem erros antes da mudança.
- [ ] Confirmar que o repositório está limpo (`git status`).

## 2. Expandir a trilha estrita

- [ ] Abrir `tsconfig.strict.json`.
- [ ] Revisar o escopo inicial coberto por `strict`.
- [ ] Opcionalmente decidir flags adicionais (por exemplo `noImplicitAny`, `strictNullChecks`,
      etc.).
- [ ] Salvar e confirmar alteração com commit preliminar.

## 3. Executar compilação inicial

- [x] Rodar `npm run typecheck:node`.
- [x] Confirmar que `npm run typecheck:full` continua verde no baseline.
- [x] Anotar todos os erros gerados (importações faltando, `any` implícito, etc.).
  - Resultado inicial: **6175 erros em 276 arquivos**. Muitos deles são parâmetros não tipados,
    propriedades em objetos genéricos e módulos sem declarações de tipos.
  - Após instalação de declarações @types e correções de `package.json` os erros caíram para
    **5875**. Em seguida excluímos a pasta `scripts/` do `tsconfig`, o que reduziu ainda mais para
    **5711 erros em 257 arquivos** — a exclusão de código auxiliar não afetará o build de produção.
  - A próxima fase deve priorizar dependências ausentes de tipo e agrupamentos de erros por domínio
    para atacá‑los de forma incremental.

## 4. Classificação e correção dos erros

- [ ] **Importações/paths**: adicionar declarações de tipo (`*.d.ts`) ou ajustar
      `paths`/dependências.
- [ ] **Arquivos JS**: adicionar `// @ts-check` e preencher JSDoc/tipos.
- [ ] **Variáveis e parâmetros**: declarar tipos explícitos.
- [ ] **Null/undefined**: aplicar guard clauses, `?` ou `!` conforme adequado.
- [ ] **Valores `any`**: substituir por `unknown` ou tipos concretos.
- [ ] Usar `// eslint-disable-next-line` ou `// @ts-ignore` com `TODO` onde correção urgente não for
      possível.

## 5. Ajustes no tsconfig

- [ ] Revisar `include`/`exclude` (ex.: excluir `vitest.config.js`, outros scripts de build).
- [ ] Após grande avanço, considerar setar `"allowJs": false` se for migrar tudo para `.ts`.
- [ ] Habilitar `noEmit` para evitar artefatos inesperados.

## 6. Iterar até zero erros na trilha `strict`

- [ ] Re-executar `npm run typecheck:full` após cada lote de correções.
- [ ] Corrigir erros, commitar e repetir.
- [ ] **Meta parcial:** fazer `npm run typecheck:strict` concluir sem erros nas áreas já incluídas.
- [ ] Expandir o escopo do `tsconfig.strict.json` apenas quando a área atual estiver estável.
- [ ] Só considerar `strict` global quando a trilha incremental estiver madura e sem drift com o
      baseline.
- [ ] **Infra:** atualizar dependência `typescript` para versão mais recente (>=5.10) e anotar no
      changelog/release notes; rodar `npm install` e revalidar compilação.

## 7. Limpeza e validação final

- [ ] Validar com `npm test` e `make git-push-safe`.
- [ ] Atualizar README/DOCUMENTAÇÃO com instruções de tipo e pre-commit hooks.
- [ ] Mover quaisquer `// @ts-ignore` remanescentes para issues ou tags `TODO`.

## 8. Manutenção contínua

- [ ] Adicionar `npm run typecheck:node` como etapa de CI/pre-commit.
- [ ] Sempre corrigir novos erros de tipo quando surgirem em PRs.
- [ ] Periodicamente revisar `tsconfig` para manter configurações atualizadas.

---

> ✅ Este checklist é um guia vivo: marque caixas e expanda com notas conforme a equipe avança.
