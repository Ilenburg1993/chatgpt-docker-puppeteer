# Copilot Instructions — chatgpt-docker-puppeteer

**Propósito**: contexto operacional e arquitetural para agentes de IA neste repositório. **Status**:
canônico (resumo executivo). **Última atualização**: 2026-03-15.

> Responda em **pt-BR** ao interagir com humanos e ao escrever documentação permanente.

## Hierarquia e resolução de conflitos

Para evitar ambiguidade, use esta ordem:

1. **Hooks executáveis** em `.github/hooks/scripts/*` e `.github/hooks/hooks-lib/*`
2. **Protocolo de hooks** em `.github/instructions/hooks-protocol.instructions.md`
3. **Baseline técnico** em `.github/instructions/project-canon.instructions.md`
4. **Templates operacionais** em `.github/AGENTS.md`
5. Este arquivo (`.github/copilot-instructions.md`) como contexto complementar

> Regra prática: se houver divergência textual, prevalece o comportamento dos hooks + protocolo de
> hooks.

## Sessão, seção e turno (visão curta)

- **SESSION**: unidade longa de trabalho; encerramento é raro e exige fluxo autorizado.
- **TURN**: só pode ser encerrado com autorização ou pedido expresso do usuário.

Para regras completas (templates, chave de encerramento, blocks):

- `.github/instructions/hooks-protocol.instructions.md`
- `.github/AGENTS.md`

## ⛔ REGRA CRÍTICA — task_complete sem vscode_askQuestions está BLOQUEADO

> Esta regra se aplica **sempre**, inclusive após `git push`, commit, ou último TODO.

**Sequência obrigatória ao concluir qualquer trabalho:**
1. Chamar `vscode_askQuestions` (Template A ou G)
2. Aguardar resposta do usuário
3. Apenas em seguida: `task_complete` (se aplicável)

O PreToolUse hook **bloqueia automaticamente** qualquer chamada a `task_complete` se
`vscode_askQuestions` não foi chamado neste turno. Não há como contornar isso.

## Checklist de início/retomada

Antes de atuar no código, ler **e agir conforme** cada item:

1. `.github/hooks/state/session-briefing.md` — extrair:
   - `close_key` → memorizar para uso no Template F quando solicitado encerramento
   - `consecutive_unauthorized` → se ≥ 3, chamar `vscode_askQuestions Template D` imediatamente
   - turno atual e tarefas pendentes → continuar de onde parou
2. `.github/hooks/state/pending-tasks.md` — se existir: retomar a primeira tarefa com status
   `in-progress`. Se **não existir**: prosseguir normalmente (sem tarefas pendentes registradas em
   shell; tarefas Via `manage_todo_list` são independentes deste arquivo).
3. `.github/hooks/state/session.json` — verificar:
   - `pending_session_close=true` → se true, aguardar encerramento via Template F com close_key
   - `compliance.consecutive_unauthorized` → se ≥ 3, regularizar compliance com Template D antes de
     trabalho novo
   - `strict_turn_close=true` (padrão) → confirmar que cada turno termina com `vscode_askQuestions`

### Política para `compliance.consecutive_unauthorized ≥ 3`

Se detectar `consecutive_unauthorized ≥ 3` (via briefing ou `session.json`): **interromper trabalho
em andamento** e chamar `vscode_askQuestions Template D` imediatamente para regularizar compliance
antes de continuar. Não acumular violações — o hook `Stop` emitirá `decision:block` em turnos sem
`vscode_askQuestions` quando `strict_turn_close=true`.

## Projeto em uma frase

Sistema Node.js 24+ (ESM) para orquestração de missões de longa duração com automação de browser,
arquitetura orientada a eventos e foco em confiabilidade operacional.

## Arquitetura (mapa rápido)

- `src/main.js`: bootstrap canônico
- `src/core/`: contratos, schemas, validação
- `src/nerv/`: event bus
- `src/kernel/`: execução e políticas
- `src/orchestrator/`: estratégias de missão
- `src/agent/`: workers internos
- `src/driver/`: atuação browser
- `src/infra/`: pool, FS, storage, queue, locks
- `src/server/`: API/realtime
- `src/missions/`: domínio das missões

## Convenções obrigatórias

- Node.js >= 24 e ESM (`import`/`export`)
- Preservar `"type": "module"` no `package.json`
- Estilo: 4 espaços, 120 colunas, aspas simples, ponto-e-vírgula
- JSDoc robusto em APIs públicas (`@param`, `@returns`, `@throws`)
- Tipagem explícita via JSDoc/TS
- Preferir aliases (`#core/*`, `#infra/*`, `#driver/*`)
- **Não usar `puppeteer.launch()`** neste processo

## Qualidade mínima por mudança

1. `npm run lint`
2. `npm run format:check`
3. `npm run test:unit`
4. Se alterar `driver`/`kernel`/`server`: `npm run test:integration`

## Skills recomendadas por tipo de tarefa

- Auditoria semântica: `code-audit`
- Auditoria + correção: `code-audit-and-fix`
- Governança documental: `documentation-governance`
- Tipagem hardening: `typing-node24-esm-tsserver`
- JSDoc robusto: `jsdoc-authoring`

## Rotas de referência

- Arquitetura oficial: `DOCUMENTAÇÃO/ARQUITETURA/ARCHITECTURE.md`
- Status documental: `DOCUMENTAÇÃO/RELATORIOS/STATUS_GERAL_DOCUMENTACAO.md`
- Bugs e auditorias: `DOCUMENTAÇÃO/BUGS/` e `DOCUMENTAÇÃO/AUDITORIAS/`
- Operações: `DOCUMENTAÇÃO/OPERACOES/`
- Hub .github: `.github/README.md`
