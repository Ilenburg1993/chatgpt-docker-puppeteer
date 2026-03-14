# Arquitetura Canônica — SESSION, SECTION, TURN e SUBTURN (Hooks Copilot)

**Status**: Proposta canônica para consolidação (pré-onda P1/P2)
**Data**: 2026-03-13
**Escopo**: comportamento semântico e contrato operacional do ciclo de vida em hooks

---

## 1) Fontes normativas usadas

1. **VS Code (oficial, Preview)** — Agent hooks (`SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `PreCompact`, `SubagentStart`, `SubagentStop`, `Stop`) e `stop_hook_active`.
2. **GitHub Docs** — hooks configuration e boas práticas operacionais.
3. **Documentação interna** — `DOCUMENTAÇÃO/HOOKS/GUIA-HOOKS-COPILOT.md`.
4. **Verdade executável (As-Is)** — scripts:
   - `.github/hooks/scripts/session-start.sh`
   - `.github/hooks/scripts/log-prompt.sh`
   - `.github/hooks/scripts/agent-stop.sh`
   - `.github/hooks/scripts/pre-tool-use.sh`
   - `.github/hooks/scripts/post-tool-use.sh`
   - `.github/hooks/scripts/session-close.sh`
   - `.github/hooks/scripts/session-end.sh`
   - `.github/hooks/scripts/start-section.sh`
   - `.github/hooks/scripts/section-end.sh`
   - `.github/hooks/scripts/start-turn.sh`
   - `.github/hooks/scripts/subagent-start.sh`
   - `.github/hooks/scripts/subagent-stop.sh`

> Princípio de precedência: **comportamento real dos scripts + eventos nativos do VS Code** prevalece sobre texto instrucional divergente.

---

## 2) Definições canônicas

### 2.1 SESSION (nível plataforma)

**SESSION** é a conversa do Copilot Chat no VS Code, identificada por `session_id` nativo.

- `session_id` é a **fonte de verdade** da plataforma.
- `SessionStart` abre sessão nova (tipicamente via Nova Conversa).
- `SessionEnd` pode ocorrer no fechamento, mas é menos confiável em encerramentos abruptos.

**Regra canônica S1**: nenhum componente local deve “inventar” identidade de sessão quando o `session_id` nativo está disponível.

### 2.2 SESSION lógica (nível repositório)

O projeto mantém `session-context*.json` com metadados de governança (close key, stats, seção atual, etc.).

**Regra canônica S2**: `session.id` local deve ser tratado como espelho do `session_id` do VS Code sempre que possível; qualquer `heal` deve convergir para esse valor.

**Regra canônica S3**: no modelo operacional deste repositório, o fim de TURN interrompe a sessão de
execução corrente, que pode ser retomada no mesmo chat por novo prompt (mesmo `session_id` de
plataforma).

### 2.3 SECTION (nível semântico)

**SECTION** é fase de trabalho nomeada (ex.: análise, implementação, revisão). Não existe nativamente na plataforma.

- Abertura principal: `start-section.sh`.
- Fechamento: `section-end.sh` (manual) ou auto-fecho por `start-section.sh` / `session-end.sh`.

**Regra canônica C1**: SECTION é autônoma do agente (não depende de autorização do usuário para transição).

### 2.4 TURN (nível de ciclo de execução)

**TURN** é um ciclo de execução do agente até o evento `Stop`.

- `UserPromptSubmit` pode iniciar TURN, mas não é o único gatilho observável em fluxos com ferramentas interativas.
- `Stop` representa ponto de término do ciclo atual do agente.
- O encerramento legítimo de TURN exige `vscode_askQuestions` como último ato do turno **e**
  validação da key correta da sessão no fluxo autorizado.
- Após fechado, o TURN **não pode ser retomado**.

**Regra canônica T1**: TURN é encerramento operacional do ciclo do agente, distinto de SESSION.
**Regra canônica T2**: fim de TURN interrompe a sessão de execução corrente.
**Regra canônica T3**: retomada ocorre por novo TURN na mesma SESSION (novo prompt/novo ciclo), nunca por reabertura de TURN fechado.

### 2.5 SUBTURN (nível interno do TURN)

**SUBTURN** é uma subdivisão interna do TURN para modelar reentrâncias e continuidade dentro do mesmo turno lógico.

Casos típicos:
1. `Stop` bloqueado (`decision:block`) e retomada posterior (`stop_hook_active=true`).
2. Delegação para subagente (`runSubagent`/`search_subagent`) com retomada do pai.
3. Espera por retorno de ferramenta interativa sem iniciar nova sessão.

**Regra canônica ST1**: SUBTURN **não** cria novo TURN; é iteração do mesmo TURN.
**Regra canônica ST2**: SUBTURN é sempre subordinado ao TURN pai e nunca pode ultrapassar o ciclo
de vida do TURN.

**Representação atual (As-Is)**: parcialmente via `current_turn.agentStop_invocations`, `stop_hook_active` e eventos de subagente.

---

## 3) Invariantes arquiteturais

### I1 — Identidade de sessão

- `session_id` do VS Code é soberano.
- Heals e reconciliações devem convergir para o ID nativo.

### I2 — Separação de níveis

- Fechar TURN ≠ fechar SECTION ≠ fechar SESSION.
- SESSION só encerra por fluxo explícito de encerramento autorizado.

### I3 — Continuidade com rastreabilidade

- Toda transição relevante deve deixar trilha em `audit*.jsonl`.
- Se estado local divergir do payload, a divergência deve ser logada e tratada, nunca silenciosamente ignorada sem auditoria.

### I4 — Anti-loop de Stop

- Se `stop_hook_active=true`, nunca aplicar bloqueio recursivo sem freio.

### I5 — Seção ativa consistente

- O sistema deve minimizar janelas sem seção ativa.
- Estado transitório de seção fechada deve ser curto e explícito.

### I6 — Imutabilidade de TURN encerrado

- TURN encerrado é imutável e não retomável.
- Qualquer continuidade de trabalho na mesma SESSION deve abrir novo TURN.

---

## 4) Ciclo de vida consolidado (As-Is → To-Be semântico)

## 4.1 Fluxo principal

1. `SessionStart` inicializa contexto local e briefing.
2. `UserPromptSubmit` (quando houver) prepara `current_turn`.
3. `PreToolUse`/`PostToolUse` acumulam telemetria, auth e estado.
4. `Stop` fecha TURN somente quando o turno está autorizado (via `vscode_askQuestions` + key
   correta); sem autorização, bloqueia e reentra no mesmo TURN (SUBTURN).
5. `SessionEnd` finaliza sessão quando ocorrer.

## 4.2 Fluxo com bloqueio de Stop (subturnização)

- SUBTURN-1: agente tenta encerrar TURN.
- `Stop` bloqueia (`decision:block`) com `stop_hook_active=false`.
- SUBTURN-2: agente continua, executa ações corretivas.
- `Stop` com `stop_hook_active=true` encerra o mesmo TURN lógico.

## 4.3 Fluxo com subagente

- Pai delega (`runSubagent`/`search_subagent`).
- Subagente executa em contexto isolado e retorna resultado.
- Pai retoma no mesmo TURN lógico.

## 4.4 Relação TURN ↔ SESSION (modelo consolidado)

- Encerramento de TURN encerra a sessão de execução corrente.
- A SESSION de plataforma pode ser retomada no mesmo chat por novo prompt.
- Essa retomada sempre abre **novo TURN** (`turn_anterior + 1`), nunca reaproveita TURN fechado.

---

## 5) Regras de legitimidade de encerramento

### 5.1 Encerramento legítimo de TURN

Um TURN é legítimo quando:

1. `vscode_askQuestions` foi chamado como último ato do turno;
2. A key correta da sessão foi validada no fluxo autorizado;
3. `Stop` foi processado sem loop indevido;
4. O estado final do turno foi persistido com trilha de auditoria.

Após esse fechamento, o TURN não pode ser retomado. A continuidade ocorre em novo TURN.

### 5.2 Encerramento legítimo de SESSION

Encerramento de SESSION exige confirmação explícita do usuário por close key da sessão, com validação no fluxo de hooks e registro de autorização.

> TURN nunca deve ser tratado como fechamento implícito de SESSION.
> Encerrar TURN interrompe a execução corrente da sessão, mas a SESSION permanece retomável.

---

## 6) Contrato proposto para SUBTURN (novo)

> **Status atual**: conceito arquitetural **ainda não implementado** no runtime; existe apenas sinalização
> parcial por `agentStop_invocations`/`stop_hook_active`.

Adicionar bloco explícito ao contexto:

```json
{
  "current_turn": {
    "turn_id": "...",
    "subturn": {
      "number": 1,
      "started_at": "...",
      "reason": "normal|stop_block_resume|subagent_delegate|interactive_wait",
      "parent_turn_id": "..."
    }
  }
}
```

Eventos sugeridos em audit:
- `subturnStart`
- `subturnEnd`
- `subturnResume`

Benefício: elimina ambiguidades atuais entre “novo turno” e “continuação do turno”.

---

## 7) Mapa de responsabilidades por script (resumo)

- `session-start.sh`: bootstrap de sessão local e briefing.
- `log-prompt.sh`: início/refresh de turno a partir de prompt e reconciliações.
- `pre-tool-use.sh`: telemetria pré-tool, guards, marcações de delegação/auth.
- `post-tool-use.sh`: resultado de tool, captura de respostas interativas e validações.
- `agent-stop.sh`: fechamento de turno, anti-loop, nudge/controle de conformidade.
- `start-section.sh` / `section-end.sh`: lifecycle de seção.
- `start-turn.sh`: declaração explícita de intenção.
- `subagent-start.sh` / `subagent-stop.sh`: telemetria de subagente.
- `session-close.sh` / `session-end.sh`: fechamento autorizado e relatório final.

---

## 8) Gaps arquiteturais observados (prioridade para P1)

1. **Divergência documental** sobre quem aciona `session-close.sh` (auto vs chamada direta do agente em diferentes textos).
2. **Regra estrita de TURN (askQuestions + key)** ainda não está plenamente implementada em todos
  os scripts/runtime.
3. **Semântica de TURN x SUBTURN não formalizada** no schema atual (há sinais, mas sem contrato explícito).
4. **Estado transitório de SECTION fechada** (`is_closed=true`) ainda permite janela de inconsistência até nova abertura.
5. **Conjuntos de valores de `reason/source`** variam entre docs e implementação, exigindo normalização de dicionário canônico.

---

## 9) Decisões canônicas para continuidade das correções

1. **Adotar este documento como referência de semântica** para P1/P2.
2. **Não avançar em hardening adicional** sem alinhar `AGENTS.md`, instruções e scripts ao mesmo contrato.
3. **Implementar SUBTURN como conceito explícito** (schema + audit) antes de mudanças mais agressivas de bloqueio/autorizações.
4. **Padronizar vocabulário**: Session (plataforma), Session lógica (local), Section (semântica), Turn (ciclo), SubTurn (iteração intra-turno).

---

## 10) Critérios de aceite desta consolidação

- Existe uma definição única e não ambígua de SESSION/SECTION/TURN/SUBTURN.
- O papel de `session_id` nativo como fonte de verdade está explícito.
- O fechamento de SESSION está separado semanticamente do fechamento de TURN.
- O fluxo de subagente está modelado como continuidade de TURN (via SUBTURN), não como novo TURN implícito.

---

## 11) Próximos passos sugeridos (P1 arquitetural)

1. Alinhar documentação operacional (`AGENTS.md`, instruções e protocolos) com este contrato.
2. Introduzir schema de SUBTURN no `session-context` e eventos correspondentes no `audit`.
3. Revisar pontos de inconsistência em `section-end.sh`/`agent-stop.sh` para manter invariante de seção ativa com janela mínima.
4. Rodar smoke tests de ciclo completo (session start → turn com block → subagent → session close).

---

## 12) Operação dos scripts — automático vs manual

### 12.1 Chamados automaticamente por hooks

| Hook do VS Code/Copilot | Script                | Objetivo principal                                      |
| ----------------------- | --------------------- | ------------------------------------------------------- |
| `sessionStart`          | `session-start.sh`    | Bootstrap de contexto, close key, briefing, recovery    |
| `userPromptSubmitted`   | `log-prompt.sh`       | Início/reinicialização de ciclo de TURN                 |
| `preToolUse`            | `pre-tool-use.sh`     | Telemetria pré-tool, guards e tracking                  |
| `postToolUse`           | `post-tool-use.sh`    | Processa respostas de tools e validações de autorização |
| `postToolUseFailure`    | `tool-use-failure.sh` | Registra falhas de tool                                 |
| `agentStop`             | `agent-stop.sh`       | Fechamento de TURN, enforcement e checkpoints           |
| `subagentStart`         | `subagent-start.sh`   | Telemetria de delegação                                 |
| `subagentStop`          | `subagent-stop.sh`    | Fechamento de delegação                                 |
| `preCompact`            | `pre-compact.sh`      | Checkpoint antes de compactação                         |
| `sessionEnd`            | `session-end.sh`      | Fechamento final da sessão                              |

### 12.2 Chamados manualmente pelo agente (quando aplicável)

| Script manual           | Quando usar                                      |
| ----------------------- | ------------------------------------------------ |
| `start-turn.sh`         | Declarar intenção no início do turno de trabalho |
| `start-section.sh`      | Abrir nova fase lógica                           |
| `section-end.sh`        | Encerrar fase lógica explicitamente              |
| `continue-section.sh`   | Confirmar permanência após push                  |
| `session-checkpoint.sh` | Salvar checkpoint intermediário                  |
| `session-reminder.sh`   | Relembrar protocolo/chave da sessão              |

> `session-close.sh` **não** entra no fluxo manual do agente; ele é acionado pelo fluxo automático
> de hooks após validação da key no `post-tool-use.sh`.

---

## 13) Como detectar nova sessão vs retomada

Detecção canônica usa combinação de `session_id` + `source` + estado local:

1. **Nova sessão de plataforma**
  - `session_id` novo no payload de `sessionStart`;
  - `source=new` (ou equivalente de sessão nova);
  - `logical_session_number` incrementa.

2. **Retomada da mesma conversa/sessão lógica**
  - mesmo `session_id` de plataforma;
  - `source=inline_restart` (ou reconexão equivalente);
  - contexto agregado é preservado (não reset total).

3. **Retomada operacional após fim de TURN**
  - novo prompt no mesmo chat abre novo TURN (`turn + 1`);
  - TURN anterior permanece encerrado e não retomável.

---

## 14) Encerramentos abruptos e retomada

O recovery classifica o estado anterior em `recovery.close_mode`:

- `clean`: fechamento autorizado/limpo.
- `key_validated`: key válida, mas fechamento final incompleto.
- `abrupt_no_key`: encerramento abrupto sem key.
- `abrupt_reconnect`: encerramento por reconexão/interrupção de transporte.
- `ok`: sem sessão anterior detectada.

Efeitos operacionais esperados:

1. Em `abrupt_no_key`, levantar alertas fortes e exigir kickoff reforçado antes de continuar.
2. Em `key_validated`, tratar como fechamento parcialmente auditado e revisar consistência.
3. Em `abrupt_reconnect`, recuperar contexto preservado e continuar com monitoramento.

---

## 15) Como validar se sessão/turno anteriores foram legítimos

### 15.1 Sessão anterior

Indicadores de fechamento válido:

- presença de `sessionCloseAuthorized` e/ou `sessionEnd` com `session_id` correto;
- ausência de `SESSION_CLOSE_NO_KEY.flag` para a sessão anterior.

Indicadores de fechamento inválido/duvidoso:

- `SESSION_CLOSE_NO_KEY.flag` ativo;
- `close_mode=abrupt_no_key` ou `key_validated` sem conclusão final.

### 15.2 Turno anterior

Indicadores de TURN legítimo:

- `vscode_askQuestions` executado no turno;
- key da sessão validada no fluxo autorizado;
- fechamento registrado sem `decision:block` pendente.

Indicadores de TURN ilegítimo:

- evento `turnEnd_no_askQuestions`;
- `agentStop` bloqueado por falta de autorização;
- ausência de trilha final de fechamento do turno.

---

_Este documento consolida a arquitetura alvo para destravar as próximas ondas de correção com semântica estável e auditável._
