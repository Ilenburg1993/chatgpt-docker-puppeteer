# R-15 — Backlog de capacidades avançadas

**Programa**: P7 **Status**: pós-base saudável **Objetivo**: concentrar capabilities futuras sem
contaminar a fila estrutural principal

---

## 1. Regra de ouro

Este backlog **não entra antes da base estrutural estar suficientemente saudável**.

Ele é importante, desejável e em vários casos estrategicamente valioso — mas deve ser atacado com as
dependências certas resolvidas.

---

## 2. Fontes principais absorvidas aqui

Este documento herda e reorganiza principalmente:

- `M-07-FASES-FUTURAS.md`
- `ROADMAP-UPGRADES-SRC-COPILOT.md`
- partes capability-driven das auditorias antigas

---

## 3. Trilhas de capacidades avançadas

## C1 — Terminal UX avançado

### Itens típicos

- streaming rico de resposta e thinking display
- renderização Markdown/syntax highlighting
- histórico, busca, bookmarks, export avançado
- comandos adicionais de diagnose, context, audit, errors, usage
- controles de retry/abort/turn management
- multi-session UX no REPL

### Dependência principal

- P4 e P6 suficientemente maduros

## C2 — Session operations avançadas

### Itens típicos

- lifecycle conversacional avançado
- replay detalhado de sessão
- gestão multi-sessão mais rica
- compaction e context window tooling melhores

### Dependência principal

- P2 + P4

## C3 — RPC, automação e orchestration avançada

### Itens típicos

- expansão RPC experimental
- tools orchestration extras
- capabilities de fleet/extension orchestration
- novas superfícies remotas seguras

### Dependência principal

- P2 + P4 + P6

## C4 — TSServer, contexto semântico e inteligência local

### Itens típicos

- integração TSServer
- hover/completion/definition/references/diagnostics como capabilities de runtime
- injeção de contexto semântico adicional

### Dependência principal

- P2 + P5 + P6

## C5 — Observability expandida e dashboards

### Itens típicos

- OTEL export refinado
- dashboards de quotas, health e performance
- métricas de canal/sessão mais profundas
- endpoints adicionais de projection/diagnose

### Dependência principal

- P3 + P4 + P6

## C6 — Plugin ecosystem e extensibilidade

### Itens típicos

- amadurecimento real de `plugins/`
- contratos de extensão
- carregamento/registro seguro de plugins
- fronteiras de capability loading

### Dependência principal

- P5 + P6

## C7 — Prompting, skills e contexto operacional avançado

### Itens típicos

- melhorias de prompt modular
- skills hot reload mais maduro
- contexto operacional dinâmico por sessão
- memória/context orchestration mais sofisticada

### Dependência principal

- P2 + P4 + P5 + P6

---

## 4. Como priorizar este backlog

Uma capability avançada só deve subir de prioridade quando responder “sim” para estas perguntas:

1. a base estrutural necessária já está estável?
2. a capability não vai aumentar o acoplamento central do sistema?
3. há testes, segurança e observability suficientes para sustentá-la?
4. há ownership claro do módulo onde ela vai morar?

Se a resposta for “não” em dois ou mais pontos, ela ainda pertence ao backlog futuro e não à fila
ativa.

---

## 5. Capacidades que parecem atraentes, mas não devem furar fila

- UX terminal muito sofisticada antes de resolver fronteiras `server/terminal/channel`;
- multi-session rica antes de fechar ownership de sessão;
- plugin ecosystem antes de amadurecer `plugins/` e contracts;
- telemetria avançada antes do event model e error pipeline maduros;
- TSServer profundo antes de a base de typing/contratos estar melhor consolidada.

---

## 6. Resultado esperado deste anexo

Este documento existe para proteger a disciplina do roadmap.

Ele diz, explicitamente:

- **sim**, há muito futuro interessante para `src/copilot/`;
- **não**, isso não deve disputar a mesma prioridade da base arquitetural que ainda precisa ser
  fechada.

A melhor capability avançada do mundo continua sendo um problema se ela pousar em fundação torta.
