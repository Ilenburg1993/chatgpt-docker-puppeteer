# ConnectionOrchestrator - Guia Completo

## Visão Geral

O `ConnectionOrchestrator` é um gerenciador universal de conexões Puppeteer com suporte a múltiplos modos, fallback automático e cache persistente.

## Modos de Operação

### 1. **launcher** (Recomendado - Padrão)

Puppeteer inicia Chrome/Chromium automaticamente.

```javascript
const orch = new ConnectionOrchestrator({ mode: 'launcher' });
const browser = await orch.connect();
```

**Vantagens:**

- ✅ Zero configuração externa
- ✅ Funciona em qualquer ambiente
- ✅ Isolamento completo
- ✅ Cache persistente em ~/.cache/puppeteer

### 2. **connect**

Conecta a Chrome externo via `browserURL` (http://host:port).

```javascript
const orch = new ConnectionOrchestrator({
    mode: 'connect',
    hosts: ['127.0.0.1', 'host.docker.internal'],
    ports: [9222, 9223]
});
const browser = await orch.connect();
```

**Requisitos:**

- Chrome executando com `--remote-debugging-port=9222`

### 3. **wsEndpoint**

Conecta a Chrome externo via WebSocket Debugger URL.

```javascript
const orch = new ConnectionOrchestrator({
    mode: 'wsEndpoint',
    hosts: ['localhost'],
    ports: [9222]
});
const browser = await orch.connect();
```

**Vantagens sobre connect:**

- Mais estável
- Menos propenso a timeouts

### 4. **executablePath**

Usa Chrome customizado (não Chromium do Puppeteer).

```javascript
const orch = new ConnectionOrchestrator({
    mode: 'executablePath',
    executablePath: '/usr/bin/google-chrome-stable'
});
const browser = await orch.connect();
```

**Use quando:**

- Precisa de Chrome específico
- Extensões customizadas
- Profile persistente

### 5. **auto** (Fallback Inteligente)

Tenta todos os modos em ordem de prioridade.

```javascript
const orch = new ConnectionOrchestrator({
    mode: 'auto',
    autoFallback: true
});
const browser = await orch.connect();
```

**Ordem de fallback:**

1. launcher (mais confiável)
2. wsEndpoint
3. connect
4. executablePath

## Configuração Avançada

### Cache Persistente

Por padrão, Chromium é salvo em `~/.cache/puppeteer` (não /tmp).

```javascript
const orch = new ConnectionOrchestrator({
    cacheDir: '/home/node/.cache/puppeteer' // Persistente
});
```

### Argumentos do Chrome

```javascript
const orch = new ConnectionOrchestrator({
    args: [
        '--no-sandbox',
        '--disable-gpu',
        '--window-size=1920,1080',
        '--disable-web-security' // Apenas para dev
    ]
});
```

### Profile Persistente

```javascript
const orch = new ConnectionOrchestrator({
    userDataDir: '/workspace/profile' // Salva cookies, localStorage, etc
});
```

### Timeouts e Retry

```javascript
const orch = new ConnectionOrchestrator({
    connectionTimeout: 30000, // 30s para conectar
    maxConnectionAttempts: 5, // Máximo de tentativas
    retryDelayMs: 3000, // Delay inicial entre tentativas
    maxRetryDelayMs: 15000 // Delay máximo (backoff exponencial)
});
```

## API Pública

### `async connect()`

Conecta/inicia browser e retorna instância.

```javascript
const browser = await orch.connect();
```

### `async acquireContext()`

Conecta browser E encontra página alvo (para modo connect/wsEndpoint).

```javascript
const { browser, page } = await orch.acquireContext();
```

### `getStatus()`

Obtém estado atual da conexão.

```javascript
const status = orch.getStatus();
// {
//   state: 'BROWSER_READY',
//   mode: 'launcher',
//   browserConnected: true,
//   pageUrl: null,
//   lastIssue: null,
//   attemptedModes: [],
//   retryCount: 0
// }
```

### `static getCacheInfo()`

Informações sobre cache do Puppeteer.

```javascript
const info = ConnectionOrchestrator.getCacheInfo();
// {
//   exists: true,
//   path: '/home/node/.cache/puppeteer',
//   chrome: true,
//   chromeHeadless: true
// }
```

### `static async cleanupTempProfiles()`

Limpa profiles temporários de /tmp.

```javascript
const cleaned = await ConnectionOrchestrator.cleanupTempProfiles();
console.log(`${cleaned} profiles removidos`);
```

## Estados (State Machine)

- `INIT` - Inicializado
- `DETECTING_ENV` - Detectando ambiente
- `WAITING_FOR_BROWSER` - Aguardando conexão
- `CONNECTING_BROWSER` - Conectando
- `RETRY_BROWSER` - Retentando após falha
- `BROWSER_READY` - Browser conectado
- `BROWSER_LOST` - Browser desconectado
- `WAITING_FOR_PAGE` - Aguardando página alvo
- `PAGE_SELECTED` - Página selecionada
- `VALIDATING_PAGE` - Validando página
- `PAGE_VALIDATED` - Página válida
- `PAGE_INVALID` - Página inválida
- `READY` - Totalmente operacional

## Troubleshooting

### Profiles temporários em /tmp

**Problema:** Puppeteer cria profiles em /tmp que não são limpos.

**Solução:**

```javascript
// Executar periodicamente ou no shutdown
await ConnectionOrchestrator.cleanupTempProfiles();
```

### Chrome não conecta (modo connect/wsEndpoint)

**Problema:** ECONNREFUSED ou timeout.

**Causa comum:** Chrome bound a 127.0.0.1 (localhost only).

**Solução:**

```bash
# Windows/Mac/Linux
chrome --remote-debugging-port=9222 --remote-debugging-address=0.0.0.0
```

### Cache não persiste

**Problema:** Chromium baixado a cada execução.

**Solução:** Verificar se `.puppeteerrc.cjs` existe:

```javascript
module.exports = {
    cacheDirectory: path.join(os.homedir(), '.cache', 'puppeteer')
};
```

### Múltiplas instâncias (BrowserPool)

```javascript
// Cada ConnectionOrchestrator cria UMA instância
// Para pool, criar múltiplos orchestrators:
const browsers = await Promise.all([
    new ConnectionOrchestrator().connect(),
    new ConnectionOrchestrator().connect(),
    new ConnectionOrchestrator().connect()
]);
```

## Exemplos de Uso

### Docker → Chrome Externo (Windows)

```javascript
const orch = new ConnectionOrchestrator({
    mode: 'wsEndpoint',
    hosts: ['host.docker.internal'],
    ports: [9222]
});
```

### Profile Persistente (Cookies, Login)

```javascript
const orch = new ConnectionOrchestrator({
    mode: 'launcher',
    userDataDir: '/workspace/chrome-profile'
});
```

### Stealth Mode (Anti-detecção)

```javascript
const orch = new ConnectionOrchestrator({
    mode: 'launcher',
    args: ['--disable-blink-features=AutomationControlled', '--disable-background-networking', '--disable-default-apps']
});
```

### Headless vs Headful

```javascript
// Headless (novo modo - recomendado)
const orch = new ConnectionOrchestrator({ headless: 'new' });

// Headful (visível)
const orch = new ConnectionOrchestrator({ headless: false });
```

## Integração com BrowserPoolManager

O `BrowserPoolManager` usa `ConnectionOrchestrator` internamente:

```javascript
const pool = new BrowserPoolManager({
    poolSize: 3,
    chromium: {
        mode: 'launcher',
        headless: 'new'
    }
});

await pool.initialize();
```

## Performance

- **Cache persistente:** ~350MB em ~/.cache/puppeteer (reutilizado)
- **Profiles temporários:** Limpos automaticamente (antes: ~20MB lixo/execução)
- **Startup:** ~200ms (launcher) vs ~50ms (connect, se Chrome já rodando)
- **Memory:** ~150MB/instância (headless)

## Segurança

⚠️ **NUNCA use em produção:**

- `--disable-web-security`
- `--remote-debugging-address=0.0.0.0` (sem firewall)

✅ **Recomendado:**

- `--no-sandbox` (apenas em containers Docker)
- `--disable-dev-shm-usage` (para ambientes com pouca memória)

## Changelog

### v2.0 (Enhanced - Universal Connection Manager)

- ✅ Suporte a 5 modos de conexão
- ✅ Fallback automático
- ✅ Cache persistente configurável
- ✅ Limpeza de profiles temporários
- ✅ Retry com backoff exponencial
- ✅ Estado detalhado e diagnóstico
- ✅ Argumentos customizáveis
- ✅ Profile persistente opcional

### v1.0 (Legacy)

- Apenas launcher e connect
- Cache em /tmp (não persistente)
- Sem fallback automático
