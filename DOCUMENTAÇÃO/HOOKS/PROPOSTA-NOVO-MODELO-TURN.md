# Proposta: Novo Modelo de Autorização — TURN como Unidade Autônoma

> **Status**: Proposta | **Data**: 2026-03-11 | **Autor**: Copilot Agent **Contexto**: revisão do
> protocolo de autorização pós-Hardening v6

---

## 1. Diagnóstico — Estado Atual

O sistema atual trata TURN, SECTION e SESSION com exigências crescentes, mas a exigência de
`vscode_askQuestions` por TURN tem causado mais fricção do que benefício:

| Nível   | Frequência | Exigência atual                             | Custo operacional |
| ------- | ---------- | ------------------------------------------- | ----------------- |
| SESSION | 1/dia      | `vscode_askQuestions` + close_key           | Justo — raro      |
| SECTION | ≥1/sessão  | Automática (nenhuma autorização do usuário) | Zero — ok         |
| TURN    | ≥10/sessão | `vscode_askQuestions` obrigatório           | **ALTO — ruído**  |

### Problemas identificados no modelo atual

1. **TURN ≠ SESSION**: TURNs mudam naturalmente a cada ciclo prompt→resposta. Exigir autorização em
   cada transição é tratar TURNs como se fossem SESSIONs.

2. **decision:block é reativo e frágil**: o hook bloqueia o agente, que então precisa chamar
   `vscode_askQuestions` forçadamente — muitas vezes gerando uma pergunta artificial sem valor real.

3. **Falsos positivos multiplicaram após runSubagent** (razão do Hardening v6): o Hardening v6
   adicionou 4 estratégias de detecção + delegação via subagente para _contornar_ a exigência, o que
   indica que a exigência por TURN é a raiz do problema, não a falta de estratégias.

4. **`vscode_askQuestions` tem valor instrinseco independente do protocolo de TURN**: é uma
   ferramenta de UI valiosa para comunicação, não deveria ser usada de forma forçada.

5. **Auditoria ainda é possível sem exigência**: podemos rastrear TURNs, intenções, ferramentas
   usadas e resultados sem bloquear o encerramento natural.

---

## 2. Princípios do Novo Modelo

### 2.1 Hierarquia de controle

```
SESSION  →  controle do USUÁRIO  (exige close_key — mantido)
SECTION  →  controle do AGENTE   (automático — mantido)
TURN     →  controle do AGENTE   (autônomo — NOVO)
```

**O agente é livre para encerrar TURNs.** A ferramenta `vscode_askQuestions` continua disponível e
deve ser usada quando o agente _quiser_ comunicar, perguntar ou confirmar — não por obrigação
sistêmica.

### 2.2 `vscode_askQuestions` como ferramenta de qualidade, não de protocolo

O agente deve chamar `vscode_askQuestions` quando:

- Terminou uma tarefa significativa e quer entregar e perguntar sobre próximo passo (Template A)
- Encontrou 3+ bugs e precisa de orientação (Template B)
- Quer propor uma mudança arquitetural (Template C)
- Checkpoint periódico (Template D, a cada ~5 TURNs substantivos)
- Antes de commit/push (Template G)
- Encerramento de SESSION (Template F + close_key)

Mas **não** por simples transição de TURN.

### 2.3 Accountability sem bloqueio

TURNs são automaticamente auditados com:

- `start-turn.sh "intenção"` → `turnStart_enriched` em audit.jsonl (voluntário, recomendado)
- `turnStart_enriched_auto` gerado pelo `agent-stop.sh` quando intenção não declarada
- Todas as ferramentas usadas, duração, seção, turno local/global

A auditoria continua. O bloqueio é removido.

---

## 3. Mudanças Propostas

### 3.1 `agent-stop.sh` — remover decision:block por TURN

**O que muda**: a seção `HARDENING: decision:block para turnos não autorizados` é removida. O hook
deixa de emitir `{"decision":"block"}` na ausência de `vscode_askQuestions`.

**O que permanece**:

- Toda a lógica de auditoria (`turnEnd_authorized`, `turnEnd_UNAUTHORIZED` → renomear)
- Auto-enrichment (`turnStart_enriched_auto` quando intenção não declarada)
- Reset de `current_turn.*` e incremento de `session_stats.*`
- Geração de seção automática `"retomada"` quando `current_section == null`
- Detecção de `pending_section_after_push` → mensagem no systemMessage (mas sem bloquear)

**O que muda nos eventos de auditoria**:

| Evento anterior         | Evento novo                  | Significado                                              |
| ----------------------- | ---------------------------- | -------------------------------------------------------- |
| `turnEnd_authorized`    | `turnEnd_completed`          | Turno encerrado normalmente                              |
| `turnEnd_UNAUTHORIZED`  | `turnEnd_no_askQuestions`    | Informativo — turno sem `vscode_askQuestions` (sem flag) |
| `turnEnd_BLOCKED`       | _(removido)_                 | Não existe mais                                          |
| `AUTH_REQUESTED = true` | `askQuestions_called = true` | Semântica mais clara                                     |

### 3.2 `agent-stop.sh` — systemMessage informativo (não bloqueante)

Quando o agente encerra sem `vscode_askQuestions`, em vez de bloquear, o hook pode:

1. Não emitir nada (comportamento padrão limpo), OU
2. Emitir `systemMessage` com contexto útil (estado atual, backlog, sugestão de Template)

Sugestão: emitir `systemMessage` rico apenas quando:

- `pending_section_after_push == true` (git push sem declaração de seção), OU
- `consecutive_no_askQuestions >= 5` (muitos TURNs sem comunicação — sugerir checkpoint), OU
- `session_stats.alta_tasks > 0` e `turn_number % 5 == 0` (checkpoint periódico sugerido)

```bash
# Exemplo de systemMessage informativo (sem decision:block)
{
  "systemMessage": "📍 TURN 7 — Seção \"implementação\" | Backlog: 2 alta, 1 média\n..."
}
```

### 3.3 `copilot-instructions.md` — remover REGRA ABSOLUTA de TURN

**O que muda**: a seção `⛔ REGRA ABSOLUTA — Encerrar sem autorização é PROIBIDO` é reformulada. O
TURN deixa de exigir `vscode_askQuestions`. Apenas SESSION mantém a exigência de close_key.

**Texto proposto**:

```markdown
## Protocolo de Comunicação — Quando usar vscode_askQuestions

vscode_askQuestions é a ferramenta de comunicação principal. Use-a quando:

- Concluiu uma tarefa relevante e quer perguntar sobre próximo passo (Template A)
- Encontrou 3+ bugs e precisa de orientação (Template B)
- Periodicidade: ~a cada 5 TURNs de trabalho substantivo (Template D)
- Antes de commit/push (Template G)
- Encerramento de SESSION (Template F — exige close_key)

Nota: TURNs encerram automaticamente. Não é necessário autorização por turno.
```

### 3.4 `hooks-protocol.instructions.md` — atualizar seção TURN

**O que muda**:

```markdown
### TURN — Autônomo (sem autorização obrigatória)

O agente encerra TURNs livremente. O sistema registra automaticamente inicio/fim de cada TURN em
audit.jsonl via `log-prompt.sh` + `agent-stop.sh`.

RECOMENDADO (não obrigatório por turno):

- Declarar intenção: `bash .github/hooks/scripts/start-turn.sh "intenção"` como primeiro ato
- Chamar `vscode_askQuestions` periodicamente (Template D, ~a cada 5 TURNs substantivos)
- Chamar `vscode_askQuestions` ao concluir tarefa relevante (Template A)

OBRIGATÓRIO (mantido):

- Antes de commit/push: Template G
- Para encerrar SESSION: Template F + close_key
```

### 3.5 `AGENTS.md` — reformular seção de Templates

Os Templates A-G continuam válidos — mas o contexto de "obrigatório por turno" é removido de A.
Template A passa a ser "recomendado ao concluir tarefas" em vez de "obrigatório antes de encerrar".

### 3.6 Novos mecanismos de auto-transição

**3.6.1 `auto-checkpoint.sh`** (NOVO SCRIPT PROPOSTO): Script chamado pelo `agent-stop.sh` quando
`turn_count % 5 == 0` para gerar um snapshot leve do estado atual (sem bloquear). Opcional.

**3.6.2 Contador `turns_since_askQuestions`** no contexto:

```json
{
  "session_stats": {
    "turns_since_askQuestions": 3,
    "last_askQuestions_at": "2026-03-11T10:00:00Z"
  }
}
```

Quando chegar a 5+, o `systemMessage` do próximo TURN inclui sugestão de checkpoint (Template D).
Isso cria um _nudge_ não bloqueante ao invés de um _block_ forçado.

**3.6.3 Limpeza de flags obsoletas**:

- `UNAUTHORIZED_CLOSE.flag` → substituído por `TURN_STATS.json` (apenas contagem, sem flag de
  "violação")
- `block_count` no contexto → removido (não há mais bloqueio)
- `compliance.consecutive_unauthorized` → renomear para `stats.turns_without_askQuestions`

---

## 4. O que NÃO muda

| Mecanismo                                    | Motivo para manter                                    |
| -------------------------------------------- | ----------------------------------------------------- |
| SESSION close_key (Template F)               | SESSION é rara e de alto impacto                      |
| Template G antes de commit/push              | Operação destrutiva/visível — exige confirmação       |
| `start-turn.sh "intenção"` (recomendado)     | Ajuda a LLM a programar melhor — contexto de intenção |
| `start-section.sh` para mudança de fase      | Organização semântica do trabalho                     |
| Auditoria completa em `audit.jsonl`          | Observabilidade mantida                               |
| `turnStart_enriched_auto` (auto-enrich)      | Auto-documentação de atividade sem custo              |
| Templates A-G (como comunicação recomendada) | Continuam úteis como guias, não como regras rígidas   |
| `pending_section_after_push` systemMessage   | Reminder útil após git push (não bloqueante)          |

---

## 5. Benefícios Esperados

1. **Fim dos falsos UNAUTHORIZED**: sem decision:block, não há mais necessidade de 4 estratégias de
   detecção + delegação via subagente para "contornar" a exigência.

2. **LLM liberta para programar melhor**: em vez de gastar tokens gerando `vscode_askQuestions`
   artificiais, o agente foca no trabalho.

3. **`vscode_askQuestions` volta a ter valor real**: quando chamado, é porque o agente genuinamente
   quer comunicar algo — não porque o protocolo forçou.

4. **Simplificação do `agent-stop.sh`**: ~100 linhas de decision:block + mensagem rica podem ser
   removidas ou convertidas em `systemMessage` informativo leve.

5. **Subagente delegation: desnecessário**: sem exigência de TURN, o Hardening v6 (Estratégia 4)
   torna-se desnecessário como mecanismo de bypass — pode ser mantido como auditoria apenas.

6. **Modelo mais honesto**: o sistema reflete a realidade — TURNs mudam frequentemente e isso é
   normal, não uma "violação".

---

## 6. Plano de Implementação (ordem sugerida)

| #   | Arquivo                          | Mudança                                                     | Impacto |
| --- | -------------------------------- | ----------------------------------------------------------- | ------- |
| 1   | `agent-stop.sh`                  | Remover seção decision:block; converter em systemMessage    | Alto    |
| 2   | `copilot-instructions.md`        | Reformular REGRA ABSOLUTA → protocolo de comunicação        | Alto    |
| 3   | `hooks-protocol.instructions.md` | Atualizar seção TURN                                        | Alto    |
| 4   | `.github/AGENTS.md`              | Reformular Templates como recomendações, não obrigações     | Médio   |
| 5   | `session-context.json` schema    | Adicionar `turns_since_askQuestions`; remover `block_count` | Médio   |
| 6   | `PROTOCOLO-AUTORIZACAO.md`       | Atualizar para v5.0 (remover decision:block de TURN)        | Médio   |
| 7   | `smoke-test.sh`                  | Atualizar testes relacionados ao decision:block             | Baixo   |

---

## 7. Considerações de Risco

| Risco                                     | Mitigação                                                     |
| ----------------------------------------- | ------------------------------------------------------------- |
| Agente "some" sem comunicar progresso     | systemMessage de nudge a cada 5 TURNs; Template D recomendado |
| Commit/push sem revisão do usuário        | Template G mantido obrigatório antes de commit/push           |
| Perda de rastreabilidade de atividade     | Auditoria completa em audit.jsonl mantida                     |
| SESSION encerrada sem controle do usuário | close_key mantida obrigatória                                 |
| Regressão no sistema de hooks             | smoke-test.sh atualizado + run após implementação             |

---

## 8. Proposta de systemMessage informativo (substituto ao decision:block)

Em vez de bloquear o agente, o hook pode gerar um contexto informativo leve nos TURNs onde o
`pending_section_after_push` esteja ativo ou o contador chegue ao limite:

```
📍 TURN 8/22 — Seção "implementação"
  Backlog: 2 alta | 1 média
  Último vscode_askQuestions: 5 TURNs atrás
  💡 Sugestão: Template A (tarefa concluída?) ou Template D (checkpoint periódico)
  🔀 Git push detectado: declare nova seção ou confirme continuação
```

Isso mantém a LLM informada e a orienta sem forçar comportamento específico.

---

_Proposta criada em 2026-03-11 para discussão antes da implementação._
