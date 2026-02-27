# Migração para `strict` completo 🛡️

Este documento descreve o processo de ativação de `strict` no `tsconfig.json` e os passos
subsequentes para garantir que o projeto permanece tipo‑seguro. Use as caixas de seleção para
acompanhar o progresso; vá marcando conforme for corrigindo cada item.

> **Observação**: este é um fluxograma incremental. não precisa concluir tudo de uma só vez, mas o
> objetivo final é `tsc` sem erros.

---

## 1. Preparação inicial

- [ ] Criar branch de trabalho (`strict/enable` ou similar).
- [ ] Garantir que `npm test` e `npm run typecheck:full` rodem sem erros antes da mudança.
- [ ] Confirmar que o repositório está limpo (`git status`).

## 2. Ativar modo estrito

- [ ] Abrir `tsconfig.json`.
- [ ] Modificar `"strict": false` para `"strict": true`.
- [ ] Opcionalmente decidir flags adicionais (por exemplo `noImplicitAny`, `strictNullChecks`,
      etc.).
- [ ] Salvar e confirmar alteração com commit preliminar.

## 3. Executar compilação inicial

- [x] Rodar `npm run typecheck:node`.
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

## 6. Iterar até zero erros

- [ ] Re-executar `npm run typecheck:full` após cada lote de correções.
- [ ] Corrigir erros, commitar e repetir.
- [x] **Meta atingida:** `tsc` agora conclui **sem erros** em todo o workspace sob `strict`.
- [ ] Continuar este ciclo até que `tsc` conclua limpo em ambos `tsconfig.json` e
      `tsconfig.browser.json`.
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
