# R-13 — Programa 6: Segurança, qualidade e governança

**Programa**: P6 **Prioridade**: alta e contínua **Foco**: tratar segurança, testes, typing,
performance, documentação e dívida como gates reais do ciclo de rearquitetura

---

## 1. Objetivo

P6 existe para impedir que a rearquitetura clean produza apenas “arquitetura melhor no diagrama”.

Sem P6, as outras ondas correm o risco de:

- mover acoplamento de lugar;
- melhorar nomes e piorar confiabilidade;
- criar docs novas e repetir a entropia documental antiga;
- trocar um módulo gordo por três módulos mal testados.

---

## 2. Fases

## F6.1 — Segurança por superfície crítica

### Subfases

- F6.1.a — revisar endpoints HTTP/SSE/Socket críticos
- F6.1.b — revisar auth, permission flow e superfícies de execução sensíveis
- F6.1.c — revisar validação de input, URLs, paths e comandos
- F6.1.d — alinhar audit trail para falhas de autenticação, permissão e execução

### Resultado esperado

Segurança deixa de aparecer só como backlog lateral e passa a operar como gate do ciclo.

## F6.2 — Matriz de testes por domínio

### Subfases

- F6.2.a — mapear cobertura por módulo e por contrato de fronteira
- F6.2.b — definir suites obrigatórias por programa
- F6.2.c — fechar gaps críticos em `server/`, `events/`, `hooks/`, `channel/`, `core/` e outros
  eixos assimétricos
- F6.2.d — separar testes de contrato, integração e regressão ampla

### Resultado esperado

A qualidade deixa de depender de “testes que por acaso pegam o problema”.

## F6.3 — Typing, JSDoc e contratos compartilhados

### Subfases

- F6.3.a — reduzir `any` onde ele mascara contratos importantes
- F6.3.b — reforçar JSDoc em APIs públicas reais
- F6.3.c — alinhar typedefs, barrels e import surfaces
- F6.3.d — tornar typing parte do acceptance de cada programa

### Resultado esperado

Mais contratos explícitos, menos semântica implícita em runtime.

## F6.4 — Performance, leaks e runtime hygiene

### Subfases

- F6.4.a — revisar timers, intervals e cleanup
- F6.4.b — revisar queues, retries, backpressure e recursos persistentes
- F6.4.c — revisar pontos de swallow silencioso de erro e fire-and-forget inseguro
- F6.4.d — alinhar métricas de performance com observability madura

### Resultado esperado

Menos custo operacional escondido e menos “funciona até cansar”.

## F6.5 — Deprecateds, dead code e taxonomia residual

### Subfases

- F6.5.a — mapear todos os `@deprecated` ativos
- F6.5.b — classificar deprecateds em remover, migrar, manter temporariamente
- F6.5.c — limpar wrappers, diretórios vazios e taxonomias mortas
- F6.5.d — impedir que compatibilidade residual vire estado permanente

### Resultado esperado

O repositório para de carregar dívida histórica sem dono.

## F6.6 — Governança documental contínua

### Subfases

- F6.6.a — manter esta linha clean como hub canônico das próximas ondas
- F6.6.b — atualizar pontes mínimas com o acervo legado quando necessário
- F6.6.c — evitar nova explosão de taxonomias paralelas
- F6.6.d — manter backlog estrutural e backlog de capabilities separados

### Resultado esperado

A documentação volta a servir ao código, em vez de pedir que o código sirva à arqueologia dos
documentos.

---

## 3. Critérios de conclusão

- security gates claros por superfície crítica;
- matriz de testes por domínio/programa;
- typing/JSDoc operando como parte do done;
- limpeza real de deprecateds e dívida residual;
- governança documental sustentável durante a execução do roadmap.

---

## 4. Natureza deste programa

P6 não é “uma fase do fim”.

Ele é transversal e contínuo. Em especial:

- começa na Onda A;
- endurece nas Ondas B e C;
- fecha grande parte da dívida na Onda D.

---

## 5. Riscos se P6 for enfraquecido

- rearquitetura sem garantia real de qualidade;
- regressões silenciosas acumuladas;
- documentação nova repetindo os vícios da antiga;
- falsa sensação de segurança arquitetural.

---

## 6. Resultado esperado

Ao concluir P6, a rearquitetura clean deixa de ser só uma reorganização estrutural e vira um
processo de evolução governada, medível e mais segura.
