# Regras do Workspace - Kilo Code

- PROGRAMAMOS EM NODE 24+ ESM.

O objetivo é construir um programa para controlar LLM via puppeteer.

Este documento define as regras e diretrizes padrão para o desenvolvimento no workspace
`chatgpt-docker-puppeteer`. Todas as regras aqui descritas devem ser seguidas para manter
consistência, qualidade e manutenibilidade do código.

## Diretrizes Gerais

### 1. Convenções de Nomenclatura

- **Arquivos**: Use `kebab-case` para arquivos JavaScript/Node.js (ex: `meu-arquivo.js`)
- **Classes**: Use `PascalCase` para classes e construtores (ex: `class MissionRunner`)
- **Funções**: Use `camelCase` para funções e variáveis (ex: `function executeTask()`)
- **Constantes**: Use `UPPER_SNAKE_CASE` para constantes globais (ex: `MAX_RETRIES`)
- **Módulos**: Use `kebab-case` para nomes de módulos npm AMBIENTE
- Trabalhamos dentro de WSL + container (devcontainer). Presuma Linux userland no runtime.
- O runtime esperado é Node >= 24. Se houver dúvida, valide com: node -v.

ESM / MODULE SYSTEM

- Código novo em JavaScript deve ser ESM: use import/export. Não use require/module.exports por
  padrão.
- Presuma package.json com "type": "module" (ou equivalente). Se faltar, proponha o patch.
- Evite padrões CommonJS e interop CJS, salvo necessidade explícita:
  - Se precisar interop: prefira dynamic import() ou createRequire() com justificativa curta.

QUALIDADE / VERIFICAÇÃO (SEM EXCEÇÃO APÓS MUDANÇAS RELEVANTES)

- Depois de alterações:
  - node --check nos arquivos JS/ESM alterados quando aplicável
  - npm test quando existir
  - npm run lint quando existir
- Se houver TS/JS com // @ts-check, mantenha tipagem consistente e contratos estáveis.

EXECUÇÃO

- Ao sugerir comandos, use sintaxe POSIX (bash) e paths Linux.
- Assuma que o workspace é writeable e que o agente pode rodar comandos (sandbox full).

DOCUMENTAÇÃO EXTERNA (CONTEXT7)

- Para perguntas de libs/frameworks/APIs externas, priorize MCP `context7` antes de web_search.
- Sempre explicite a versão da documentação usada (ou a versão assumida quando não informada).
- Se `context7` estiver indisponível, faça fallback explícito para documentação oficial/web_search e
  sinalize o fallback.
- Gerencie MCP via `codex mcp add/get/remove`; evite editar manualmente `[mcp_servers.*]`. """

### 2. Estrutura de Diretórios

#### 2.1 Diretrizes por Módulo

### 3. Padrões de Código

#### 3.1 Tratamento de Erros

```javascript
// ❌ Evite:捕获 genericos sem contexto
try {
  await processTask();
} catch (e) {
  console.error(e);
}

// ✅ Prefira: tratamento específico com contexto
try {
  await processTask(taskId);
} catch (error) {
  if (error.code === 'TIMEOUT') {
    logger.warn(`Tarefa ${taskId} expirou, agendando retry`, { taskId });
    await scheduleRetry(taskId);
  } else if (error.code === 'VALIDATION_ERROR') {
    logger.error(`Falha na validação da tarefa ${taskId}`, { taskId, errors: error.details });
    await notifyTaskFailure(taskId, error.details);
  } else {
    logger.error(`Erro inesperado ao processar tarefa ${taskId}`, {
      taskId,
      error: error.message,
      stack: error.stack,
    });
    throw error;
  }
}
```

#### 3.2 Async/Await e Promises

```javascript
// ❌ Evite: misturar then/catch com async/await
function badPractice() {
  return fetchData()
    .then((data) => processData(data))
    .catch((err) => console.error(err));
}

// ✅ Prefira: async/await com try/catch estruturado
async function goodPractice() {
  try {
    const data = await fetchData();
    return await processData(data);
  } catch (error) {
    logger.error('Falha ao executar fluxo', { error: error.message });
    throw new ApplicationError('PROCESS_FAILED', error.message);
  }
}

// ✅ Para múltiplas operações paralelas:
async function parallelOperations() {
  const [user, config, permissions] = await Promise.all([
    fetchUser(userId),
    fetchConfig(),
    fetchPermissions(userId),
  ]);
  return { user, config, permissions };
}
```

#### 3.3 Configuração e Variáveis de Ambiente

```javascript
// ❌ Evite: hardcoded values
const TIMEOUT = 30000;
const API_KEY = 'secret-key-123';

// ✅ Prefira: configuração centralizada
import { config } from '../core/config.js';

const timeout = config.get('TASK_TIMEOUT_MS', 30000);
const apiKey = config.require('API_KEY');

// ✅ Valide configurações críticas na inicialização
function validateConfig() {
  const required = ['API_KEY', 'DATABASE_URL', 'REDIS_URL'];
  const missing = required.filter((key) => !config.has(key));

  if (missing.length > 0) {
    throw new ConfigurationError(
      `Variáveis de ambiente obrigatórias não definidas: ${missing.join(', ')}`,
    );
  }
}
```

### 4. Logging e Monitoramento

```javascript
import { logger } from '../core/logger.js';

// ✅ Níveis de log corretos
logger.debug('Dados de debug para desenvolvimento', { data: debugInfo });
logger.info('Operação executada com sucesso', { taskId, duration: elapsed });
logger.warn('Condição de alerta que precisa atenção', { warning: 'Low memory' });
logger.error('Falha em operação crítica', { error: err.message, stack: err.stack });

// ✅ Estruture logs para facilitar parsing
logger.info('task_completed', {
  taskId: task.id,
  agentId: agent.id,
  duration: endTime - startTime,
  status: 'success',
  metadata: { retries: attemptCount },
});
```

### 5. Testes

```javascript
// Estrutura recomendada para testes
describe('MissionRunner', () => {
  describe('execute', () => {
    it('deve executar tarefa com sucesso', async () => {
      const result = await runner.execute(validTask);
      expect(result.status).toBe('success');
    });

    it('deve retentar em caso de erro temporário', async () => {
      nock('http://api').post('/task').times(3).reply(500, { retry: true });
      await expect(runner.execute(task)).rejects.toThrow('MAX_RETRIES_EXCEEDED');
    });

    it('deve validar entrada antes de executar', async () => {
      const invalidTask = { id: null, data: {} };
      await expect(runner.execute(invalidTask)).rejects.toThrow(ValidationError);
    });
  });
});
```

### 6. Performance e Otimização

#### 6.1 Cache e Memoização

```javascript
// ✅ Cache com TTL para dados frequentemente acessados
import { cache } from '../core/memory.js';

async function getUserWithCache(userId) {
  const cacheKey = `user:${userId}`;
  return cache.getOrSet(
    cacheKey,
    async () => {
      return await database.users.findById(userId);
    },
    { ttl: 60000 },
  );
}
```

#### 6.2 Batch Operations

```javascript
// ❌ Evite: múltiplas queries individuais
for (const userId of userIds) {
  await db.saveUser(await db.getUser(userId));
}

// ✅ Prefira: operações em batch
const users = await db.getUsersBatch(userIds);
const updated = users.map(transformUser);
await db.saveUsersBatch(updated);
```

#### 6.3 Conexões e Recursos

```javascript
// ✅ Sempre libere recursos
async function processWithBrowser() {
  const browser = await puppeteer.launch();
  try {
    const page = await browser.newPage();
  } finally {
    await browser.close();
  }
}

// ✅ Use connection pooling
import { pool } from '../core/database.js';
async function queryData(sql, params) {
  const client = await pool.connect();
  try {
    return await client.query(sql, params);
  } finally {
    client.release();
  }
}
```

### 7. Segurança

```javascript
// ✅ Valide e sanitize todas as entradas
import { z } from 'zod';

const TaskSchema = z.object({
  id: z.string().uuid(),
  type: z.enum(['scrape', 'analyze', 'process']),
  config: z
    .object({
      url: z.string().url(),
      timeout: z.number().int().positive().max(300000),
    })
    .strict(),
});

function createTask(rawInput) {
  const validated = TaskSchema.parse(rawInput);
  return validated;
}

// ✅ Nunca logue informações sensíveis
logger.info('User logged in', { userId: user.id });
```

### 8. Casos de Borda

```javascript
// ✅ Trate valores nulos/undefined explicitamente
function processData(data) {
  if (data === null || data === undefined) {
    return defaultValue;
  }

  const name = data?.profile?.name ?? 'Anonymous';
  const items = data?.items ?? [];

  if (items.length === 0) {
    logger.warn('Nenhum item para processar', { dataId: data.id });
    return [];
  }

  return items.map(transform);
}

// ✅ Rate limiting e backoff exponencial
async function withRetry(fn, options = {}) {
  const { maxRetries = 3, baseDelay = 1000, maxDelay = 30000 } = options;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (attempt === maxRetries - 1) throw error;

      const delay = Math.min(baseDelay * Math.pow(2, attempt), maxDelay);
      logger.warn(`Tentativa ${attempt + 1} falhou, retry em ${delay}ms`, { error: error.message });
      await sleep(delay);
    }
  }
}
```

## Boas Práticas Adicionais

- Use JSDoc para documentar funções públicas
- Mantenha README.md atualizado com instruções claras
- Documente decisões arquiteturais em ADRs
- Siga Semantic Versioning (semver)
- Commits significativos seguindo Conventional Commits
- Execute linting antes de commits
- Valide tipos TypeScript/JavaScript
- Verifique dependências vulneráveis

## Referências

- [Guia de Estilo JavaScript](https://standardjs.com/)
- [Conventional Commits](https://www.conventionalcommits.org/)
- [Zod Validation](https://zod.dev/)
- [Puppeteer Best Practices](https://github.com/puppeteer/puppeteer/blob/main/docs/guides/chrome-extensions.md)
