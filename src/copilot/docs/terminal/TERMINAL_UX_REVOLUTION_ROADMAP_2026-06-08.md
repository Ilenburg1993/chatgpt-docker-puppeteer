# Terminal UX Revolution Roadmap

Data: 2026-06-08

Escopo primário: `src/copilot/terminal`

Escopo associado: `src/copilot/agent`, `src/copilot/presentation`, `src/copilot/sdk`,
`src/copilot/model-gateway`

Estado de entrada: o operador relatou uma UX visualmente ruidosa, desalinhada e pouco previsível no
terminal LLM-B. As screenshots mostraram repetição de linhas de espera, ids internos visíveis, nomes
técnicos como `report_intent`, `request_user_input` renderizado como tool comum, linhas não
alinhadas, excesso de texto operacional e erro final por falta de resposta humana.

Este documento é o guia de execução para a próxima faixa de trabalho depois da estabilização SDK
1.0. O objetivo não é apenas "embelezar", mas criar uma gramática operacional única: técnica,
fluida, legível, elegante e fiel ao que a LLM-B está fazendo.

---

## Fontes Lidas Nesta Retomada

- [x] Screenshots anexadas pelo operador.
- [x] `src/copilot/terminal/repl/live-status-line.js`
- [x] `src/copilot/terminal/dialog/turn-display.js`
- [x] `src/copilot/terminal/events/tool-activity-presenter.js`
- [x] `src/copilot/terminal/events/intent-presenter.js`
- [x] `src/copilot/terminal/events/human-question-renderer.js`
- [x] `src/copilot/terminal/state/display-policy.js`
- [x] `src/copilot/terminal/state/time-format.js`
- [x] `src/copilot/terminal/state/sdk-interactions.js`
- [x] `src/copilot/terminal/events/sdk-session-events.js`
- [x] `src/copilot/terminal/wiring/terminal-agent-wiring.js`
- [x] `src/copilot/agent/dialog/*` por `rg` de `ask_user` e `request_user_input`.

---

## Diagnóstico Atual

- [x] A linha viva existe e já tenta não ocupar o input.
- [x] A linha viva coleta runtime, stream meta, tool activity e perguntas pendentes.
- [x] Há renderer dedicado para perguntas humanas.
- [x] Há presenter dedicado para tools.
- [x] Há presenter dedicado para intents.
- [x] Há política de display por preset/toggles.
- [x] Há formatador de tempo com modo ISO/dual.
- [x] Há sanitização de texto de deltas e proteção contra ANSI injetado.
- [x] Há normalização de nomes humanos para muitas tools.
- [x] O terminal já possui gateways para evitar imports diretos de camadas proibidas.

---

## Bugs E Gaps Confirmados

- [ ] UX-A01: linha viva pode repetir "LLM-B ainda trabalhando" em histórico, poluindo a tela quando
      não há delta.
- [x] UX-A02: `request_user_input` ainda pode aparecer como tool comum em algumas superfícies, em
      vez de card/estado de pergunta humana.
- [ ] UX-A03: ids internos como `chatcmpl-tool-*` ainda aparecem em linhas de execução ou espera.
- [ ] UX-A04: `report_intent` e `report_intent_local` ainda aparecem como nomenclatura técnica em
      algumas superfícies.
- [ ] UX-A05: intent, tool, thinking e wait não compartilham uma gramática visual única.
- [ ] UX-A06: timestamps não são ISO 8601 completos em todas as superfícies relevantes.
- [ ] UX-A07: linha viva e histórico não têm dedupe/cooldown global por tipo de evento.
- [x] UX-A08: ferramentas de pergunta humana aparecem repetidamente enquanto o modelo aguarda input.
- [x] UX-A17: heartbeat de `request_user_input`/`ask_user` deixa de ser renderizado como tool longa.
- [ ] UX-A09: ausência de resposta humana pode virar erro final pouco claro, em vez de estado
      persistente acionável.
- [ ] UX-A10: seleção/troca automática de modelo ainda precisa ser comunicada com motivo, origem,
      modelo anterior, modelo novo e confidence.
- [ ] UX-A11: terminal não separa suficientemente "evento histórico" de "estado vivo transitório".
- [ ] UX-A12: alguns textos usam verbos técnicos ou ingleses quando deveriam usar labels humanos
      curtos.
- [ ] UX-A13: alinhamento visual depende de strings locais e não de um layout/token system central.
- [ ] UX-A14: cores existem, mas não há matriz canônica por papel semântico.
- [ ] UX-A15: outputs de tools, deltas e waits competem com input em sessões longas.
- [ ] UX-A16: lives LLM-B precisam ser executados com observação literal do terminal, não apenas
      logs.

---

## Situação Ideal

- [ ] O prompt do operador está sempre pronto e visualmente separado da linha viva.
- [ ] A linha viva é uma única linha transitória, atualizada por estado, nunca por spam histórico.
- [ ] O histórico mostra apenas eventos relevantes, deduplicados, com labels humanos e timestamps
      ISO 8601 completos.
- [ ] Pergunta humana não é tool comum: é estado de interação com card compacto e resposta
      acionável.
- [ ] Tools têm ciclo claro: início, progresso opcional, conclusão ou falha.
- [ ] Intents têm nome humano: "Intenção capturada", "Objetivo", "Risco", "Origem", sem
      `report_intent` cru.
- [ ] IDs internos são ocultados por default e mostrados apenas em modo debug/verbose.
- [ ] Thinking mostra estado e resumo, não despeja conteúdo bruto automaticamente.
- [ ] Deltas parciais aparecem como fala da LLM-B, com transição suave para resposta final.
- [ ] Troca automática de modelo aparece como evento de modelo, não como erro ou linha genérica.
- [ ] Quota/rate-limit/model failure aparecem com classe, escopo, reset/retry quando conhecido e
      ação recomendada.
- [ ] O sistema usa uma matriz central de papel semântico: usuário, LLM, thinking, tool, question,
      intent, model, warning, error, muted, debug.
- [ ] Todos os renderers usam os mesmos helpers de compactação, tempo, id interno e layout.
- [ ] O terminal suporta modo `default`, `focus`, `minimal`, `verbose`, `debug` sem duplicar lógica.
- [ ] Testes live com LLM-B cobrem pergunta humana, tools, deltas, modelo, erro, retry, silêncio e
      finalização.

---

## Roadmap

### Faixa A - Gramática Visual Canônica

- [ ] A.1 Criar matriz central de roles visuais para LLM, usuário, thinking, tools, question,
      intent, model, warning, error, muted e debug.
- [ ] A.2 Auditar `terminalTheme*` e consolidar helpers de headline, row, chip, divider e inline.
- [ ] A.3 Definir largura, truncamento e alinhamento para labels e detalhes.
- [ ] A.4 Padronizar separadores sem excesso decorativo.
- [ ] A.5 Criar política de "id interno": oculto por default, compacto em verbose, completo em
      debug.

### Faixa B - Linha Viva

- [ ] B.1 Separar estritamente linha viva transitória de histórico persistente.
- [ ] B.2 Garantir que a linha viva nunca consuma o input.
- [ ] B.3 Adicionar estado explícito para pensando, usando tool, carregando contexto, aguardando
      input, streaming, finalizando, trocando modelo e erro recuperável.
- [ ] B.4 Adicionar dedupe por assinatura e cooldown para waits silenciosos.
- [x] B.8 Suprimir heartbeats de pergunta humana do ciclo visual de tool longa.
- [ ] B.5 Remover spam de "sem saída incremental" do histórico normal.
- [ ] B.6 Mostrar duração compacta na linha viva e ISO completo no histórico.
- [ ] B.7 Testar em larguras pequenas e grandes.

### Faixa C - Pergunta Humana

- [x] C.1 Garantir que heartbeats de `request_user_input` e `ask_user` não sejam renderizados como
      tool longa.
- [ ] C.2 Mostrar uma única entrada histórica por pergunta pendente.
- [ ] C.3 Atualizar linha viva enquanto aguarda resposta sem repetir card.
- [ ] C.4 Mostrar ação curta: "responda direto" ou `/answer <texto>`.
- [ ] C.5 Evitar erro final por timeout sem antes renderizar estado acionável claro.
- [ ] C.6 Distinguir pergunta livre, seleção, confirmação e formulário estruturado.

### Faixa D - Tools

- [ ] D.1 Padronizar nomes humanos para built-ins, MCP, SDK e tools locais.
- [ ] D.2 Esconder ids internos de tool call no modo default.
- [ ] D.3 Mostrar alvo principal: arquivo, diretório, comando, URL, busca ou patch.
- [ ] D.4 Evitar linhas duplicadas de início/progresso/conclusão.
- [ ] D.5 Separar tool read-only, write, shell, web, MCP e question por cor/role.
- [ ] D.6 Renderizar falhas com causa e ação, não apenas "falhou".

### Faixa E - Intents

- [ ] E.1 Trocar `report_intent` cru por "Intenção capturada".
- [ ] E.2 Mostrar risco com label humano e cor consistente.
- [ ] E.3 Mostrar origem sem ids internos por default.
- [ ] E.4 Compactar objetivos longos.
- [ ] E.5 Dedupe intents repetidas dentro do mesmo turno.

### Faixa F - Streaming E Thinking

- [ ] F.1 Garantir início claro de resposta da LLM-B.
- [ ] F.2 Mostrar deltas parciais sem quebrar input.
- [ ] F.3 Finalizar resposta sem repetir conteúdo final quando o stream já foi íntegro.
- [ ] F.4 Mostrar mismatch stream/final como diagnóstico debug, não ruído default.
- [ ] F.5 Thinking deve ser observável por estado e comando `/thinking`, não por dump automático.

### Faixa G - Modelo E BYOK

- [ ] G.1 Mapear eventos de troca automática de modelo para apresentação dedicada.
- [ ] G.2 Mostrar modelo anterior, novo, provider, motivo e política.
- [ ] G.3 Mostrar quota/rate-limit como evento de saúde da rota/modelo.
- [ ] G.4 Integrar com model-gateway sem duplicar logs.
- [ ] G.5 Testar falha `sdk stream failed`, fallback e replanejamento.

### Faixa H - Timestamps E Estrutura

- [ ] H.1 Todos os eventos históricos relevantes usam ISO 8601 completo.
- [ ] H.2 Linha viva pode usar duração compacta.
- [ ] H.3 Export/JSON preserva ids e payloads técnicos.
- [ ] H.4 Terminal default mostra superfície humana.
- [ ] H.5 Debug mostra envelope técnico sob demanda.

### Faixa I - Live Tests LLM-B

- [ ] I.1 Planejar cenários live antes de rodar.
- [ ] I.2 Rodar cenário: pergunta simples sem tool.
- [ ] I.3 Rodar cenário: leitura de arquivo.
- [ ] I.4 Rodar cenário: criação/movimento/deleção de arquivo em sandbox controlado.
- [ ] I.5 Rodar cenário: pergunta humana/ask_user.
- [ ] I.6 Rodar cenário: troca de modelo ou fallback.
- [ ] I.7 Rodar cenário: ausência de delta / espera longa.
- [ ] I.8 Capturar terminal como operador vê e comparar contra este roadmap.

### Faixa J - Bibliotecas Auxiliares Depois Da UX Base

- [ ] J.1 Investigar `gum` em documentação oficial.
- [ ] J.2 Investigar `fzf` em documentação oficial.
- [ ] J.3 Investigar `bat` em documentação oficial.
- [ ] J.4 Investigar `glow` em documentação oficial.
- [ ] J.5 Investigar `delta` em documentação oficial.
- [ ] J.6 Investigar `atuin` em documentação oficial.
- [ ] J.7 Investigar `zoxide` em documentação oficial.
- [ ] J.8 Investigar `jq/yq` para contratos estruturados.
- [ ] J.9 Implementar apenas após decisão arquitetural, fallback e portabilidade.

---

## Prioridade Imediata

1. [ ] Corrigir linha viva para dedupe/cooldown de waits e pergunta humana.
2. [ ] Centralizar formatadores de ids internos e labels técnicos.
3. [ ] Corrigir apresentação de intents e tools para remover nomes crus.
4. [ ] Garantir timestamps ISO em histórico.
5. [ ] Rodar live LLM-B curta e iterar.

---

## Execução Em 2026-06-08

- [x] Criado este roadmap após estabilização SDK 1.0.
- [x] Corrigida supressão robusta de heartbeat para `ask_user`/`request_user_input`, incluindo
      eventos incompletos com `external_tool`, `canonicalName`, detalhe textual ou ids internos.
- [x] Adicionado teste unitário para impedir regressão de
      `request_user_input ainda executando`/`chatcmpl-tool-*` como linha viva ou histórico de tool
      longa.
