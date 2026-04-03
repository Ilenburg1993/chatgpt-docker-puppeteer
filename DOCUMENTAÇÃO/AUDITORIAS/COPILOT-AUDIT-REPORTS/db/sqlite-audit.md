# db/sqlite.js — Auditoria

**Módulo**: `src/copilot/db/` **Arquivo**: `sqlite.js` **LOC**: 181 | **Score**: 9.0/10

## Responsabilidade

Singleton SQLite isolado para o módulo copilot (`copilot.sqlite`). Gerencia ciclo de vida completo:
path resolution → dir creation → abertura do DB → pragmas → migrations.

**Design**: Deliberadamente separado de `src/infra/db/sqlite.js` (maestro.sqlite) para:

1. Evitar contenção de WAL
2. Isolar schema copilot com migrations próprias
3. Permitir `:memory:` em testes sem interferência

## Funções Exportadas

| Export                   | Propósito                                                 |
| ------------------------ | --------------------------------------------------------- |
| `getCopilotDb()`         | Retorna (ou cria) o singleton; lança em falha de I/O      |
| `closeCopilotDb()`       | Fecha o DB (testes + shutdown graceful)                   |
| `resolveCopilotDbPath()` | Resolve path via `COPILOT_DB_PATH` env > config > default |

## Achados

### P3 — `resolveCopilotDbPath` aceita valor `:memory:` via `CONFIG.all` mas não via variável especial

**Localização**: `sqlite.js:39-46`

**Descrição**: Para usar `:memory:`, o teste deve setar `COPILOT_DB_PATH=:memory:` como variável de
ambiente. A comparação `dbPath !== ':memory:'` (linha 126) previne a criação de diretório. Porém, se
o valor vier de `CONFIG.all['COPILOT_DB_PATH']` (arquivo de config, não env), o path `:memory:`
também funciona (nenhum mkdirSync é chamado). Não é bug — é comportamento correto — mas ausência de
comentário pode confundir manutenção futura.

---

### P4 — `registerExitHandler` usa flag `exitHandlerRegistered` module-level — não limpo em `closeCopilotDb`

**Localização**: `sqlite.js:162-175`

**Descrição**: `exitHandlerRegistered` é `let` module-scoped. Após `closeCopilotDb()` + novo
`getCopilotDb()` (ex: re-uso entre suites de test), o handler de exit é registrado apenas uma vez —
correto. Porém se `getCopilotDb()` for chamado antes do `process.on('exit')` completar tasks
pendentes, o `copilotDb.close()` no handler pode ser já `null` (seguro pela guarda
`if (copilotDb)`). Comportamento correto, mas documentação ausente sobre re-entrância.

---

### P4 — `process.on('exit', ...)` em `registerExitHandler` prefere `beforeExit` ou `SIGTERM` para shutdown graceful

**Localização**: `sqlite.js:163`

**Descrição**: `process.on('exit')` só dispara quando o event loop está vazio e o processo está
saindo normalmente. Para shutdown graceful em processo PM2 (SIGTERM), o handler não é chamado via
`process.exit(0)` a menos que o sinal chegue naturalmente. Recomendado: registrar também
`SIGTERM`/`SIGINT` para fechar o DB no graceful shutdown do PM2.

**Impacto**: WAL não flushed em SIGTERM → pode perder até ~5s de writes em WAL
(`synchronous = NORMAL`).

---

## Destaques Positivos

- Pragmas bem calibrados: WAL mode, foreign_keys ON, busy_timeout 5000ms, cache 16MB
- Path resolution: env > config > default — testável via env var
- `looksLikeDir` check evita bug clássico de passar dir como path de arquivo
- `closeCopilotDb` usa `finally` para zerar o singleton — sem leak de referência
- Comentário explícito `// @ts-check` + JSDoc robusto em todas as funções públicas
- `migrate()` usa transação por migration — falha atômica e rollback seguro

---

_Gerado automaticamente pelo COPILOT-FULL-AUDIT MF-II._

---

## Status de Correção (2026-04-03)

### [FIXED] DB-P3-01 — registerExitHandler agora registra SIGTERM e SIGINT

Além de process.on('exit'), os handlers process.once('SIGTERM') e process.once('SIGINT') foram
adicionados para garantir close() do banco e flush do WAL em graceful shutdown PM2.

**Pontuação atualizada: 9.3/10**
