# Critérios de Sucesso por Aspecto — `src/copilot`

## 1. Propósito

Este documento existe para tornar a transformação menos genérica e mais executável.

Ele define, por aspecto arquitetural, **critérios claros de sucesso**, **sinais de fracasso** e
**evidências mínimas** esperadas.

## 2. Aspecto A — Ownership

### Sucesso

- cada domínio crítico possui um owner inequívoco;
- nenhum fluxo importante depende de “inferir” quem manda;
- qualquer novo reader sabe onde está a SSOT sem precisar consultar 3 módulos.

### Falha

- duas camadas continuam publicando a mesma verdade operacional;
- o sistema ainda depende de fallback informal entre runtime, store, snapshot e projection.

### Evidência mínima

- tabela de ownership atualizada;
- redução de helpers duplicados;
- testes/contratos refletindo o owner único.

## 3. Aspecto B — Fronteiras

### Sucesso

- fronteiras entre runtime, vendor, conversa, transporte, frontend e HTTP estão explícitas;
- bordas não importam umas às outras de forma indevida;
- projections ficam em `presentation/`, não em múltiplos módulos.

### Falha

- `server` voltar a importar `terminal`;
- `terminal` voltar a arbitrar runtime truth;
- `presentation/` virar orchestrator disfarçado.

### Evidência mínima

- imports cross-module reduzidos nas bordas;
- contract tests garantindo fronteiras.

## 4. Aspecto C — Estado compartilhado

### Sucesso

- `shared-state` contém só binding mínimo;
- caches/registries têm owner, TTL ou cleanup explícito;
- singletons têm lifecycle explícito.

### Falha

- novos estados de processo surgem em lugares sem owner claro;
- `Map()` continua sendo usado como store informal sem política de descarte.

### Evidência mínima

- redução de singletons locais e service-locator ad hoc;
- documentação explícita dos registries restantes.

## 5. Aspecto D — Boundary do vendor SDK

### Sucesso

- imports diretos de `@github/copilot-sdk` ficam concentrados no boundary pretendido;
- `sdk/` fala com o vendor; os demais consomem o wrapper;
- ownership de sessão SDK deixa de vazar para módulos alheios.

### Falha

- `config/`, `server/`, `agent/` e `terminal/` continuam reabrindo o vendor;
- a sessão SDK continua sendo interpretada localmente em muitos lugares.

### Evidência mínima

- contagem de imports diretos do vendor em queda consistente;
- registry e projections canônicos usados nas bordas.

## 6. Aspecto E — Eventos e observação

### Sucesso

- `events/` nomeia;
- `event-handlers/` reage semanticamente;
- `hooks/` aplica política;
- `observability/` coleta, mede e projeta saúde.

### Falha

- `observability/` volta a decidir semântica de domínio;
- collectors e handlers continuam fazendo partes equivalentes do mesmo trabalho;
- múltiplas pipelines de EventBus coexistem sem owner único.

### Evidência mínima

- runtime canônico de observação do EventBus;
- health observability com fonte única;
- menos arestas transversais para `observability/`.

## 7. Aspecto F — Terminal-first

### Sucesso

- `terminal/` é frontend principal da LLM-B;
- o frontend consome SSOTs corretas via seams locais;
- comandos, dialog, repl e wiring não reabrem integrações transversais aleatoriamente.

### Falha

- `terminal/` volta a virar pseudo-backend ou pseudo-runtime;
- DI difusa reaparece em `commands/`, `dialog/` ou `repl*`.

### Evidência mínima

- `terminal/frontend/*` é a seam local canônica;
- DI direta do terminal segue baixa ou cai ainda mais;
- contract tests do boundary principal passam.

## 8. Aspecto G — Observability

### Sucesso

- `observability/` deixa de ser hiperhub opaco;
- subsistemas internos têm papéis claros:
  - collector
  - observer
  - bus runtime
  - error tracking
  - health projection
- a superfície pública do módulo fica mais coerente.

### Falha

- `event-bus-observers.js`, `bus-actions/*` e `agent-event-observer.js` continuam sobrepostos;
- não existe um owner único do runtime de observação do EventBus.

### Evidência mínima

- runtime canônico de EventBus criado e consumido no bootstrap;
- compat shim legado reduzido a adapter;
- health de `observability` exposto no registry de módulos.

## 9. Aspecto H — Testabilidade

### Sucesso

- cada transformação estrutural deixa um contract test explícito;
- testes validam fronteira, não só comportamento feliz.

### Falha

- mudanças de arquitetura só são “validadas” por inspeção visual;
- suposição de ownership não está codificada em testes.

### Evidência mínima

- testes de contrato e integração focada por programa.

## 10. Aspecto I — Saída real de uma transformação

Uma transformação só é considerada bem-sucedida quando entrega simultaneamente:

1. mudança objetiva no código;
2. redução mensurável de ambiguidade arquitetural;
3. teste ou contrato novo segurando a fronteira;
4. documentação atualizada com a nova verdade.
