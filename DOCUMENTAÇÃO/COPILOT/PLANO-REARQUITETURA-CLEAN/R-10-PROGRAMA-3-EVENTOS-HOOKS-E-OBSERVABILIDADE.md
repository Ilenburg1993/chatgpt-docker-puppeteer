# R-10 — Programa 3: Eventos, hooks e observabilidade

**Programa**: P3
**Prioridade**: alta
**Foco**: governar o ecossistema transversal que hoje conecta metade do sistema por emissão, observação e políticas

---

## 1. Objetivo

P3 existe para resolver um problema sistêmico:

- muitos eventos;
- muitas emissões;
- muitos listeners;
- muito `observability/` importado diretamente;
- e hooks/policies ainda próximos demais do runtime.

Em bom português: o sistema conversa bastante consigo mesmo. O objetivo agora é fazer isso de modo menos caótico e mais governável.

---

## 2. Diagnóstico de partida

### Sinais atuais

- **713** referências ligadas a EventBus/emissão;
- **93** imports de `observability`;
- `event-handlers/` já existe, mas ainda precisa de fechamento arquitetural;
- `hooks/` soma **4.610L** e ainda participa de várias fronteiras críticas.

---

## 3. Fases

## F3.1 — Governança do event model

### Subfases

- F3.1.a — inventariar eventos canônicos por domínio
- F3.1.b — diferenciar eventos de domínio, integração, health e telemetria
- F3.1.c — definir naming, schemas, ownership e lifecycle dos eventos
- F3.1.d — definir quais bridges são permanentes e quais são transitórias

### Resultado esperado

Eventos deixam de ser apenas um meio de transporte e passam a ser um contrato mais explícito.

## F3.2 — Unificação prática de bridges e naming

### Subfases

- F3.2.a — consolidar bridges entre SDK, hooks, EventBus e runtime
- F3.2.b — reduzir bridging manual residual
- F3.2.c — alinhar naming/convenções de emissão e consumo

### Resultado esperado

Menos mental models paralelos para o mesmo ecossistema de eventos.

## F3.3 — Fronteira entre `event-handlers/`, hooks e observers

### Subfases

- F3.3.a — consolidar o papel de `event-handlers/` como reações semânticas de domínio
- F3.3.b — separar claramente side effects de domínio de coleta de métricas
- F3.3.c — reduzir sobreposição entre handlers, collectors, observers e hooks

### Resultado esperado

Cada camada passa a reagir ao evento certo, pelo motivo certo.

## F3.4 — Error pipeline, health e projections

### Subfases

- F3.4.a — consolidar error pipeline
- F3.4.b — alinhar alerting, tracking, projections e health
- F3.4.c — reduzir duplicações entre observability, server e runtime

### Resultado esperado

Saúde, erro e projeções operacionais viram pipeline coerente, não mosaico de subsistemas.

## F3.5 — Dieta de `observability/`

### Subfases

- F3.5.a — mapear imports realmente necessários
- F3.5.b — reduzir pontos de consumo direto
- F3.5.c — preferir superfícies mais estáveis para logging/metrics/tracing

### Resultado esperado

`observability/` deixa de ser uma espécie de onipresença mística do sistema.

## F3.6 — Alinhamento com `audit/`

### Subfases

- F3.6.a — separar audit trail estrutural de observability operacional
- F3.6.b — evitar duplicação entre métricas, erro e trilha auditável
- F3.6.c — alinhar formato, ownership e consumo do subsistema `audit/`

### Resultado esperado

`audit/` e `observability/` convivem melhor e brigam menos pelo mesmo problema.

---

## 4. Critérios de conclusão

- event model mais governado e menos difuso;
- fronteiras claras entre handlers, hooks e observers;
- error pipeline consolidado;
- health projections mais canônicas;
- redução material do consumo direto de `observability/`;
- menos bridging manual residual.

---

## 5. Dependências relevantes

- depende do avanço de P1 e P2 para não consolidar contratos errados;
- alimenta P4, porque server/terminal/health precisam dessas projeções;
- conversa com P6 em testes, segurança e governança.

---

## 6. Riscos principais

- tentar “unificar tudo” rápido demais e quebrar contratos invisíveis;
- manter observers e handlers duplicados por medo de remover o antigo;
- reforçar EventBus sem reforçar governança, o que só mudaria o nome do problema.

---

## 7. Resultado esperado

Ao concluir P3, o sistema deve continuar orientado a eventos — mas de forma muito mais legível, contratual e sustentável.
