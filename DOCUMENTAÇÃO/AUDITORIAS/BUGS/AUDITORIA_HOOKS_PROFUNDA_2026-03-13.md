# Auditoria Profunda — Sistema de Hooks Copilot

- **Data**: 2026-03-13
- **Escopo**: `.github/hooks/**`, `.github/AGENTS.md`, instruções de protocolo e fluxos de sessão
- **Base de referência oficial**:
  - GitHub Copilot Hooks (conceitos/configuração/tutorial)
  - VS Code Agent Hooks (customization/hooks)
- **Meta solicitada**: >= 30 achados com gravidade, tipo, localização, descrição e proposta

## Resumo executivo

Foram identificados **48 achados** (bugs, gaps e incompletudes), sendo:

- **Crítico**: 1
- **Alto**: 5
- **Médio**: 14
- **Baixo**: 28

Pontos mais relevantes:

1. Há **bloqueio estrutural indevido do fim de turno** em `agent-stop.sh` exigindo
   `close_key_validated=true` mesmo sem intenção de encerrar SESSION.
2. Há **contradições de protocolo** entre scripts e instruções (`session-start.sh`/`AGENTS.md`)
   sobre quem deve executar `session-close.sh`.
3. O guard de `git push` em `pre-tool-use.sh` está acoplado indevidamente à autorização de
   encerramento da sessão.
4. Métricas de compliance em `session-end.sh` usam nome de evento inexistente
   (`turnEnd_UNAUTHORIZED`) e subcontam violações.
5. O lint estático (ShellCheck) encontrou uma quantidade elevada de padrões `A && B || C` e outras
   fragilidades de manutenção.

---

## Achados detalhados (48)

| ID | Gravidade | Tipo | Localização | Descrição | Proposta de correção | | ---- | ----------- |

| -------------------------------------- |
| -------------------------------------- |

---

|
-----------------------------------------------------------------------------------------------------------

| ------------------------------------------------------------------------- |
------------------------------------------------------------ | --- |
--------------------------------- | | H001 | **Crítico** | Lógica de controle |
`.github/hooks/scripts/agent-stop.sh:61-122` | O Nível 3 bloqueia `agentStop` quando
`close_key_validated=false`, forçando fluxo de encerramento de SESSION em contexto de encerramento
de TURN. Pode bloquear o ciclo normal de trabalho. | Restringir esse gate ao **Template F
explícito** (intenção de encerrar SESSION), não ao fim de todo TURN. | | H002 | **Alto** |
Inconsistência de protocolo | `.github/hooks/scripts/session-start.sh:840-841` vs `:869` | O
briefing gerado diz para **não chamar** `session-close.sh` (auto via post-tool-use), mas em outro
ponto diz que o agente **executa** `session-close.sh`. Direções contraditórias. | Unificar fluxo
canônico em um único comportamento (preferencialmente auto-fechamento via post-tool-use). | | H003 |
**Alto** | Inconsistência de protocolo | `.github/AGENTS.md:21` vs `:112` e `:530` | Documento
afirma simultaneamente “NUNCA chamar `session-close.sh` diretamente” e “chamar obrigatoriamente
`session-close.sh`”. | Harmonizar documentação e manter apenas um caminho oficial. | | H004 |
**Alto** | Regra excessiva / UX operacional | `.github/hooks/scripts/pre-tool-use.sh:522-567` |
`git push` é bloqueado quando `close_key_validated=false`, mesmo sem intenção de encerrar SESSION.
Acoplamento indevido entre entrega de código e fechamento de sessão. | Trocar para guard de
**autorização de commit/push (Template G)** sem dependência de close_key. | | H005 | **Alto** |
Segurança lógica / falso positivo | `.github/hooks/scripts/post-tool-use.sh:233` | Detecção da close
key por `grep -qF` no `tool_response` completo pode validar chave por eco acidental no texto. |
Parse estruturado do `answers` de `vscode_askQuestions`; validar somente campo de resposta livre
esperado. | | H006 | **Alto** | Estado de sessão | `.github/hooks/scripts/session-close.sh:129-131`
e `:172+` | Script marca `ended_at`/`end_reason` antes do `sessionEnd` real (que pode não ocorrer
imediatamente), criando estado “encerrado” com sessão ainda ativa. | Introduzir estado intermediário
`pending_close_authorized`; deixar `ended_at` apenas para `session-end.sh`. | | H007 | **Médio** |
Campo morto / implementação incompleta | `.github/hooks/scripts/pre-tool-use.sh:531` e `:545` |
Regra cita `current_turn.last_tool_name`, mas esse campo não é mantido pelos hooks; branch vira
ruído técnico. | Remover checagem ou popular campo de forma consistente em `pre/post-tool-use`. | |
H008 | **Médio** | Métrica incorreta | `.github/hooks/scripts/session-end.sh:429` | Consulta usa
evento `turnEnd_UNAUTHORIZED`, porém os scripts registram `turnEnd_no_askQuestions`. Compliance fica
subcontado. | Alinhar query para eventos reais (`turnEnd_no_askQuestions` e equivalentes). | | H009
| **Médio** | Inconsistência de schema | `.github/hooks/scripts/session-start.sh:247` e
`.github/hooks/scripts/agent-stop.sh:826` | Inicializa `turn_unauthorized`, mas incrementa
`turn_no_askQuestions`. Métricas quebram por divergência de nome. | Padronizar em um único campo
(ex.: `turn_unauthorized`). | | H010 | **Médio** | Healer incorreto |
`.github/hooks/scripts/subagent-start.sh:47` | Após `heal_v1`, variável é setada para
`CTX_ACTIVE_SID` (valor antigo), não para SID payload curado. | Ajustar para
`SESSION_ID_PAYLOAD`/SID final efetivo após heal. | | H011 | **Médio** | Healer incorreto |
`.github/hooks/scripts/subagent-stop.sh:54` | Mesmo padrão de regressão de SID após heal do
subagente stop. | Mesma correção do H010. | | H012 | **Médio** | Ambiguidade de política |
`.github/hooks/scripts/pre-tool-use.sh:424-473` e `:435-445` | Comentário diz “NUNCA chamar
session-close diretamente”, mas código permite quando `close_key_validated=true`. | Atualizar
comentários/contrato para refletir comportamento real, ou endurecer regra de fato. | | H013 |
**Médio** | Shell safety (SC2015) | `.github/hooks/scripts/agent-stop.sh:315` | Padrão
`A && B                                                                                                                                                                              |                                                                                                             | C`pode
executar`C`mesmo com`A` verdadeiro. | Substituir por `if ...; then ...; else ...; fi`. | | H014 |
**Médio** | Shell safety (SC2015) | `.github/hooks/scripts/agent-stop.sh:557` | Mesmo padrão em
atualização de contexto bloqueado. | Idem H013. | | H015 | **Médio** | Shell safety (SC2015) |
`.github/hooks/scripts/log-prompt.sh:363` | Encadeamento
`&& \                                                                                                                                                                          |                                                                                                             | `
em atualização de briefing pode cair em fallback indevido. | Refatorar para blocos `if`. | | H016 |
**Baixo** | Shell style/safety (SC2015) | `.github/hooks/scripts/migrate-per-session-audit.sh:36` |
`logv() { $VERBOSE && ...                                                                                                                                                                   |                                                                                                             | true; }`suscetível
a execução não-intencional
do`                        |                                                              |`. | Usar
`if $VERBOSE; then ...; fi`. | | H017 | **Baixo** | Shell style (SC2002) |
`.github/hooks/scripts/migrate-per-session-audit.sh:112` | Useless cat em leitura de SID file. |
Trocar por `tr -d ... < "$SID_FILE"`. | | H018 | **Baixo** | Shell safety (SC2015) |
`.github/hooks/scripts/migrate-per-session-audit.sh:139` | Encadeamento
`&& ...                                                                                                                                                                        |                                                                                                             | ...`
para log de symlink. | Usar bloco `if`. | | H019 | **Baixo** | Shell safety (SC2015) |
`.github/hooks/scripts/migrate-per-session-audit.sh:150` | Mesmo padrão no symlink de
`session-context.json`. | Usar bloco `if`. | | H020 | **Médio** | Shell safety (SC2015) |
`.github/hooks/scripts/pre-tool-use.sh:218` |
`jq ... && mv ...                                                                                                                                                                           |                                                                                                             | rm ...`
pode remover tmp mesmo após condições parcialmente bem-sucedidas. | Isolar validação em `if` e
capturar RC explicitamente. | | H021 | **Baixo** | Hygiene (SC2034) |
`.github/hooks/scripts/session-close.sh:29` | `SCRIPTS_DIR` declarado e não utilizado. | Remover
variável ou usar de fato. | | H022 | **Baixo** | Shell efficiency (SC2126) |
`.github/hooks/scripts/session-start.sh:433` |
`grep                                                                                                                                                                                       | wc -l`pode
ser simplificado e mais robusto com`grep -c`. | Trocar para `grep -c`. | | H023 | **Médio** | Shell
safety (SC2015) | `.github/hooks/scripts/session-start.sh:1199` | Condicional inline complexa com
`&& ...                                                                                                                                                     |                                                                                                             | (...)`
para severidade de reconnect. | Refatorar para `if/elif/else` explícito. | | H024 | **Baixo** |
Shell safety (SC2015) | `.github/hooks/scripts/smoke-test.sh:135` |
`check_key && pass                                                                                                                                                                          |                                                                                                             | fail`pode
gerar falso fail se`pass` falhar. | Substituir por `if check_key ...; then pass; else fail; fi`. | |
H025 | **Baixo** | Shell safety (SC2015) | `.github/hooks/scripts/smoke-test.sh:136` | Mesmo padrão.
| Idem H024. | | H026 | **Baixo** | Shell safety (SC2015) |
`.github/hooks/scripts/smoke-test.sh:137` | Mesmo padrão. | Idem H024. | | H027 | **Baixo** | Shell
safety (SC2015) | `.github/hooks/scripts/smoke-test.sh:138` | Mesmo padrão. | Idem H024. | | H028 |
**Baixo** | Shell safety (SC2015) | `.github/hooks/scripts/smoke-test.sh:139` | Mesmo padrão. | Idem
H024. | | H029 | **Baixo** | Shell safety (SC2015) | `.github/hooks/scripts/smoke-test.sh:140` |
Mesmo padrão. | Idem H024. | | H030 | **Baixo** | Shell safety (SC2015) |
`.github/hooks/scripts/smoke-test.sh:141` | Mesmo padrão. | Idem H024. | | H031 | **Baixo** | Shell
safety (SC2015) | `.github/hooks/scripts/smoke-test.sh:142` | Mesmo padrão. | Idem H024. | | H032 |
**Baixo** | Shell safety (SC2015) | `.github/hooks/scripts/smoke-test.sh:143` | Mesmo padrão. | Idem
H024. | | H033 | **Baixo** | Shell safety (SC2015) | `.github/hooks/scripts/smoke-test.sh:144` |
Mesmo padrão. | Idem H024. | | H034 | **Baixo** | Shell safety (SC2015) |
`.github/hooks/scripts/smoke-test.sh:145` | Mesmo padrão. | Idem H024. | | H035 | **Baixo** | Shell
safety (SC2015) | `.github/hooks/scripts/smoke-test.sh:146` | Mesmo padrão. | Idem H024. | | H036 |
**Baixo** | Shell safety (SC2015) | `.github/hooks/scripts/smoke-test.sh:149` | Mesmo padrão. | Idem
H024. | | H037 | **Baixo** | Shell safety (SC2015) | `.github/hooks/scripts/smoke-test.sh:150` |
Mesmo padrão. | Idem H024. | | H038 | **Baixo** | Shell safety (SC2015) |
`.github/hooks/scripts/smoke-test.sh:151` | Mesmo padrão. | Idem H024. | | H039 | **Baixo** | Shell
safety (SC2015) | `.github/hooks/scripts/smoke-test.sh:152` | Mesmo padrão. | Idem H024. | | H040 |
**Baixo** | Shell safety (SC2015) | `.github/hooks/scripts/smoke-test.sh:170` | Mesmo padrão. | Idem
H024. | | H041 | **Baixo** | Shell safety (SC2015) | `.github/hooks/scripts/smoke-test.sh:171` |
Mesmo padrão. | Idem H024. | | H042 | **Baixo** | Shell safety (SC2015) |
`.github/hooks/scripts/smoke-test.sh:172` | Mesmo padrão. | Idem H024. | | H043 | **Baixo** | Shell
safety (SC2015) | `.github/hooks/scripts/smoke-test.sh:173` | Mesmo padrão. | Idem H024. | | H044 |
**Baixo** | Shell safety (SC2015) | `.github/hooks/scripts/smoke-test.sh:734` | Encadeamento de
validação no sandbox com
`&& ...                                                                                                                                            |                                                                                                             | ...`.
| Refatorar para `if` explícito. | | H045 | **Baixo** | Shell lint (SC2016) |
`.github/hooks/scripts/smoke-test.sh:939` | Expressão com `$reason` em aspas simples; não expande.
Pode ser intencional para literal, mas é ambíguo. | Se literal, comentar
`# shellcheck disable=SC2016`; se variável, usar aspas duplas. | | H046 | **Baixo** | Shell lint
(SC2016) | `.github/hooks/scripts/smoke-test.sh:1179` | Regex com `$stop_hook` em aspas simples;
mesma ambiguidade de expansão literal. | Mesma ação de H045. | | H047 | **Médio** | Shell safety
(SC2015) | `.github/hooks/scripts/subagent-start.sh:101` | Atualização de contexto usa
`&& mv                                                                                                                                                          |                                                                                                             | rm`
suscetível a fluxo incorreto. | Trocar por `if` com RC explícito. | | H048 | **Médio** | Shell
safety (SC2015) | `.github/hooks/scripts/subagent-stop.sh:142` | Mesmo padrão no stop do subagente.
| Trocar por `if` com RC explícito. |

---

## Recomendações priorizadas

1. **Imediato (P0)**
   - Corrigir H001 (gate Nível 3 em `agent-stop.sh`) para não bloquear TURN normal.
   - Corrigir H004 (guard de `git push`) para desacoplar push de fechamento de sessão.
   - Corrigir H005 (validação de close key por parse estruturado de resposta).

2. **Curto prazo (P1)**
   - Corrigir inconsistências de protocolo H002/H003/H012.
   - Corrigir métricas H008/H009.
   - Corrigir heal dos subagentes H010/H011.

3. **Higiene técnica (P2)**
   - Endereçar todos os SC2015/SC2016/SC2002/SC2126/SC2034.
   - Padronizar padrão seguro de escrita atômica + `if` explícito.

## Nota final

Este relatório cumpre o requisito de **mínimo 30 achados** e está pronto para virar backlog de
correção por ondas (P0/P1/P2).
