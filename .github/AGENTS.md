# AGENTS.md — Guia operacional enxuto para agentes

**Status**: canônico para templates e operação prática no workspace. **Última atualização**:
2026-03-15.

> Este arquivo foi reduzido para evitar redundância. Regras duplicadas foram removidas e apontadas
> para fontes únicas.

## Hierarquia oficial de instruções (ordem de referência)

1. **Comportamento executável dos hooks** (`.github/hooks/scripts/*`, `.github/hooks/hooks-lib/*`)
   - É o enforcement real (bloqueios, decisões, auditoria).
2. **Protocolo de lifecycle** (`.github/instructions/hooks-protocol.instructions.md`)
   - Fonte de verdade para SESSION/SECTION/TURN.
3. **Baseline técnico do projeto** (`.github/instructions/project-canon.instructions.md`)
   - Runtime, arquitetura, estilo, quality gates.
4. **Este arquivo (`.github/AGENTS.md`)**
   - Templates de `vscode_askQuestions` e playbooks operacionais.
5. **Contexto complementar** (`.github/copilot-instructions.md`)
   - Visão geral do repositório, sem re-declarar protocolo inteiro.

## Regras rápidas de operação

- Responder em **pt-BR**.
- Iniciar turno de trabalho com `manage_todo_list`.
- Encerrar turno com `vscode_askQuestions` (último ato útil).
- Antes de commit/push: `vscode_askQuestions` **Template G**.
- Encerramento de sessão: **somente Template F + key válida** (via fluxo automático dos hooks).

## Checklist obrigatório no início/retomada

Ler com `read_file`:

1. `.github/hooks/state/session-briefing.md`
2. `.github/hooks/state/pending-tasks.md`
3. `.github/hooks/state/session-context.json`

> Os hooks auditam essa leitura e podem bloquear fechamento de TURN se pendências existirem.

## Templates `vscode_askQuestions`

### Template A — Próximo passo (pós tarefa)

```json
[
  {
    "header": "Próxima ação",
    "question": "✅ Concluí: [RESUMO_CURTO]. Qual próximo passo?",
    "allowFreeformInput": true,
    "options": [
      { "label": "Seguir próxima tarefa do backlog", "recommended": true },
      { "label": "Executar validações (lint/test/typecheck)" },
      { "label": "Preparar commit/push (Template G)" },
      { "label": "Mudar foco de módulo" }
    ]
  }
]
```

### Template B — Descoberta de bugs (≥3 achados)

```json
[
  {
    "header": "Ação sobre bugs",
    "question": "🔍 Encontrei [N] bugs em [MODULO]. Como proceder?",
    "multiSelect": true,
    "options": [
      { "label": "Corrigir todos agora" },
      { "label": "Corrigir apenas críticos/high" },
      { "label": "Gerar relatório e backlog" },
      { "label": "Adicionar testes de regressão" }
    ]
  }
]
```

### Template C — Proposta de upgrade arquitetural

```json
[
  {
    "header": "Proposta de upgrade",
    "question": "💡 Proposta: [RESUMO]. Executar agora?",
    "options": [
      { "label": "Executar agora em etapas", "recommended": true },
      { "label": "Mostrar plano detalhado antes" },
      { "label": "Adicionar ao backlog (alta)" },
      { "label": "Não executar por enquanto" }
    ]
  }
]
```

### Template D — Checkpoint periódico

```json
[
  {
    "header": "Checkpoint",
    "question": "📍 Checkpoint [TURN]. [RESUMO]. Continuo em qual direção?",
    "allowFreeformInput": true,
    "options": [
      { "label": "Continuar no plano atual", "recommended": true },
      { "label": "Trocar foco de módulo" },
      { "label": "Executar validações antes de continuar" },
      { "label": "Preparar commit/push (Template G)" }
    ]
  }
]
```

### Template E — Kickoff de sessão

```json
[
  {
    "header": "Kickoff da sessão",
    "question": "Sessão iniciada. Priorizo backlog, auditoria ou correção de bugs?",
    "options": [
      { "label": "Backlog (alta → média → backlog)", "recommended": true },
      { "label": "Auditoria profunda do módulo atual" },
      { "label": "Correção imediata de bugs críticos" },
      { "label": "Aguardar instrução explícita" }
    ]
  }
]
```

### Template F — Encerramento de SESSION (uso restrito)

```json
[
  {
    "header": "🔐 Encerrar SESSION",
    "question": "Close key: [CLOSE_KEY]. Digite a chave no campo livre para confirmar o encerramento.",
    "allowFreeformInput": true,
    "options": [
      { "label": "Cancelar e continuar trabalhando", "recommended": true },
      { "label": "Encerrar sessão agora" }
    ]
  }
]
```

### Template G — Pré-autorização de commit/push

```json
[
  {
    "header": "Pré-autorização git",
    "question": "Mudanças: [N_MOD] mod / [N_NEW] novos / [N_DEL] removidos. Lint=[L] Test=[T] Typecheck=[TC]. Prosseguir?",
    "allowFreeformInput": true,
    "options": [
      { "label": "Commitar e pushar agora" },
      { "label": "Apenas commitar agora" },
      { "label": "Revisar mais antes de commit" },
      { "label": "Rodar validações novamente" }
    ]
  }
]
```

## Quality gates mínimos

1. `npm run lint`
2. `npm run format:check`
3. `npm run test:unit`
4. Se tocar `driver`/`kernel`/`server`: `npm run test:integration`

## Referências canônicas

- Protocolo de hooks: `.github/instructions/hooks-protocol.instructions.md`
- Baseline técnico: `.github/instructions/project-canon.instructions.md`
- Instruções Copilot (contexto): `.github/copilot-instructions.md`
- Arquitetura oficial: `DOCUMENTAÇÃO/ARQUITETURA/ARCHITECTURE.md`
