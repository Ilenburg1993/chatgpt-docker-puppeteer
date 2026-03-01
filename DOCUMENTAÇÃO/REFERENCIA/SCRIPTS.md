# 📜 NPM Scripts Reference

Referência completa dos 80+ scripts disponíveis no `package.json`.

---

## 🚀 Execução

Scripts para iniciar e gerenciar o agente.

| Script  | Comando                                                              | Descrição                                         |
| ------- | -------------------------------------------------------------------- | ------------------------------------------------- |
| `start` | `node index.js`                                                      | Inicia agente em modo produção (sem hot-reload)   |
| `dev`   | `nodemon index.js --ignore fila/ --ignore logs/ --ignore respostas/` | Modo desenvolvimento com hot-reload (recomendado) |

**Exemplos**:

```bash
npm start              # Produção
npm run dev            # Desenvolvimento (auto-restart em mudanças)
```

---

## 🔧 Daemon (PM2)

Scripts para gerenciar processos via PM2 (produção).

| Script           | Comando                             | Descrição                                   |
| ---------------- | ----------------------------------- | ------------------------------------------- |
| `daemon:start`   | `npx pm2 start ecosystem.config.cjs` | Inicia os processos PM2 definidos no baseline atual |
| `daemon:stop`    | `npx pm2 stop agente-gpt dashboard-web chrome-proxy` | Para os processos principais |
| `daemon:restart` | `npx pm2 restart agente-gpt dashboard-web chrome-proxy` | Reinicia os processos principais |
| `daemon:reload`  | `npx pm2 reload agente-gpt dashboard-web chrome-proxy` | Reload sem downtime |
| `daemon:monit`   | `npx pm2 monit` | Monitor interativo em tempo real |
| `daemon:logs`    | `npx pm2 logs --lines 50` | Últimas 50 linhas de logs |
| `daemon:flush`   | `npx pm2 flush` | Limpa logs do PM2 |
| `daemon:kill`    | `npx pm2 delete all` | Remove todos processos (kill) |
| `daemon:status`  | `npx pm2 status` | Status de todos processos |

**Exemplos**:

```bash
npm run daemon:start   # Inicia PM2 daemon
npm run daemon:status  # Verifica status
npm run daemon:logs    # Vê logs em tempo real
npm run daemon:stop    # Para tudo
```

**Quando usar**:

- ✅ **Produção**: Sempre use PM2 (auto-restart, memory limits, logs)
- ✅ **Desenvolvimento**: Use `npm run dev` (mais simples)
- ❌ **Nunca misture**: Não rode `npm start` E `daemon:start` simultaneamente

---

## 📊 Queue Management

Scripts para gerenciar fila de tarefas.

| Script         | Comando                                      | Descrição                         |
| -------------- | -------------------------------------------- | --------------------------------- |
| `queue:status` | `node scripts/status_fila.js`                | Mostra estado atual da fila       |
| `queue:add`    | `node scripts/gerador_tarefa.js`             | Adiciona nova tarefa (interativo) |
| `queue:import` | `node scripts/importar_prompts.js`           | Importa tarefas de arquivo .txt   |
| `queue:graph`  | `node scripts/visualizar_fila.js > fila.dot` | Gera grafo da fila (Graphviz DOT) |
| `queue:flow`   | `node scripts/flow_manager.js`               | Gerenciador de fluxo de tarefas   |

**Exemplos**:

```bash
npm run queue:status           # Ver fila
npm run queue:add              # Adicionar tarefa (wizard)
npm run queue:import           # Importar de prompts.txt
npm run queue:graph            # Gerar visualização
dot -Tpng fila.dot > fila.png  # Converter DOT para PNG
```

---

## 🔍 Code Analysis

Scripts para análise estática de código (complexidade, dependências, duplicação).

| Script                 | Comando                                                                  | Descrição                                 |
| ---------------------- | ------------------------------------------------------------------------ | ----------------------------------------- |
| `analyze:deps`         | `npx madge --circular --extensions js src/`                              | Analisa dependências circulares           |
| `analyze:deps:graph`   | `npx madge --circular --extensions js --image deps-graph.svg src/`       | Gera grafo de dependências (SVG)          |
| `analyze:graph`        | `node scripts/analyze-code-graph.js --stats`                             | Estatísticas do grafo de código           |
| `analyze:graph:full`   | `node scripts/analyze-code-graph.js --stats --circular --orphans --nerv` | Análise completa (circular, órfãos, NERV) |
| `analyze:graph:export` | `node scripts/analyze-code-graph.js --export-json --export-dot`          | Exporta grafo (JSON + DOT)                |
| `analyze:circular`     | `node scripts/analyze-code-graph.js --circular`                          | Apenas imports circulares                 |
| `analyze:orphans`      | `node scripts/analyze-code-graph.js --orphans`                           | Apenas arquivos órfãos                    |
| `analyze:nerv`         | `node scripts/analyze-code-graph.js --nerv`                              | Análise de eventos NERV                   |

**Exemplos**:

```bash
npm run analyze:deps           # Circular dependencies (rápido)
npm run analyze:graph:full     # Análise completa (lento)
npm run analyze:graph:export   # Exportar para tools externos
```

**Quando usar**:

- Antes de PR grande (verificar circular deps)
- Ao refatorar arquitetura (validar estrutura)
- Para gerar diagramas de documentação

---

## 🧹 Maintenance

Scripts para limpeza e manutenção.

| Script                    | Comando                                               | Descrição                         |
| ------------------------- | ----------------------------------------------------- | --------------------------------- |
| `clean`                   | `rm -rf logs/ tmp/ RUNNING.lock`                      | Remove logs, tmp, locks           |
| `clean:queue`             | `rm fila/*.json`                                      | Limpa toda a fila (⚠️ destrutivo) |
| `clean:logs`              | `rm -rf logs/*.log logs/crash_reports/*`              | Apenas logs                       |
| `reset:hard`              | `clean + clean:queue + clean:logs`                    | Reset completo (⚠️ destrutivo)    |
| `maintenance`             | `node scripts/puppeteer_maintenance.js`               | Manutenção do Puppeteer           |
| `maintenance:clean-cache` | `node scripts/puppeteer_maintenance.js --clean-cache` | Limpa cache Puppeteer             |

**Exemplos**:

```bash
npm run clean              # Limpeza normal (seguro)
npm run clean:logs         # Apenas logs (seguro)
npm run reset:hard         # CUIDADO: apaga tudo incluindo fila!
```

⚠️ **ATENÇÃO**: `reset:hard` e `clean:queue` apagam dados de tarefas!

---

## 🧪 Testing

Scripts para executar testes (Node.js Test Runner nativo).

### Principais

| Script             | Comando                                        | Descrição                         |
| ------------------ | ---------------------------------------------- | --------------------------------- |
| `test`             | `node --test tests/**/*.spec.js`               | Executa todos os testes           |
| `test:unit`        | `node --test 'tests/unit/**/*.spec.js'`        | Apenas testes unitários           |
| `test:integration` | `node --test 'tests/integration/**/*.spec.js'` | Apenas testes de integração       |
| `test:e2e`         | `node --test 'tests/e2e/**/*.spec.js'`         | End-to-end tests                  |
| `test:regression`  | `node --test 'tests/regression/**/*.spec.js'`  | Testes de regressão (P1-P5 fixes) |

### Watch Mode

| Script            | Comando                                         | Descrição          |
| ----------------- | ----------------------------------------------- | ------------------ |
| `test:watch`      | `node --test --watch 'tests/**/*.spec.js'`      | Watch mode (todos) |
| `test:watch:unit` | `node --test --watch 'tests/unit/**/*.spec.js'` | Watch mode (unit)  |

### Coverage

| Script                      | Comando                            | Descrição                         |
| --------------------------- | ---------------------------------- | --------------------------------- |
| `test:coverage`             | `npx c8 npm test`                  | Coverage completo                 |
| `test:coverage:unit`        | `npx c8 npm run test:unit`         | Coverage unit                     |
| `test:coverage:integration` | `npx c8 npm run test:integration`  | Coverage integration              |
| `test:ci`                   | `npx c8 --check-coverage npm test` | CI mode (falha se coverage baixo) |

### Debug & Utilities

| Script        | Comando                                          | Descrição                    |
| ------------- | ------------------------------------------------ | ---------------------------- |
| `test:debug`  | `node --inspect-brk --test 'tests/**/*.spec.js'` | Debug mode (Chrome DevTools) |
| `test:clean`  | `rm -rf coverage/ tests/tmp/ .c8/`               | Remove artefatos de teste    |
| `test:all`    | `node scripts/run-all-tests.js`                  | Runner customizado (legacy)  |
| `test:report` | `node scripts/run-all-tests.js`                  | Gera relatório de testes     |

### Testes Específicos

| Script        | Comando                                  | Descrição                  |
| ------------- | ---------------------------------------- | -------------------------- |
| `test:health` | `node tests/test_health_endpoint.js`     | Testa endpoint /api/health |
| `test:config` | `node tests/test_config_validation.js`   | Valida config.json         |
| `test:lock`   | `node tests/test_lock.js`                | Testa file locking         |
| `test:stall`  | `node tests/test_stall_mitigation.js`    | Testa detecção de stall    |
| `test:schema` | `node scripts/test_schema_validation.js` | Valida schemas Zod         |

### Platform-Specific

| Script        | Comando                                                              | Descrição                |
| ------------- | -------------------------------------------------------------------- | ------------------------ |
| `test:win`    | `powershell -ExecutionPolicy Bypass -File scripts/run_all_tests.ps1` | Windows                  |
| `test:linux`  | `bash scripts/run_all_tests.sh`                                      | Linux/macOS              |
| `test:legacy` | `node scripts/run-tests.js`                                          | Runner antigo (obsoleto) |

**Exemplos**:

```bash
npm test                       # Todos os testes
npm run test:unit              # Apenas unit tests
npm run test:watch:unit        # Watch mode (auto-rerun)
npm run test:coverage          # Com coverage report
npm run test:debug             # Debug no Chrome DevTools
npm run test:health            # Teste específico
```

**Estrutura de Testes**:

```
tests/
  ├── unit/           # Testes unitários (isolados, sem I/O)
  ├── integration/    # Testes de integração (múltiplos componentes)
  ├── e2e/            # End-to-end (sistema completo)
  └── regression/     # Regressão (bugs P1-P5 fixes)
```

---

## 🎨 Code Quality

Scripts para linting e formatação.

### ESLint

| Script        | Comando                                                          | Descrição                           |
| ------------- | ---------------------------------------------------------------- | ----------------------------------- |
| `lint`        | `eslint .`                                                       | Executa ESLint em todo projeto      |
| `lint:fix`    | `eslint . --fix`                                                 | Auto-fix de problemas (recomendado) |
| `lint:quiet`  | `eslint . --quiet`                                               | Apenas erros (sem warnings)         |
| `lint:report` | `eslint . --output-file logs/eslint-report.txt --format stylish` | Gera relatório em arquivo           |
| `lint:src`    | `eslint src/`                                                    | Apenas src/                         |
| `lint:tests`  | `eslint tests/`                                                  | Apenas tests/                       |

### Prettier

| Script         | Comando                                | Descrição                   |
| -------------- | -------------------------------------- | --------------------------- |
| `format`       | `prettier --write "**/*.{js,json,md}"` | Formata todos arquivos      |
| `format:check` | `prettier --check "**/*.{js,json,md}"` | Verifica sem modificar (CI) |
| `format:src`   | `prettier --write "src/**/*.js"`       | Apenas src/                 |
| `format:tests` | `prettier --write "tests/**/*.js"`     | Apenas tests/               |

### Validation

| Script               | Comando                                                  | Descrição                  |
| -------------------- | -------------------------------------------------------- | -------------------------- |
| `validate`           | `node scripts/validate_config.js`                        | Valida config.json         |
| `validate:pre-start` | `npm run validate && echo Ready to start`                | Pre-flight check           |
| `validate:all`       | `npm run lint:quiet && npm run format:check && npm test` | Validação completa (CI)    |
| `validate:code`      | `npm run lint:quiet && npm run format:check`             | Apenas código (sem testes) |
| `check`              | `npm run validate:code`                                  | Alias para validate:code   |

**Exemplos**:

```bash
npm run lint:fix               # Fix ESLint issues
npm run format                 # Format code
npm run validate:all           # Full validation (antes de commit)
npm run check                  # Quick check (lint + format)
```

**Workflow Recomendado**:

```bash
# Antes de commit
npm run lint:fix               # Auto-fix ESLint
npm run format                 # Auto-format Prettier
npm run validate:all           # Lint + format + tests
git add .
git commit -m "feat: ..."
```

---

## 🛠️ Utilities

Scripts utilitários diversos.

| Script     | Comando                          | Descrição                               |
| ---------- | -------------------------------- | --------------------------------------- |
| `setup`    | `bash scripts/setup/setup.sh`    | Configuração inicial do projeto         |
| `doctor`   | `bash scripts/health/doctor.sh`  | Diagnóstico de problemas (health check) |
| `diagnose` | `node scripts/analisar_crash.js` | Analisa crashes recentes                |

**Exemplos**:

```bash
bash scripts/setup/setup.sh    # Setup inicial (primeira vez)
bash scripts/health/doctor.sh  # Diagnosticar problemas
npm run diagnose               # Analisar crashes
```

---

## 🔗 Lifecycle Hooks

Scripts executados automaticamente pelo npm.

| Script        | Quando Executa          | Descrição                        |
| ------------- | ----------------------- | -------------------------------- |
| `preinstall`  | Antes de `npm install`  | Bloqueia yarn (força uso de npm) |
| `postinstall` | Depois de `npm install` | Mensagem de sucesso              |
| `prepare`     | Após instalar deps      | Setup do Husky (se instalado)    |

**Nota**: Estes scripts rodam automaticamente, você não precisa chamá-los.

---

## 📚 Categorias de Scripts

### Por Frequência de Uso

**Uso Diário** (desenvolvimento):

```bash
npm run dev                    # Iniciar dev mode
npm run queue:status           # Ver fila
npm test                       # Rodar testes
npm run lint:fix               # Fix code issues
```

**Uso Semanal** (manutenção):

```bash
npm run clean                  # Limpar logs
npm run test:coverage          # Coverage report
npm run analyze:deps           # Verificar dependências
bash scripts/health/doctor.sh  # Health check
```

**Uso Mensal** (análise profunda):

```bash
npm run analyze:graph:full     # Análise completa de código
npm run test:ci                # CI full validation
npm run validate:all           # Full validation
```

**Uso Raro** (deploy/emergência):

```bash
npm run daemon:start           # Produção
npm run reset:hard             # Reset total (emergência)
npm run diagnose               # Crash analysis
```

### Por Categoria

- **Execução**: `start`, `dev`, `daemon:*`
- **Queue**: `queue:*`
- **Análise**: `analyze:*`
- **Limpeza**: `clean`, `clean:*`, `reset:hard`
- **Testes**: `test`, `test:*`
- **Qualidade**: `lint`, `lint:*`, `format`, `format:*`
- **Validação**: `validate`, `validate:*`, `check`
- **Utilities**: `setup`, `doctor`, `diagnose`

---

## 🚨 Scripts Perigosos

⚠️ **CUIDADO**: Estes scripts são destrutivos!

| Script         | Risco    | O que faz                               |
| -------------- | -------- | --------------------------------------- |
| `reset:hard`   | 🔴 ALTO  | Apaga logs, tmp, locks, **E TODA FILA** |
| `clean:queue`  | 🔴 ALTO  | Apaga todos arquivos de tarefas         |
| `daemon:kill`  | 🟡 MÉDIO | Remove processos PM2 (precisa restart)  |
| `daemon:flush` | 🟡 MÉDIO | Apaga logs do PM2                       |
| `clean:logs`   | 🟢 BAIXO | Apaga logs (recuperável)                |

**Sempre confirme antes de usar scripts 🔴 ALTO risco!**

---

## 💡 Dicas

1. **Use tab-completion**: `npm run <TAB>` lista todos scripts
2. **Ver comando**: `npm run <script> --silent` mostra comando sem executar
3. **Passar args**: `npm run script -- --arg=value` (note o `--` extra)
4. **Rodar múltiplos**: Use `&&` (sequencial) ou `&` (paralelo)
   ```bash
   npm run lint:fix && npm test      # Sequencial
   npm run dev & npm run queue:status -- --watch  # Paralelo (background)
   ```

---

## 📖 Documentação Adicional

- **Testes**: Ver [../GUIAS/TESTES.md](../GUIAS/TESTES.md) para estratégia completa
- **Deploy**: Ver [../OPERACOES/DEPLOYMENT.md](../OPERACOES/DEPLOYMENT.md) para uso de PM2/Docker
- **Config**: Ver [CONFIGURATION.md](CONFIGURATION.md) para config.json
- **Contribuir**: Ver [../GUIAS/CONTRIBUTING.md](../GUIAS/CONTRIBUTING.md) para workflow

---

**Total**: 90+ scripts catalogados **Última atualização**: 2026-01-21 **Versão**: v1.0.0
