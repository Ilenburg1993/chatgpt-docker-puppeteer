# Auditoria - `src/main.js` & `src/server/main.js`

Este documento centraliza as observações iniciais sobre o processo de _boot_ e _shutdown_ dos dois
entrypoints mais críticos do repositório. Ele será atualizado continuamente conforme problemas são
corrigidos e melhorias são aplicadas.

> Nota: muitos `BUG-0xx` já foram inseridos no código; este relatório complementa esses avisos com
> análises mais amplas e propostas de aprimoramento.

---

## 1. Observações gerais

- O fluxo de inicialização é incrementalmente robusto, com validações "pós-instantiation" e
  fail‑fast. Ainda assim, a função `boot()` em `src/main.js` e `bootstrap()` em `src/server/main.js`
  são muito grandes (2 K+ linhas cada) e mixam lógica de infraestrutura, validação e telemetria. Um
  refactor em fases nominais (por exemplo, mover cada fase para um módulo e aplicar um orquestrador
  simples) reduziria a superfície de bugs e facilitaria os testes.
- Há repetição de patterns (leitura/validação de `env`, `checkPortInUse`, retryWithBackoff, etc.)
  que poderiam ser extraídos para utilitários comuns.
- Logging usa strings concatenadas para contexto. Sempre que possível, enviar objetos estruturados
  (`log('INFO', 'message', {foo, bar})`) permitirá consumo por sistemas de monitoramento.

---

## 2. Bugs e falhas identificadas

### 2.1 `checkPortInUse()` resolve `false` em qualquer erro não‑EADDRINUSE

```js
server.once('error', err => {
  if (err.code === 'EADDRINUSE') {
    resolve(true); // Porta em uso
  } else {
    resolve(false);
  }
});
```

> Se a chamada falhar por outra razão (por exemplo, EACCES, EINVAL), a função indica que a porta
> está livre, o que pode levar à tentativa de bind e crash subsequente. Deve propagar o erro ou, ao
> menos, logá‑lo.

**Correção sugerida:** rejeitar a promise no caso de erro inesperado ou retornar um objeto
`{inUse:boolean, error?:Error}`. Adicionar testes unitários.

### 2.2 Ambiente e validação inconsistentes

- `readPositiveIntEnv()` e `readPositiveInt()` aceitam qualquer `value` e retornam o `fallback`
  silenciosamente quando inválido. Isso mascarará configurações erradas (ex.:
  `BROWSER_POOL_SIZE=abc` não falha). Preferir `validateEnv` (já usado) ou lançar em casos de parse
  falho.
- Há muitos locais onde portas são parseadas manualmente e validadas; um utilitário compartilhado
  com schema zod/joi evitaria duplicação.<br> Exemplo: `externalPortRaw` no modo split não garante
  `!isNaN` até depois.

### 2.3 Race condition na descoberta NERV (BUG‑014) ainda frágil

O listener `nerv.onEvent(...)` remove‑se com `cleanupDiscoveryListener()`, mas o timeout é disparado
em todas as execuções sem cancelamento explícito. Se o evento chegar **justo** quando o timeout
expira, pode haver leak de listener ou múltiplos calls a `cleanupDiscoveryListener`. Um _once_ real
ou `Promise.race` simplificaria.

### 2.4 Limpeza de recursos globais incompleta em boot errôneo

Se `boot()` falhar após criação de `chromeProxy`, a referência global `chromeProxy` não é eliminada,
e nenhum shutdown é executado. A sessão de `boot()` poderia usar um `finally` para executar cleanup
parcial em caso de erro, garantindo que o processo não fique com estados estáticos enganadores (por
exemplo, `global.chromeProxy` permanece e impede reinício rápido em PM2).

### 2.5 Uso de `process.exit` em módulos importados

Funções como `resolveAuthority()` e `resolveServerMode()` chamam `process.exit(1)` internamente.
Isso impede testes unitários isolados e torna o comportamento menos previsível. Recomendação:
retornar um resultado ou lançar `InvalidConfigError` e deixar o chamador decidir o `exit`.

### 2.6 Falta de timeouts em operações críticas

- `kernel.start()` é chamado mas nunca envelhece. Se o kernel travar, o boot bloqueia
  indefinidamente.
- `driverFactory.start()` também não tem timeout.

A aplicação já implementou wrappers de timeout para `SSOT init` (BUG‑009). Expandir essa abordagem
para outras fases reduziria o risco de processos presos.

### 2.7 Potenciais leaks de listeners e timers

- `discoveryUnsub` é armazenado e chamado, mas `nerv.onEvent` pode retornar um handler assíncrono; a
  lógica de cleanup está um pouco verbosa e difícil de garantir livre de leaks (especialmente se
  `nerv.onEvent` gerar errors). Uma simples `const unsub = nerv.onEvent(...);` seguida de `unsub()`
  em `finally` resolveria.
- Várias chamadas a `setTimeout` não são limpas se o boot falhar cedo (por exemplo, timeout de
  descoberta). Esses timers ficarão pendentes durante o processo e serão liberados somente quando o
  Node encerrar.

### 2.8 Validações repetidas de instância (BUG‑010)

Depois de criar `identityManager`, `nerv`, `contextManager`, e `kernel`, o código executa blocos de
validação muito semelhantes. Isso polui o fluxo e já é coberto por tipos/JSdoc; pode ser substituído
por `assertInstance` genérica ou pela própria factory lançando se houver problema.

### 2.9 Uso inseguro de `process.env` nas leituras de números

Ex.: `Number.parseInt(process.env.SPLIT_CONNECT_MAX_ATTEMPTS ?? 10)` trata `' '` como 10. Idealmente
aplicar `trim()` e validar `Number.isFinite`.

### 2.10 `persistServerState()` no server process ignora erros de gravação

No fallback de arquivo, erros (por exemplo, disco cheio) são reportados somente via log `ERROR` mas
o bootstrap continua. Em modo standalone esse fallback é crítico para descoberta; lançar ou retriar
faz sentido.

### 2.11 Controle de autenticação do dashboard sujeito a bypass

`validateDashboardAuthConfig()` permite `authRequired=false` mas `socketAuthRequired=true` e não
checa credenciais de socket. Um atacante poderia conectar-se ao socket e executar ações que não
deveriam. A lógica de autorização deve ser unificada e talvez usar `express-jwt` e `socket.io`
middlewares.

### 2.12 Eventual inconsciência entre `httpAuthority` e `authority`

O servidor principal define `httpAuthority` como booleano indicando se o processo é quem fez o bind.
Em `persistServerState()` e em eventos NERV, o campo `authority` passa string
`'standalone'|'delegated'`. É fácil confundir os dois — possuir tipos codificados e/ou renomear para
`hasHttpBind` ajudaria.

### 2.13 Falta de cobertura de testes

Vários utilitários (por ex., `envFlag`, `checkPortInUse`, `resolveServerMode`) não possuem testes
evidentes; recomenda‑se adicionar casos unitários para cada função pequena do boot.

---

## 3. Propostas de aprimoramento e upgrades

1. **Refatorização em fases**: extrair cada fase do boot em um módulo `boot/phase-*.js` que exporta
   `{name, run}`. Fazer `await sequential(phaseList, ctx => phase.run(ctx))` com logging genérico.
   Isto facilitará a injeção de falhas e testes.
2. **Consolidar validação de configuração**: usar um esquema central (Zod) para `process.env` e
   `config.json`. Aplica‑se também para valores lidos dentro do boot (portas, inteiros positivos). O
   script `core/env_validator.js` já existe; expandi‑lo para cobrir mais casos e exportar
   utilitários genéricos reduzirá duplicação.
3. **Timeouts padronizados**: criar helper `withTimeout(promise, ms, message)` e aplicar nas fases
   críticas (kernel.start, driverFactory.start, serverBootstrap, etc.).
4. **Melhorar o mecanismo de descoberta**: simplificar `nerv.onEvent` listening, remover flags
   manuais, e garantir `once` semantics.
5. **Melhorar logs**: migrar para uso de `log(level, msg, metaObject)` e escolher campos
   padronizados (`phase`, `subsystem`, `error`). Ajustar configurator se necessário.

6. **Correções, aprimoramentos e upgrades no sistema de logging**: revisar `src/core/logger.js`,
   adicionar suporte nativo a JSON, melhorar rotação e retention, avaliar troca por biblioteca
   (Winston/Log4js) ou abstração semântica e garantir testes para formatos e falhas de I/O.
7. **Documentação e diagrama**: adicionar diagrama mermaid com as 6 fases do boot e transições de
   erros no documento de arquitetura.
8. **Atualizar código para Node 24**: aproveitar `AbortSignal.timeout`, `globalThis` (já usado), e
   `Object.hasOwn` onde aplicável. Também, migrar event listeners `once` ->
   `addEventListener('event', fn, {once:true})` quando possível.
9. **Separar responsabilidades server/main**: extrair validações, watchers e telemetria para módulos
   próprios (`watchers/index.js`, `telemetry/index.js`). Isso facilita a execução do bootstrap em
   testes sem precisar importar tudo.
10. **Melhoria de segurança**: forçar a validação de JWT secret no boot do servidor antes de iniciar
    o HTTP engine (atualmente é chamado apenas dentro de `validateDashboardAuthConfig` mas isso não
    impede o servidor de iniciar num caso de gap de config). Testes unitários de autenticação.
11. **Upgrade das dependências**: audit atural no `package.json` para garantir que bibliotecas
    críticas (puppeteer-extra, express, socket.io) estejam nas versões mais recentes compatíveis com
    Node 24. Futuramente adotar ESM native para todos os imports de terceiros (evitar
    `require`/`.default` hacks).

---

## 4. Ações iniciais sugeridas

1. Criar testes unitários para `checkPortInUse`, `resolveAuthority`, `resolveServerMode`, `envFlag`
   e `readPositiveIntEnv`.
2. Refatorar `checkPortInUse` segundo item 2.1 e adicionar logging de erro.
3. Extrair utilitários de validação de instâncias (BUG‑010) e substituir blocos repetidos.
4. Implementar timeout para kernel.start e driverFactory.start.
5. Documentar o novo módulo `boot/phase` e iniciar migração incremental.
6. Verificar fluxo de descoberta NERV e corrigir race condition (2.3).

---

## 5. Plano Final Consolidado

> Este plano é a versão **exhaustiva e final** das ações necessárias para estabilizar, refatorar e
> proteger os entrypoints e a integração com PM2. Ele engloba todos os problemas identificados,
> investigações realizadas e tarefas derivadas, e serve como checklist mestre para o trabalho
> futuro.

> **Nota PM2**: o processo de boot do Maestro e do servidor deve ser compatível com o arquivo
> `ecosystem.config.cjs`, que força `SERVER_MODE=split` e define os sinais de readiness. A
> integração já possui validações (ver `boot` detecta conflito PM2+integrated) e o código atual lê
> `process.env.pm_id` / `PM2_HOME` para auto-detectar execução sob PM2.
>
> Um diagnóstico manual já foi feito sobre a configuração:
>
> - `agente-gpt` roda em modo _fork_ com `NODE_ARGS_BASE`, `SERVER_MODE=split` e
>   `SERVER_AUTHORITY=standalone`.
> - `dashboard-web` usa `wait_ready` e emite `process.send('ready')` via `sendReadySignalOnce()`
>   (PM2 considera o processo pronto somente após esse sinal).
> - O bootstrap do maestro aborta se `runningUnderPM2 && SERVER_MODE===integrated`, evitando
>   conflito de portas.
> - Timeouts e logs no `ecosystem.config.cjs` (kill_timeout, listen_timeout) estão alinhados com o
>   comportamento esperado pelo código.
>
> Ainda assim, adicionamos ao plano um passo específico para **validar** esse comportamento com
> scripts/testes que simulem o ciclo completo de PM2 (start, ready, restart, shutdown). As próximas
> tarefas a serem executadas serão as seguintes (ordem sugerida, mas flexível):

1. **Testes de utilitários** – cobrir funções pequenas usadas pelo boot e servidor.
2. **Corrigir `checkPortInUse`** – lançar/propagar erros não EADDRINUSE e garantir log.
3. **Extrair helpers de validação** – `parsePositiveInt`, `validatePort`, `assertInstance`,
   consolidando regras repetidas.
4. **Eliminar `process.exit` de helpers** – lançar erros de configuração e centralizar chamada de
   exit nos bootstrappers.
5. **Aplicar timeouts genéricos** – criar `withTimeout` e usá‑lo nas fases críticas.
6. **Simplificar descoberta NERV** – usar `once`/Promise e eliminar flags e timers manuais.
7. **Refatorar boot em fases** – mover lógica da função `boot`/`bootstrap` para módulos e
   implementar orquestrador.
8. **Padronizar logs estruturados** – atualizar chamadas de `log` e ajustar logger.
9. **Reforçar segurança do dashboard** – unir validação HTTP/socket e adicionar middlewares JWT.
10. **Adicionar mais testes e cobertura** – assegurar >=90% em áreas alteradas, incluindo novos
    utilitários e autenticação.
11. **Validar integração com PM2** – rever `ecosystem.config.cjs`, assegurar que o boot respeita
    `SERVER_MODE=split`, readiness signals, variáveis de ambiente e documentar o comportamento;
    escrever testes ou scripts que simulem o ciclo PM2.
12. **Documentar avanços** – atualizar `AUDIT_MAIN.md` com status de tarefas, referências de
    commits/PRs e inserir diagrama mermaid das fases.
13. **Planejar upgrades de dependências** – revisar `package.json` em busca de versões antigas e
    executar `npm audit`.
14. **Logging system overhaul** – corrigir bugs existentes em `src/core/logger.js`, adicionar
    testes, e implementar melhorias/upgrade conforme proposta #11.

> As implementações devem ser realizadas incrementalmente; após cada bloco concluído, marque o item
> como concluído nesta seção e adicione observações no próprio documento.

---

## 6. Investigação Adicional (concluída)

Antes de entrar em qualquer implementação, realizamos uma investigação abrangente para garantir que
o plano cobre todos os componentes relevantes:

- **Entrypoints**: `src/main.js` e `src/server/main.js` analisados na íntegra.
- **Validador de ambiente** (`src/core/env_validator.js`) revisado para entender o escopo das regras
  de configuração.
- **Logger** (`src/core/logger.js`) inspecionado para confirmar capacidade de logs estruturados e
  side‑effects; ele será adaptado nos passos de padronização.
- **Lifecycle do servidor** (`src/server/engine/lifecycle.js`) examinado para compreender sinais,
  timeouts e integração com PM2.
- **Integração PM2**: além de inspecionar `ecosystem.config.cjs`, examinamos Makefile, script
  `validate-boot-fixes.sh`, documentos de resumo (`PM2_IMPLEMENTATION_SUMMARY.md`), e test
  regressivo existente. Verificamos que PM2 já é tratado ativamente pelo código (detecção via
  `pm_id`, abortamento de conflito, ready signal).
- **Middleware e segurança**: buscou‑se por `validateDashboardAuthConfig`, dependências de JWT e
  arquivos de middleware (`auth.js`, `authorize.js`) para enquadrar as necessidades de reforço de
  segurança.
- **Scripts auxiliares**: o Makefile contém comandos de health, checks e preflight que cobrem PM2 e
  ambiente; `scripts/pm2-check.sh` e `validate-boot-fixes.sh` foram lidos e documentados.
- **Testes**: há testes de regressão específicos para simular ambiente PM2 e vários testes de
  middleware que garantem que a camada HTTP é protegida.

Nenhuma outra entrada ou módulo crítico de boot/shutdown foi identificado além desses pontos; a
investigação não revelou dependências ocultas ou comportamentos invisíveis. Assim, o plano
consolidado (Seção 5) agora está totalmente suportado por contexto e não há áreas pendentes críticas
para análise.

> Se você identificar algum subsistema ou comportamento adicional que deva ser incluído, por favor
> me avise; caso contrário, estamos prontos para partir para a implementação quando desejar.

---

> Este arquivo está em andamento. À medida que alterações são feitas no código ou novas auditorias
> forem realizadas, adicione entradas adicionais neste documento com referências aos números de
> bugs, commits ou PRs correspondentes.

---

_Última atualização: 23‑fev‑2026_
