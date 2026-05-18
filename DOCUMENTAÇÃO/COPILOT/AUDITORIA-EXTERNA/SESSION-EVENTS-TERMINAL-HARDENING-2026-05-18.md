# Hardening focado em `session-events.d.ts` — Terminal, sessão e agent

> Documento-foco: `node_modules/@github/copilot-sdk/dist/generated/session-events.d.ts`
>
> Recorte prioritário: linhas `946–1828`
>
> Referências complementares:
>
> - `DOCUMENTAÇÃO/COPILOT/AUDITORIA-EXTERNA/VALIDACAO-TERMINAL-LLM-B-AUDIT_EXTERNA-2026-05-18.md`
> - `DOCUMENTAÇÃO/COPILOT/AUDITORIA-EXTERNA/ROADMAP-TERMINAL-LLM-B-AUDIT_EXTERNA-2026-05-18.md`
> - `DOCUMENTAÇÃO/COPILOT/AUDITORIA-EXTERNA/COPILOTCLIENT-AUDITORIA-AMPLA-2026-05-18.md`
> - `DOCUMENTAÇÃO/COPILOT/AUDITORIA-EXTERNA/SESSIONCONFIG-SUBAGENTES-AUDITORIA-AMPLA-2026-05-18.md`
> - `https://github.com/github/copilot-sdk/blob/main/nodejs/README.md`

---

## 1. Objetivo deste anexo

Este anexo responde a uma pergunta mais específica do que a auditoria anterior respondeu:

**a cadeia de eventos de sessão/agent está implementada de ponta a ponta, de forma canônica, com UX terminal clara e sem arquiteturas paralelas desnecessárias?**

O foco está nas famílias do intervalo `946–1828`, incluindo:

- `assistant.*`
- `tool.execution_*`
- `system.message`
- `system.notification`
- `permission.*`
- `user_input.*`
- `elicitation.*`
- `sampling.*`
- `mcp.oauth.*`
- `external_tool.*`
- `command.*`
- `auto_mode_switch.*`
- `commands.changed`
- `capabilities.changed`
- `exit_plan_mode.*`
- `session.tools_updated`
- `session.background_tasks_changed`
- `session.skills_loaded`

---

## 2. Princípio canônico confirmado pelo SDK 0.3.0

O README oficial do SDK e o arquivo tipado confirmam uma separação correta entre três classes de sinal:

1. **eventos finais/persistíveis**
   - ex.: `assistant.message`, `assistant.reasoning`, `tool.execution_complete`, `permission.completed`
2. **eventos efêmeros de streaming/progresso**
   - ex.: `assistant.message_delta`, `assistant.reasoning_delta`, `tool.execution_progress`
3. **eventos de coordenação/UI/runtime**
   - ex.: `capabilities.changed`, `commands.changed`, `system.notification`, `exit_plan_mode.requested`

O problema não está nessa modelagem. O problema aparece quando a superfície terminal trata sinais semanticamente importantes **apenas como transientes**, sem promoção para narrativa durável.

---

## 3. Cadeia ponta-a-ponta observada no projeto

### 3.1. Fluxo dominante atual

O fluxo dominante identificado no repositório é:

`SDK session event vanilla`
→ `src/copilot/event-handlers/**`
→ `agent event normalizado`
→ `src/copilot/terminal/events/**`
→ `stdout local + SSE + activity-state + transcript/turn-trace`

Esse desenho é correto e preferível a consumir diretamente o SDK em múltiplas camadas de UI.

### 3.2. Onde o fluxo já está canônico

Está razoavelmente canônico para:

- `assistant.message`
- `assistant.turn_start` / `assistant.turn_end`
- `assistant.intent`
- `tool.execution_start`
- `tool.execution_complete`
- `permission.requested` / `permission.completed`
- `user_input.requested` / `user_input.completed`
- `elicitation.requested` / `elicitation.completed`
- `mcp.oauth_required` / `mcp.oauth_completed`
- `external_tool.requested` / `external_tool.completed`

### 3.3. Onde o fluxo ainda estava parcial

Estava parcial, latente ou subexposto para:

- `tool.execution_progress`
- heartbeat visual de tool longa
- `system.notification` → `agent.background.*` / `agent.shell.*`
- `assistant.usage`
- `hook.start` / `hook.end`
- `sampling.requested` / `sampling.completed`
- `commands.changed`
- `capabilities.changed`
- `auto_mode_switch.*`
- `exit_plan_mode.requested`
- attachments `blob` no terminal

Após a retomada contínua sobre baseline verde, os itens acima deixaram de ser apenas backlog conceitual: todos ganharam tratamento material, restando sobretudo aprofundamento de UX/diffs e não mais ausência total de surface.

Um complemento importante desta rodada é que `requestHeaders` por turno deixaram de ser gap abstrato do roadmap e viraram contrato implementado. A solução adotada foi deliberadamente canônica: em vez de fingir que o caminho `ask_user` do dialog loop aceita headers por turno, o terminal faz bounce controlado para `llmBridgeClient.chat(...)` quando há headers one-shot, e reanexa o dialog loop ao fim.

Outro complemento importante é que a camada local de `CopilotClient` também foi auditada e endurecida em paralelo: metadata dedicada de sessão, builder/options full e baseline declarativo do boot agora estão alinhados com o `client.d.ts` realmente instalado, evitando que a cadeia terminal/session opere sobre uma fachada parcialmente incompleta.

Um terceiro complemento importante desta rodada é que `SessionConfig`, `ResumeSessionConfig` e `CustomAgentConfig` também foram auditados em profundidade: agora existe builder dedicado de resume, sanitização estrutural explícita e a camada local de subagentes deixou de divergir do SDK em `description?`, `skills?`, `mcpServers?` e `tools=[]`. Isso reduz o risco de a cadeia terminal/session operar sobre contratos locais mais restritivos do que o SDK oficial.

---

## 4. Matriz de cobertura do recorte 946–1828

| Família                                             | Estado atual                             | Veredito                        | Observação                                                        |
| --------------------------------------------------- | ---------------------------------------- | ------------------------------- | ----------------------------------------------------------------- |
| `assistant.message`                                 | coberto                                  | bom                             | render final e transcript fora do turno ativo                     |
| `assistant.message_delta`                           | parcial                                  | aceitável, mas exige vigilância | bom no wire; UX depende do render/live loop e do final event      |
| `assistant.reasoning` / `assistant.reasoning_delta` | parcial                                  | aceitável                       | thinking/history existe, mas ainda é uma UX especializada         |
| `assistant.usage`                                   | endurecido                               | bom com follow-up               | owner explícito via `pr.consumed` / `pr.fallback_model`           |
| `tool.execution_start`                              | coberto                                  | bom                             | narrativa e SSE canônicos                                         |
| `tool.execution_progress`                           | antes parcial, agora endurecido          | melhorar continuamente          | `compact` precisava snapshot durável                              |
| `tool.execution_partial_result`                     | coberto                                  | bom                             | já tratado com narrativa e SSE                                    |
| `tool.execution_complete`                           | coberto                                  | bom                             | narrativa, turn-trace e SSE                                       |
| `system.notification`                               | antes parcial, agora endurecido em parte | ainda incompleto                | background/shell agora mais visíveis; restante continua a revisar |
| `permission.*`                                      | coberto                                  | bom                             | cadeia relativamente madura                                       |
| `user_input.*`                                      | coberto                                  | bom                             | integração com mailbox e protocolo local                          |
| `elicitation.*`                                     | coberto                                  | bom                             | UX local existe                                                   |
| `sampling.*`                                        | coberto                                  | bom com follow-up               | já ganhou wiring e narrativa básica                               |
| `mcp.oauth.*`                                       | coberto em boa parte                     | bom com ressalvas               | fluxo RPC já iniciado; UX ainda pode melhorar                     |
| `external_tool.*`                                   | coberto                                  | bom                             | fluxo canônico dedicado                                           |
| `command.*`                                         | parcial                                  | gap de surface                  | observabilidade existe mais do que UX terminal                    |
| `auto_mode_switch.*`                                | coberto                                  | bom com follow-up               | já ganhou surface explícita                                       |
| `commands.changed`                                  | coberto                                  | bom com follow-up               | narrativa básica entregue; ainda cabe diff mais rico              |
| `capabilities.changed`                              | coberto                                  | bom com follow-up               | já há espelhamento básico no terminal                             |
| `exit_plan_mode.requested`                          | coberto                                  | bom com follow-up               | `requested` passou a ter owner explícito                          |
| `session.tools_updated`                             | parcial                                  | aceitável                       | há narrativa resumida, mas não surface rica                       |
| `session.background_tasks_changed`                  | parcial                                  | aceitável                       | visível, porém ainda minimalista                                  |
| `session.skills_loaded`                             | parcial                                  | aceitável                       | evento segue minimalista, mas `/sdk skills` reduziu o gap prático |

---

## 5. Diagnóstico do problema de “flash” no terminal

### 5.1. Causa imediata confirmada

O problema relatado pelo operador foi confirmado principalmente no modo `compact`:

- `tool.execution_progress` usava `writeInlineStatus(...)` como canal principal;
- heartbeat de tool longa também era reescrito em linha inline;
- o próximo update sobrescrevia a linha anterior;
- o operador perdia a narrativa do que a LLM-B fez em sequência.

### 5.2. Por que isso é grave

Isso é grave porque, na prática, transforma uma LLM operacional em uma UI de status volátil.

Em operação contínua, o terminal precisa responder a perguntas como:

- o que ela começou a fazer?
- o que mudou no meio do caminho?
- quando ficou parada numa tool longa?
- quando uma shell assíncrona concluiu?

Se a resposta depender de lembrar um “flash” que sumiu, a UX está funcionalmente incompleta.

---

## 6. Situação atual x situação ideal

### Situação atual

- os eventos chegam ao sistema de forma razoavelmente organizada;
- a distinção entre eventos efêmeros e finais existe;
- o terminal cobre boa parte das famílias importantes;
- mas ainda havia assimetria entre **evento emitido** e **evento operacionalmente visível**.

### Situação ideal

1. **cada família de evento tem um owner terminal claro**;
2. **eventos efêmeros continuam efêmeros no wire, mas snapshots operacionais relevantes são promovidos a histórico visível**;
3. **não há caminhos paralelos competindo para narrar o mesmo fato**;
4. **nenhum evento relevante para operação contínua depende apenas de inline status**;
5. **o terminal deixa claro o que é turn do assistente, o que é progresso de tool, o que é background agent, o que é shell, o que é prompt/permission/UI**.

---

## 7. Roadmap complementar por fases e subfases

## Fase A — Consolidar narrativa operacional visível

### Subfase A.1 — remover flashes como portador único de informação

- promover snapshots duráveis de `tool.execution_progress` em `compact`
- promover snapshots duráveis de heartbeat de tool longa em `compact`
- revisar outros usos de `writeInlineStatus(...)` para garantir que sejam auxiliares, não exclusivos

### Subfase A.2 — fechar a família `system.notification`

- manter normalização em `event-handlers/system-notifications.js`
- expor no terminal:
  - `agent.background.completed`
  - `agent.background.idle`
  - `agent.shell.completed`
  - `agent.shell.detached_completed`
- decidir se todos terão histórico durável ou se parte ficará só em activity/SSE

## Fase B — Cobertura explícita das famílias ainda ausentes

### Subfase B.1 — coordenação e capacidades

- `commands.changed`
- `capabilities.changed`
- `auto_mode_switch.requested`
- `auto_mode_switch.completed`
- `exit_plan_mode.requested`

### Subfase B.2 — eventos de integração/hook

- `hook.start`
- `hook.end`
- `sampling.requested`
- `sampling.completed`

## Fase C — Surface terminal de recursos novos do SDK

### Subfase C.1 — uso e billing por evento

- superfície explícita para `assistant.usage` já entregue via `pr.consumed`
- aprofundar correlação com `/sdk quota`, PR e diagnósticos locais

### Subfase C.2 — attachments e capacidades de UI

- suporte terminal a `blob` attachments já entregue em superfície mínima por `/attach blob`
- uso explícito de `session.capabilities.ui` para ajustar UX local

### Subfase C.3 — inputs avançados por turno

- `requestHeaders` por turno já entregues por `/sdk headers` com store one-shot local
- gateway de diálogo faz dispatch SDK direto com reanexo do dialog loop quando necessário
- residual futuro: avaliar se existe no SDK um caminho zero-PR nativo que carregue headers sem bounce explícito

---

## 8. O que foi executado nesta rodada

Nesta rodada adicional, foram iniciados hardenings concretos alinhados a este anexo:

1. snapshots duráveis de progresso de tool em `compact`;
2. heartbeat de tool longa tornando-se visível também no histórico textual do terminal;
3. promoção terminal de `agent.background.completed`, `agent.background.idle`, `agent.shell.completed` e `agent.shell.detached_completed`.

Isso não encerra a trilha, mas corrige imediatamente o tipo de UX que o operador relatou como problemática.

### 8.1. Gate de retomada já fechado

Antes de continuar as próximas fases deste anexo, a baseline de validação foi estabilizada nesta mesma rodada:

- runner misto Vitest corrigido para separar specs Copilot e genéricas por configuração;
- `vitest.copilot.config.js` endurecido para `threads` com concorrência default mais conservadora;
- warnings de teardown zerados;
- `lint`, `typecheck` estrito de `src.copilot`, `typecheck` estrito de testes, `test:copilot:unit` e `test:unit` todos verdes.

Isso importa aqui porque a continuação das fases B e C deste anexo só faz sentido sobre uma baseline de validação confiável e repetível.

---

## 9. Palavra final

O recorte `946–1828` não revelou uma arquitetura quebrada. Revelou algo mais sutil:

**o sistema estava mais maduro no transporte e normalização dos eventos do que na promoção deles para uma UX terminal verdadeiramente operacional.**

Esse é exatamente o tipo de detalhe que, para a LLM-B, não é detalhe.

É contrato de operação contínua.
