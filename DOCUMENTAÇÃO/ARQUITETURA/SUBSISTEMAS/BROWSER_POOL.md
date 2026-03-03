**Status**: Canônico de apoio.  
**Escopo**: aprofundamento da subtrilha `src/infra/browser_pool/`.  
**Quando consultar**: ao alterar alocação de páginas, health monitoring CDP, circuit breaker de
browser, validação de página ou enforcement arquitetural do Chrome externo.  
**Documento-mestre relacionado**: [ARCHITECTURE.md](../ARCHITECTURE.md).

# BROWSER POOL

**Propósito**: documentar `src/infra/browser_pool/` como a camada soberana de pool e saúde do
ambiente browser.  
**Status documental**: Canônico de apoio.  
**Público**: engenharia, manutenção e agentes de IA.  
**Última atualização**: 28 de fevereiro de 2026.

## Papel arquitetural

`src/infra/browser_pool/` é onde a arquitetura "Chrome externo + páginas geridas pelo runtime" vira
implementação concreta. Essa trilha:

- conecta ao browser via endpoint remoto;
- aloca e recicla páginas;
- monitora saúde das páginas e conexões;
- classifica falhas;
- reforça o guardrail contra `puppeteer.launch()`.

## Componentes principais

### `pool_manager.js`

É a peça central do subsistema.

Responsabilidades observáveis:

- inicializar o pool com múltiplas instâncias lógicas;
- exigir explicitamente `browserEndpoint.url`;
- usar `ConnectionOrchestrator` para conectar ao browser já existente;
- selecionar instância por estratégia de alocação;
- validar páginas antes da entrega;
- manter estatísticas globais e estado de lifecycle;
- integrar `CircuitBreakerManager` e `PeriodicHealthMonitor`.

### `circuit_breaker.js`

É o classificador de falhas do plano browser.

Responsabilidades:

- registrar falhas por instância;
- distinguir causas como `USER_CLOSED`, `TECHNICAL_CRASH`, `PROXY_FAILURE`, `OUT_OF_MEMORY`,
  `NETWORK_ISSUE`;
- projetar estado do circuito (`OPERATIONAL`, `DEGRADED`, `CIRCUIT_OPEN`);
- decidir políticas de pausa, polling e retry por causa.

### `PageValidator.js`

É a validação de página antes da alocação.

Responsabilidades:

- detectar `page` nula, fechada ou desconectada;
- validar domínio esperado por target;
- checar readiness do DOM;
- retornar issues categorizadas por severidade.

### `PageLifecycleMonitor.js`

É o monitor por página alocada.

Responsabilidades:

- ouvir `close`, `error` e `disconnected`;
- remover páginas do pool quando necessário;
- atualizar métricas;
- emitir sinais para NERV quando configurado;
- fazer cleanup de listeners.

### `PeriodicHealthMonitor.js`

É o monitor periódico em modo CDP-only.

Responsabilidades:

- rodar checks periódicos de conexão;
- coletar métricas de memória/heap/DOM quando possível;
- emitir eventos de warning, critical e recovery needed;
- alternar para modo crítico com maior frequência de checks;
- operar sem depender de acesso ao processo do browser.

### `puppeteer_guard.js`

É a lei técnica do subsistema.

Responsabilidades:

- interceptar `puppeteer.launch()` quando o guard está ativo;
- transformar o uso de launch em erro arquitetural explícito;
- reforçar que o sistema opera apenas com `puppeteer.connect()`.

## Fluxos principais

### Fluxo de boot

1. O pool recebe `browserEndpoint.url`.
2. `pool_manager.js` usa `ConnectionOrchestrator`.
3. As instâncias lógicas são conectadas.
4. O monitor periódico e o circuit breaker são ativados.

### Fluxo de alocação

1. Um caller pede uma página.
2. O pool seleciona uma instância saudável.
3. Cria uma nova página.
4. `PageValidator` valida a página.
5. `PageLifecycleMonitor` anexa listeners.
6. A página é entregue ao driver.

### Fluxo de degradação

1. Uma falha ocorre.
2. O circuit breaker classifica a causa.
3. O estado do pool muda para `DEGRADED` ou `CIRCUIT_OPEN`.
4. Health monitor e callers ajustam o comportamento operacional.

## Relação com outros subsistemas

### Browser Pool x Driver

- o driver depende desta trilha para receber páginas utilizáveis;
- problemas aqui costumam aparecer primeiro como falha de execução no driver.

### Browser Pool x Infra

- é uma subtrilha crítica da própria infraestrutura;
- conversa com proxy, orchestrator de conexão e regras globais de infra.

### Browser Pool x Server / Observabilidade

- degradações e métricas podem ser refletidas em supervisão e dashboards.

## Restrições e guardrails

- `browserEndpoint.url` continua obrigatório.
- O subsistema não deve reintroduzir browser local.
- `puppeteer.launch()` permanece proibido como padrão arquitetural.
- Falhas do pool devem ser classificadas, não tratadas como erro genérico.

## Referências no código

- `src/infra/browser_pool/pool_manager.js`
- `src/infra/browser_pool/circuit_breaker.js`
- `src/infra/browser_pool/PageValidator.js`
- `src/infra/browser_pool/PageLifecycleMonitor.js`
- `src/infra/browser_pool/PeriodicHealthMonitor.js`
- `src/infra/browser_pool/puppeteer_guard.js`
