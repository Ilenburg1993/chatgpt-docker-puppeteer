# R-12 — Programa 5: `tools/`, `config/`, `core/`, `infra/`, `types/` e `plugins/`

**Programa**: P5 **Prioridade**: média-alta **Foco**: consolidar a plataforma interna que sustenta o
runtime, as policies e os contratos compartilhados

---

## 1. Objetivo

P5 existe para evitar que a base interna do sistema continue crescendo por acúmulo silencioso.

Se P1–P4 cuidam dos grandes fluxos e fronteiras, P5 cuida da plataforma que esses fluxos usam o
tempo todo.

---

## 2. Diagnóstico de partida

### Sinais principais

- `tools/` já soma **7.101L** e segue crescendo;
- `config/` já soma **2.550L**;
- `core/` já soma **3.146L**;
- `infra/` está melhor, mas ainda precisa ownership mais claro;
- `types/` segue pequeno demais para a massa contratual existente;
- `plugins/` e `logs/` ainda têm taxonomia/escopo pouco maduros.

---

## 3. Fases

## F5.1 — Governança da plataforma de tools

### Subfases

- F5.1.a — revisar ownership de bootstrap/registry/state das tools
- F5.1.b — reduzir pontos de acoplamento entre tools, runtime e observability
- F5.1.c — alinhar categorias, factories, métricas e permission surfaces
- F5.1.d — separar melhor plataforma de tools de backlog de ferramentas futuras

### Resultado esperado

`tools/` permanece poderoso sem virar mini-sistema autônomo de governança duvidosa.

## F5.2 — Normalização de `config/`

### Subfases

- F5.2.a — separar builders, defaults e runtime state de configuração
- F5.2.b — consolidar relação entre `config/`, `sdk/` e `agent/`
- F5.2.c — revisar system prompt, pinned files, MCP config e registry de tools sob a ótica da nova
  arquitetura

### Resultado esperado

`config/` vira base declarativa e construtora clara, não arquivo-caixa-preta de tudo que é opção.

## F5.3 — Hardening de `core/`

### Subfases

- F5.3.a — revisar exports centrais e barrels excessivos
- F5.3.b — separar contratos centrais de conveniências periféricas
- F5.3.c — alinhar utilitários fundamentais com o modelo de camadas alvo

### Resultado esperado

`core/` volta a ser base, e não um atalho sedutor para qualquer import.

## F5.4 — Ownership de `infra/`

### Subfases

- F5.4.a — revisar queues, locks, timers e storage como recursos compartilhados
- F5.4.b — reduzir duplicações locais de mecanismos técnicos
- F5.4.c — alinhar responsabilidade de infraestrutura com `core/`, `db/` e runtime services

### Resultado esperado

Infraestrutura mais previsível, menos duplicada e mais claramente reutilizável.

## F5.5 — Elevação de `types/`

### Subfases

- F5.5.a — mapear contratos hoje dispersos entre `sdk`, `core`, `agent` e `server`
- F5.5.b — promover tipos compartilhados realmente centrais
- F5.5.c — reduzir tipagem incidental espalhada em arquivos grandes

### Resultado esperado

`types/` deixa de ser pequeno demais para o papel que o sistema já exige dele.

## F5.6 — Destino de `plugins/` e `logs/`

### Subfases

- F5.6.a — decidir se `plugins/` é eixo atual ou backlog futuro
- F5.6.b — redefinir ou eliminar `logs/` como taxonomia vazia
- F5.6.c — impedir que diretórios embrionários criem ruído estrutural sem ownership real

### Resultado esperado

Menos espaços mortos e menos “promessa de módulo” sem programa de maturação.

---

## 4. Critérios de conclusão

- plataforma de tools mais governada;
- `config/` mais previsível e menos ambíguo;
- `core/` endurecido como camada central;
- `infra/` com ownership mais claro;
- `types/` mais representativo;
- `plugins/` e `logs/` com destino arquitetural explícito.

---

## 5. Dependências relevantes

- depende do fechamento das fronteiras de P1–P4 para não consolidar abstrações erradas;
- conversa com P6 em typing, docs, segurança e performance;
- alimenta P7 ao organizar a base para capacidades futuras.

---

## 6. Riscos principais

- reorganizar `core/` e `types/` sem estratégia incremental de imports;
- expandir `types/` sem critério e criar outro barrel gordo;
- deixar `tools/` crescer em capabilities sem primeiro fechar sua governança interna.

---

## 7. Resultado esperado

Ao concluir P5, `src/copilot/` terá uma base de plataforma interna muito mais nítida, com menos
espalhamento silencioso de contratos e menos crescimento “natural” por conveniência.
