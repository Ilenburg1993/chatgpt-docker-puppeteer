**DOCUMENTAÇÃO — Subsistema INFRA**

Propósito: Documentar componentes de infra que suportam execução de drivers e orquestração de
navegadores: BrowserPool, ConnectionOrchestrator, cache de páginas, health checks e políticas.

---

Arquivos e pontos de interesse

- `.puppeteerrc.cjs` — helpers exportados: `isDocker()`, `getCacheDirectory()`,
  `findChromeExecutable()`.
- `src/infra/connection_orchestrator.js` — estratégia de conexão (launcher vs ws endpoint),
  DEFAULTS.
- `src/infra/browser_pool.js` — implementação do pool (checkout, release, health checks, retries).

Componentes principais

- BrowserPool
  - Responsabilidade: gerenciar instâncias de browser/page, isolamento de perfis, reuso controlado e
    políticas de reciclagem.
  - Operações: `acquirePage()`, `releasePage()`, `healthReport()`.
  - Estratégias: keep-alive vs ephemeral pages; cropper de perfis para testes.

- ConnectionOrchestrator
  - Detecta Chrome/Chromium, monta args (no-sandbox, remote-debugging-port), e escolhe strategy:
    `launcher` (iniciar processo local) ou `ws` (conectar a endpoint já pronto).
  - Retry: `maxConnectionAttempts`, `retryDelayMs`.

- Cache e Invalidação
  - `factory.invalidatePageCache(pageId)` remove entradas associadas a pages fechadas/crashed.
  - Recomenda-se TTL de cache e políticas de LRU para perfis long lived.

Health & Observability

- Health checks periódicos (latency, crash rate, open handles) com thresholds configuráveis.
- Métricas: `pages_total`, `pages_in_use`, `recycle_rate`, `connection_failures`.
- Ações automáticas em degradação: reduzir taxa de novas aquisições, reiniciar browser host.

Runbook (problemas comuns)

1. Alta taxa de `connection_failures`:
   - Verificar `ConnectionOrchestrator.detectedChromePath` e `executablePath` em
     `chrome-config.json`.
   - Conferir permissões e dependências do sistema (libs do Chromium em contêineres).

2. Páginas retornando `isPageClosed()` frequentemente:
   - Aumentar políticas de retry no `BrowserPool` e validar `biomechanics` timeouts.
   - Invocar `factory.invalidatePageCache(pageId)` e marcar instância para reciclagem.

3. Memory leak / Browser hangs:
   - Agendar reciclagem periódica de browsers (rotate every N tasks/minutes).
   - Habilitar tracing em modo debug para capturar heap snapshots antes do kill.

Configurações recomendadas

- `maxConnectionAttempts`: 5
- `retryDelayMs`: 3000
- `pageIdleTimeoutMs`: 2m
- `recycleAfterTasks`: 100

Integração com supervisão

- Expor endpoints de health (`/health`), métricas (Prometheus) e logs estruturados.
- Gerenciar restart via PM2 / systemd para hosts que tiverem elevado `connection_failures`.

Testes sugeridos

- Simular `page` crash e validar que `factory.invalidatePageCache()` remove cache e que novo
  `getDriver()` cria instância funcional.
- Testar `ConnectionOrchestrator` em modos `launcher` e `ws` com mocks de Chrome.

---

Próximo: criar documentação de `SERVER` e `CORE` com exemplos de APIs e constantes.
