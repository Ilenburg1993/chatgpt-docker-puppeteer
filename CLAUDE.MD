# AGENTS.md — Guia operacional enxuto para agentes

**Status**: canônico para templates e operação prática no workspace. **Última atualização**:
2026-03-15. Este arquivo é SEMPRE OBRIGATÓRIO para agentes de IA operando neste repositório,
servindo como guia tático e fonte de templates de `vscode_askQuestions`. Para regras de lifecycle,
governança e arquitetura, consulte as fontes canônicas listadas no final deste documento. Leia
periodicamente este documento.

> Este arquivo foi reduzido para evitar redundância. Regras duplicadas foram removidas e apontadas
> para fontes únicas.

## Hierarquia oficial de instruções (ordem de referência)

1. **Comportamento executável dos hooks** (`.github/hooks/scripts/*`, `.github/hooks/hooks-lib/*`)
   - É o enforcement real (bloqueios, decisões, auditoria).
2. **Protocolo de lifecycle** (`.github/instructions/hooks-protocol.instructions.md`)
   - Fonte de verdade para SESSION/TURN/SUBTURN.
3. **Baseline técnico do projeto** (`.github/instructions/project-canon.instructions.md`)
   - Runtime, arquitetura, estilo, quality gates.
4. **Este arquivo (`.github/AGENTS.md`)**
   - Templates de `vscode_askQuestions` e playbooks operacionais.
5. **Contexto complementar** (`.github/copilot-instructions.md`)
   - Visão geral do repositório, sem re-declarar protocolo inteiro.

## Regras rápidas de operação, OBRIGATÓRIAS.

- Responder em **pt-BR**.
- Você deve ser proativo, seguindo os protocolos, mas sempre sugerindo e implementando upgrades
  arquiteturais e de processo quando identificar oportunidades (ex.: refactor, modularização,
  automação de tarefas manuais etc), dentre outras coisas, sempre buscando otimizar para ciclos de
  feedback rápidos e redução de trabalho manual.
- Iniciar turno de trabalho com `manage_todo_list`. Tente ter sempre, no mínimo, 10 TODOS. O último
  item do manage_todo_list deve ser SEMPRE chamar tool `vscode_askQuestions`.
- Após cada `vscode_askQuestions`, executar **imediatamente** `manage_todo_list` para atualizar o
  checklist de acordo com a resposta do usuário.
- Preferir blocos contínuos de trabalho (meta operacional: ~10 minutos) antes de checkpoints
  periódicos de continuidade (Template D), sem violar exigências de governança ativa.
- Antes de commit/push: `vscode_askQuestions` **Template G**.
- Evitar utilizar lint, format, ou typecheck como etapas intermediárias sem autorização explícita
  (via Template A ou D) ou solicitação explícita do usuário.
- Encerramento de sessão/turn: **somente Template F + key válida** (via fluxo automático dos hooks).
- É OBRIGATÓRIO, SEMPRE, ATUALIZAR OS TODOS IMEDIATAMENTE, através da tool `manage_todo_list`, APÓS
  O USUÁRIO DAR A RESPOSTA AO `vscode_askQuestions`, DE ACORDO COM A RESPOSTA FORNECIDA PELO
  USUÁRIO.

## É TERMINANTEMENTE PROIBIDO, SEMPRE.

- CONCLUIR UMA SESSION/TURN SEM AUTORIZAÇÃO OU PEDIDO EXPRESSO DO USUÁRIO ATRAVÉS DE SELEÇÃO DE
  OPÇÃO OU FREETEXT ATRAVÉS DA TOOL VSCODE_ASKQUESTIONS. POR DEFAULT, UMA SESSION/TURN NUNCA PODE
  SER ENCERRADO POR DECISÃO AUTÔNOMA DO AGENTE.

- CHAMAR `task_complete` SEM ANTES CHAMAR `vscode_askQuestions` NO MESMO TURNO. **O PreToolUse hook
  bloqueia automaticamente `task_complete` quando `vscode_askQuestions` não foi chamado.** Isso
  inclui turnos após git push, após commit, após último TODO concluído, após qualquer trabalho
  finalizado.

- INTERPRETAR A INSTRUÇÃO DO VS CODE COPILOT DE CHAMAR `task_complete` QUANDO A TAREFA ESTÁ PRONTA
  COMO UMA AUTORIZAÇÃO PARA PULAR vscode_askQuestions. A sequência CORRETA É: concluir trabalho →
  chamar vscode_askQuestions (Template A) → aguardar usuário → depois task_complete.

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
---

## Referências canônicas

- Protocolo de hooks: `.github/instructions/hooks-protocol.instructions.md`
- Baseline técnico: `.github/instructions/project-canon.instructions.md`
- Instruções Copilot (contexto): `.github/copilot-instructions.md`
- Arquitetura oficial: `DOCUMENTAÇÃO/ARQUITETURA/ARCHITECTURE.md`
