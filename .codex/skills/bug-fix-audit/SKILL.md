---
name: bug-fix-audit
user-invokable: true
description:
  'Skill para conduzir auditoria focada em correção de bugs operacionais. Inclui triagem
  automatizada, leitura cognitiva do código, proposição de patch e aplicação de correções. A LLM é
  responsável por gerar o README do componente analisado se ele não existir, de modo a documentar
  propósito e contexto.'
---

# bug-fix-audit

## Overview

Use este skill quando houver um defeito relatado (log, crash, comportamento estranho) e você precisa
identificar a origem rapidamente, propor e aplicar uma solução mínima viável. O fluxo segue as três
grandes etapas do plano mestre: Identificação → Proposta → Aplicação.

Ele se apoia no sistema de auditoria (`scripts/audit/runner.mjs`) para coletar evidências, mas a
maior parte do trabalho é uma análise guiada por LLM que também produz documentação (por exemplo,
READMEs para funções/módulos sem descrição).

## Pré‑requisitos

- PM2, MCP, RAG e LSP devem estar saudáveis; execute `npm run audit:preflight` (via
  `audit-runbook-observability`) antes de iniciar.
- O workspace deve estar atualizado (`git pull && npm install`).
- Tools MCP precisam estar acessíveis (`tools/call`).

## Checklist passo a passo

### fase 1 – identificação

1. Iniciar pré‑verificação operacional (rodar `npm run audit:preflight`).
2. Explorar o log/bug report para extrair palavras‑chave (stack trace, erro, arquivo).
3. Executar o audit runner com foco em runtime/estático:
   ```bash
   npm run audit:quick -- --focus bug-first --contracts-domains=runtime,static
   ```
4. Usar `rag_search` para recuperar trechos de código relacionados às keywords.
5. Executar `lsp_diagnostics` e `lsp_definition` nos arquivos suspeitos para ver erros e pontos de
   definição.
6. **Leitura LLM**: para cada arquivo/trecho crítico, envie snippet usando o prompt padrão (ver
   protocolo abaixo). Instrua explicitamente a LLM a descrever a finalidade do código e a produzir
   ou atualizar um pequeno README que explique o componente.
   - _Prompt exemplar_:
     `Você é um auditor de código. Antes de mais nada, identifique a intenção deste código e escreva um parágrafo README explicando o que ele deve fazer. Em seguida, avalie validações, casos de borda, recursos não liberados e sugira melhorias.`
7. Registrar todas as observações num arquivo `audit/bug-fix-<timestamp>.md`.

### fase 2 – proposta

1. Agregar achados e priorizar via triagem LLM (`triageFindings` ou `scripts/audit/triage_llm.mjs`).
2. Para cada item crítico, gerar sugestão de patch automática (p.ex. usando `patch_suggester`) ou
   escrever alteração manual.
3. Se o problema for causado por dependência ou versão, planejar upgrade e anotar no roadmap
   (`DOCUMENTAÇÃO/BUGS/ROADMAP.md`).
4. Criar issue/PR com descrição do bug, evidências e patch proposto. Incluir README gerado pela LLM
   como parte da explicação.

### fase 3 – aplicação

1. Checar o patch localmente: rodar `npm test` e, se aplicável, integração.
2. Reexecutar o audit runner (`npm run audit:quick` ou `audit:deep`) para confirmar que o finding
   original desapareceu.
3. Atualizar snapshot (`npm run audit:publish-snapshot`) e a planilha de tracker.
4. Fechar issue/PR ou marcar review como aprovado; anotar alteração no changelog.
5. Documentar no README do projeto (pasta `DOCUMENTAÇÃO/BUGS/rodadas`).

## Ferramentas

- `npm run audit:quick` / `audit:deep`
- `rag_search`, `lsp_definition`, `lsp_diagnostics` MCP tools
- `scripts/audit/triage_llm.mjs` e `patch_suggester`
- `git` para branch/PR

## Protocolo LLM (resumo)

1. Receba snippet (<=200 linhas) com comentário `// file: …`.
2. Identifique finalidade/intenção, escreva parágrafo README se ausente.
3. Avalie validações, fluxo, recursos e anote gaps.
4. Sugira código de correção breve (diff) e indique risco/regressão.

O prompt pode ser reutilizado nas demais fases para geração de patches ou documentação.

## Categorias de bugs/incompletudes

- Nulidade/validação insuficiente em inputs de rota
- Paths de erro não tratados em workflows assíncronos
- Listeners/eventos não removidos
- TODOs ou estruturas vazias indicando código faltante
- Comportamento divergente de comentários/descritivos

## Done criteria

- Bug reproduzido e sua causa raiz explicada num README
- Patch implementado e validado com testes
- Auditoria rerun não retorna o finding original
- Issue fechada e snapshot atualizado

## Fallbacks

- Se leitura LLM falha (erro ou interpretação vaga), peça revisão manual em pares
- Se patch automático não compila, recolher diff e encaminhar para revisor humano

---

_Não se esqueça de sincronizar a pasta `.codex/skills` e regenerar o índice se necessário._
