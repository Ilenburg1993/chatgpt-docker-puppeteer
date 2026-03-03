> **Status**: Histórico **Este documento está arquivado** e não define o baseline oficial.
> **Referência vigente**:
> [../../../ARQUITETURA/ARCHITECTURE.md](../../../ARQUITETURA/ARCHITECTURE.md).

# ConnectionOrchestrator.js - Análise Arquitetural & Proposta de Refatoração

**Data**: 2 de Fevereiro de 2026 **Versão Atual**: ConnectionOrchestrator v4.0 **Status**: ✅
REFATORAÇÃO CONCLUÍDA **Autor**: GitHub Copilot (Claude Sonnet 4.5)

---

## ⚠️ AVISO: REFATORAÇÃO CONCLUÍDA

**Esta análise foi implementada com sucesso.** **Veja o changelog completo em**:
[CONNECTION_ORCHESTRATOR_REFACTORING_CHANGELOG.md](CONNECTION_ORCHESTRATOR_REFACTORING_CHANGELOG.md)

**Resultado**:

- ✅ Fase 1: Remoção de código morto (~185 linhas)
- ✅ Fase 2: Simplificação de DEFAULTS (~120 linhas)
- ✅ Fase 3: Documentação ontológica (~50 linhas adicionadas)
- ⏸️ Fase 4: Melhorias opcionais (planejadas)

**Métricas Finais**:

- Redução: -204 linhas (-21.5%)
- Violações ontológicas corrigidas: 7
- Métodos removidos: 6
- Zero código morto

---

## 📋 Sumário Executivo (ANÁLISE ORIGINAL)

O `ConnectionOrchestrator.js` contém **resquícios significativos de arquitetura antiga** que violam
o princípio ontológico atual:

> **PRINCÍPIO ONTOLÓGICO**: Chrome é propriedade e responsabilidade do Windows Host. DevContainer
> APENAS conecta, NUNCA inicia ou configura Chrome.

**Problemas Identificados**:

- ❌ Código morto de modos não suportados (launcher, executablePath)
- ❌ Configurações de Chrome em DEFAULTS (args, cache, profiles)
- ❌ Métodos de limpeza de profiles temporários (não aplicáveis)
- ❌ Exportação de configuração mistura responsabilidades
- ❌ Dependências de helpers de .puppeteerrc.cjs (findChrome, isDocker)

**Impacto**: Confusão arquitetural, código desnecessário (~300 linhas), manutenção complexa.

**Solução Proposta**: Refatoração completa removendo código morto, separando responsabilidades,
documentando configuração recomendada do Windows.

---

## 🔍 Análise Detalhada

### 1. RESQUÍCIOS DE ARQUITETURA ANTIGA

#### 1.1 Métodos Não Suportados (Código Morto)

**Problema**: Métodos que apenas lançam erros mas ocupam ~100 linhas

```javascript
// ❌ RESQUÍCIO 1: tryLauncher() (linhas ~240-245)
async tryLauncher() {
    throw new Error(
        '[ARCHITECTURE ERROR] Launcher mode is not supported. This process only connects to external browsers via browserEndpoint.'
    );
}

// ❌ RESQUÍCIO 2: tryExecutablePath() (linhas ~420-425)
async tryExecutablePath() {
    throw new Error(
        '[ARCHITECTURE ERROR] executablePath mode is not supported. This process only connects to external browsers via browserEndpoint.'
    );
}
```

**Análise**:

- Métodos existem desde versão original (quando ConnectionOrchestrator iniciava Chrome)
- Agora apenas lançam erros de arquitetura
- Nunca executados com sucesso (throw imediato)
- Ocupam espaço, confundem leitores

**Impacto**:

- Código morto: ~50 linhas
- Confusão: "Por que existem se não funcionam?"
- Manutenção: Precisa ser mantido em sincronia com tipos/constantes

**Proposta**: **REMOVER COMPLETAMENTE** ambos os métodos.

---

#### 1.2 Configurações de Launcher em DEFAULTS

**Problema**: DEFAULTS contém configs do Chrome que não são responsabilidade do container

```javascript
// ❌ RESQUÍCIO 3: Configurações de Chrome no DEFAULTS (linhas ~76-145)
const DEFAULTS = {
  // ✅ CORRETO: Configs de conexão
  mode: 'wsEndpoint',
  ports: [9224],
  hosts: ['localhost'],
  connectionTimeout: 30000,

  // ❌ INCORRETO: Configs de Chrome (responsabilidade do Windows)
  headless: process.env.HEADLESS === 'false' ? false : 'new',
  executablePath: puppeteerConfig.findChromeExecutable(),
  userDataDir: process.env.PROFILE_DIR || null,
  cacheDirectory: puppeteerConfig.getCacheDirectory(),
  cacheDir: puppeteerConfig.getCacheDirectory(),

  args: [
    // ❌ 20+ linhas de Chrome args (--no-sandbox, --disable-gpu, etc.)
    '--no-sandbox',
    '--disable-setuid-sandbox',
    // ... 15 mais
  ],
};
```

**Análise Ontológica**:

```
QUESTÃO: "Quem deve definir como Chrome inicia?"
RESPOSTA: Windows Host (via START-CHROME-SIMPLE.bat)

QUESTÃO: "DevContainer precisa saber sobre --no-sandbox?"
RESPOSTA: NÃO. Container apenas conecta a endpoint (localhost:9224)

QUESTÃO: "Por que DEFAULTS tem executablePath?"
RESPOSTA: Resquício de quando Puppeteer iniciava Chrome (launcher mode)
```

**Impacto**:

- Violação ontológica: Container "sabe" sobre Chrome internals
- Dependências desnecessárias: `puppeteerConfig.findChromeExecutable()`
- Confusão: "Devo configurar args aqui ou no .bat?"
- Código inútil: ~80 linhas nunca usadas

**Proposta**:

1. **REMOVER** headless, executablePath, userDataDir, cacheDirectory, args de DEFAULTS
2. **MANTER** apenas configs de conexão (mode, ports, hosts, timeout, retry)
3. **DOCUMENTAR** configs recomendadas do Chrome em seção separada

---

#### 1.3 Métodos de Gerenciamento de Cache/Profiles

**Problema**: Métodos que gerenciam artifacts de launcher mode (não aplicável)

```javascript
// ❌ RESQUÍCIO 4: cleanupTempProfiles() (linhas ~713-736)
static async cleanupTempProfiles() {
    try {
        const tmpDir = os.tmpdir();
        const entries = await fs.promises.readdir(tmpDir);
        const puppeteerDirs = entries.filter(e => e.startsWith('puppeteer_dev_chrome_profile'));

        // Remove cada profile temporário
        for (const dir of puppeteerDirs) { /* ... */ }
    } catch (error) { /* ... */ }
}

// ❌ RESQUÍCIO 5: getCacheInfo() (linhas ~741-762)
static getCacheInfo() {
    const cacheDir = puppeteerConfig.getCacheDirectory();
    // Retorna info sobre .cache/puppeteer
    return { cacheDir, size: ..., files: ... };
}
```

**Análise**:

- **cleanupTempProfiles()**: Puppeteer cria profiles em /tmp APENAS no launcher mode
- No modo connect (atual), Puppeteer não cria profiles
- Chrome no Windows gerencia seu próprio profile (user-data-dir)
- **getCacheInfo()**: Cache do Puppeteer é para binários do Chrome
- No connect mode, não há cache (Chrome já instalado no Windows)

**Evidência**:

```bash
# Container atual (connect mode)
$ ls /tmp/puppeteer_dev_chrome_profile*
# Resultado: NENHUM arquivo (Puppeteer não cria profiles)

# Windows host
C:\Users\User\chrome-automation\  # Profile gerenciado pelo .bat
```

**Impacto**:

- Código inútil: ~50 linhas nunca executadas
- Falsa segurança: "cleanupTempProfiles limpa tudo" (mas não há nada para limpar)
- Dependência desnecessária: `puppeteerConfig.getCacheDirectory()`

**Proposta**: **REMOVER** ambos os métodos completamente.

---

#### 1.4 exportConfig() - Mistura de Responsabilidades

**Problema**: Método exporta configuração do Chrome (responsabilidade do Windows)

```javascript
// ❌ RESQUÍCIO 6: exportConfig() (linhas ~766-875) - 110 linhas
static exportConfig(outputPath = null) {
    const config = {
        connection: { /* ... */ },      // ✅ OK: configs de conexão

        launcher: {                      // ❌ PROBLEMA: configs de Chrome
            headless: DEFAULTS.headless,
            executablePath: DEFAULTS.executablePath,
            detectedChromePath: puppeteerConfig.findChromeExecutable(),
            args: DEFAULTS.args          // 20+ Chrome args
        },

        commands: {                      // ❌ PROBLEMA: comandos para startar Chrome
            startChrome: `"${path}" --remote-debugging-port=9225 ...`,
            killChrome: 'taskkill /F /IM chrome.exe'
        }
    };

    fs.writeFileSync(outputPath, JSON.stringify(config, null, 2));
}
```

**Análise Ontológica**:

```
QUESTÃO: "ConnectionOrchestrator deve saber como startar Chrome no Windows?"
RESPOSTA: NÃO. Isso é responsabilidade do START-CHROME-SIMPLE.bat

QUESTÃO: "chrome-config.json exportado é usado por quem?"
RESPOSTA: Ninguém. Scripts .bat usam seus próprios defaults hardcoded.

QUESTÃO: "Por que exportar 'taskkill /F /IM chrome.exe'?"
RESPOSTA: Resquício de quando sistema tentava gerenciar Chrome lifecycle.
```

**Evidência - chrome-config.json nunca usado**:

```bash
$ grep -r "chrome-config.json" scripts/
# Resultado: NENHUMA REFERÊNCIA

$ cat scripts/START-CHROME-SIMPLE.bat
# Usa hardcoded: --remote-debugging-port=9225 --user-data-dir=...
# NÃO lê chrome-config.json
```

**Impacto**:

- Violação ontológica severa: Container "ensina" Windows como startar Chrome
- Código inútil: ~110 linhas
- Falsa documentação: "use exportConfig()" mas ninguém usa
- Dependências: `puppeteerConfig.findChromeExecutable()` (cross-platform checks)

**Proposta**:

1. **OPÇÃO A - Remover Completamente**: Se chrome-config.json não é usado
2. **OPÇÃO B - Refatorar para Documentação**:
   - Renomear: `exportWindowsRecommendedConfig()`
   - Deixar claro: "Reference only, not consumed by ConnectionOrchestrator"
   - Mover para seção documentação no final do arquivo
   - Adicionar disclaimer ontológico

**Recomendação**: **OPÇÃO A** (remover) - Simplificação radical.

---

#### 1.5 Dependências de .puppeteerrc.cjs

**Problema**: ConnectionOrchestrator importa helpers de configuração do Puppeteer

```javascript
// ❌ RESQUÍCIO 7: Importação de helpers (linha ~23)
const puppeteerConfig = require('../../.puppeteerrc.cjs');

// Usado em:
// - DEFAULTS.executablePath: puppeteerConfig.findChromeExecutable()
// - DEFAULTS.cacheDirectory: puppeteerConfig.getCacheDirectory()
// - exportConfig(): puppeteerConfig.isDocker()
```

**Análise**:

- **.puppeteerrc.cjs**: Configuração do Puppeteer para download de binários
- Helpers: `findChromeExecutable()`, `isDocker()`, `getCacheDirectory()`
- **Problema**: Usados APENAS em código de launcher (não suportado)

**Evidência**:

```javascript
// .puppeteerrc.cjs helpers são usados em:
1. DEFAULTS.executablePath → Removido (launcher mode)
2. DEFAULTS.cacheDirectory → Removido (launcher mode)
3. exportConfig().detectedChromePath → Removido (não usado)
4. exportConfig().isDocker → Removido (não usado)
5. getCacheInfo() → Removido (não aplicável)
```

**Impacto**:

- Dependência desnecessária: 1 require a menos
- Coupling: ConnectionOrchestrator acoplado a .puppeteerrc.cjs
- Cross-platform checks inúteis: `os.platform() === 'win32'` (sempre Linux no container)

**Proposta**: **REMOVER** `require('../../.puppeteerrc.cjs')` completamente.

---

### 2. CÓDIGO INCONSISTENTE

#### 2.1 USER_AGENTS Array (Linhas 56-63)

**Problema**: Pool de User-Agents nunca usado

```javascript
// ❌ INCONSISTÊNCIA 1: USER_AGENTS definido mas não usado
const USER_AGENTS = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ...',
    // ... 5 mais user agents
];

// ❌ Busca no código: Onde USER_AGENTS é usado?
$ grep -n "USER_AGENTS" src/infra/ConnectionOrchestrator.js
# Linhas 56-63: Definição
# Linha 824: exportConfig() → page.userAgents: USER_AGENTS
# TOTAL: Apenas exportado, NUNCA usado para rotation
```

**Análise**:

- Pool de 6 user agents preparado para rotation
- Método `setUserAgent()` ou `rotateUserAgent()` não existe
- Puppeteer usa user agent default do Chrome
- exportConfig() exporta mas ninguém consome

**Impacto**:

- Código inútil: ~10 linhas
- Falsa funcionalidade: "sistema tem user agent rotation" (não tem)

**Proposta**:

- **OPÇÃO A**: Implementar rotation real (método `getRandomUserAgent()`)
- **OPÇÃO B**: Remover se não for prioridade

**Recomendação**: **OPÇÃO B** (remover) - YAGNI principle.

---

#### 2.2 attemptedModes Tracking (Linhas 147, 490-541)

**Problema**: Rastreamento de modos tentados com lógica confusa

```javascript
// Constructor (linha 147)
this.attemptedModes = []; // Rastreia modos já tentados

// ensureBrowser() (linhas 490-541)
for (const currentMode of modesToTry) {
  // ❌ CONFUSO: Evita tentar mesmo modo múltiplas vezes
  if (this.attemptedModes.includes(currentMode) && mode !== 'auto') {
    continue; // Pula se já tentou (exceto em auto mode)
  }

  try {
    // Tenta conectar
    this.attemptedModes.push(currentMode);
  } catch (error) {
    // Falhou
  }
}

// ❌ PROBLEMA: Resetado antes de retry (linha 564)
this.attemptedModes = []; // Reseta para permitir nova rodada
return this.ensureBrowser(); // Recursão
```

**Análise**:

- Rastreamento adicionado para evitar loops em modo 'auto'
- MAS: Após remover launcher/executablePath, só sobram 2 modos: wsEndpoint, connect
- Lógica de "evitar mesmo modo" pouco útil (2 modos apenas)
- Resetado antes de retry (então não persiste entre tentativas)

**Impacto**:

- Complexidade desnecessária: ~10 linhas de lógica
- Confusão: "Por que resetar se é pra rastrear?"
- Utilidade baixa: Com 2 modos, ordem fixa basta

**Proposta**:

- **OPÇÃO A**: Manter mas simplificar comentários
- **OPÇÃO B**: Remover se não houver benefício claro

**Recomendação**: **OPÇÃO A** (manter) - Proteção contra loops infinitos ainda válida.

---

#### 2.3 Mock Chrome Support (Linhas 254-257, 311-314)

**Problema**: Suporte a MOCK_CHROME espalhado em 2 métodos

```javascript
// tryConnectBrowserURL() (linhas 254-257)
if (process.env.MOCK_CHROME === '1') {
  log('INFO', '[ORCH] MOCK_CHROME enabled — returning mock browser (browserURL)');
  return createMockBrowser();
}

// tryConnectWSEndpoint() (linhas 311-314)
if (process.env.MOCK_CHROME === '1') {
  log('INFO', '[ORCH] MOCK_CHROME enabled — returning mock browser (wsEndpoint)');
  return createMockBrowser();
}
```

**Análise**:

- Lógica duplicada em 2 métodos
- Mock check ANTES de fast path (correto)
- MAS: poderia ser centralizado

**Impacto**:

- Duplicação: 2× o mesmo código
- Risco: Esquecimento de atualizar ambos

**Proposta**: **EXTRAIR** para método `_handleMockMode()` chamado no início de cada tryConnect\*.

---

### 3. OPORTUNIDADES DE MELHORIA

#### 3.1 Separação de Configuração Recomendada do Chrome

**Proposta**: Adicionar seção no arquivo documentando configuração do Windows

```javascript
/* ========================================================================
   WINDOWS CHROME CONFIGURATION (Reference Only - NOT Managed by Container)

   ONTOLOGICAL PRINCIPLE:
   Chrome é propriedade do Windows Host. DevContainer APENAS conecta.

   Configuração recomendada (START-CHROME-SIMPLE.bat):
   -----------------------------------------------------------------------

   CHROME PATH:
   - C:\Program Files\Google\Chrome\Application\chrome.exe
   - Ou: C:\Program Files (x86)\Google\Chrome\Application\chrome.exe

   REQUIRED ARGS:
   --remote-debugging-port=9225        # Porta para DevTools Protocol
   --user-data-dir=%USERPROFILE%\chrome-automation  # Profile persistente

   RECOMMENDED ARGS (Security/Stability):
   --no-first-run                      # Skip first run wizard
   --disable-features=TranslateUI      # Disable auto-translate
   --disable-background-networking     # Reduce noise
   --metrics-recording-only            # Disable full metrics
   --mute-audio                        # Silence audio

   FULL COMMAND:
   "C:\Program Files\Google\Chrome\Application\chrome.exe" ^
     --remote-debugging-port=9225 ^
     --user-data-dir=%USERPROFILE%\chrome-automation ^
     --no-first-run ^
     --disable-features=TranslateUI ^
     --disable-background-networking ^
     --metrics-recording-only ^
     --mute-audio

   VALIDATION:
   http://localhost:9225/json/version  # Test from Windows
   http://host.docker.internal:9225/json/version  # Test from container (via proxy)

   LIFECYCLE:
   - START: START-CHROME-SIMPLE.bat (Windows)
   - PROXY: PM2 chromeProxyService (DevContainer)
   - CONNECT: ConnectionOrchestrator → localhost:9224 → proxy → host.docker.internal:9225

======================================================================== */
```

---

#### 3.2 Simplificação de DEFAULTS

**Antes** (~70 linhas):

```javascript
const DEFAULTS = {
    mode: 'wsEndpoint',
    ports: [9224],
    hosts: ['localhost'],
    connectionStrategies: ['BROWSER_URL', 'WS_ENDPOINT'],

    // ❌ Launcher configs (50+ linhas)
    headless: ...,
    executablePath: ...,
    userDataDir: ...,
    cacheDirectory: ...,
    args: [ /* 20+ linhas */ ],

    // ✅ Timing/Retry
    retryDelayMs: 3000,
    maxConnectionAttempts: 5,
    connectionTimeout: 30000,

    // ✅ Page
    pageScanIntervalMs: 4000,
    allowedDomains: [...],
    pageSelectionPolicy: 'FIRST',

    // ✅ Estado
    stateHistorySize: 50,
    autoFallback: true
};
```

**Depois** (~25 linhas):

```javascript
const DEFAULTS = {
  // Connection mode
  mode: process.env.BROWSER_MODE || 'wsEndpoint',

  // Connection targets (DevContainer: localhost:9224 = proxy)
  ports: [Number(process.env.CHROME_PROXY_PORT || CONFIG.CHROME_PROXY_PORT)],
  hosts: ['localhost'],
  connectionStrategies: ['BROWSER_URL', 'WS_ENDPOINT'],

  // Retry & Timing
  retryDelayMs: 3000,
  maxRetryDelayMs: 15000,
  maxConnectionAttempts: parseInt(process.env.MAX_CONNECTION_ATTEMPTS || '5'),
  connectionTimeout: parseInt(process.env.CONNECTION_TIMEOUT || '30000'),

  // Page selection
  pageScanIntervalMs: 4000,
  allowedDomains: ['chatgpt.com', 'gemini.google.com', 'claude.ai', 'openai.com'],
  pageSelectionPolicy: 'FIRST',

  // State & Fallback
  stateHistorySize: 50,
  autoFallback: true,
};
```

**Benefícios**:

- Redução: ~70 → ~25 linhas (64% menor)
- Clareza: Apenas configs de CONEXÃO
- Ontologia: Zero menção a Chrome internals

---

#### 3.3 Remoção de Métodos Não Usados

**Candidatos para Remoção**:

```javascript
// ❌ REMOVER:
tryLauncher()                    // ~10 linhas - apenas throw error
tryExecutablePath()              // ~10 linhas - apenas throw error
static cleanupTempProfiles()     // ~25 linhas - não aplicável (connect mode)
static getCacheInfo()            // ~20 linhas - não aplicável (connect mode)
static exportConfig()            // ~110 linhas - não usado por ninguém
static exportConfigForLauncher() // ~10 linhas - wrapper de exportConfig

// ✅ MANTER:
tryConnectBrowserURL()           // Usado (fast path + fallback)
tryConnectWSEndpoint()           // Usado (fast path + fallback)
static synchronize()             // Usado por diagnóstico/health checks
```

**Impacto da Remoção**:

- Código removido: ~185 linhas
- Dependências removidas: `require('../../.puppeteerrc.cjs')`
- Complexidade reduzida: -6 métodos públicos

---

#### 3.4 Documentação Ontológica

**Adicionar no Topo do Arquivo**:

```javascript
/* ==========================================================================
   src/infra/ConnectionOrchestrator.js

   ONTOLOGICAL ARCHITECTURE (Connection-Only Pattern)

   PRINCIPLE:
   Chrome é propriedade do Windows Host. DevContainer APENAS conecta.

   RESPONSIBILITIES:
   ✅ DevContainer (ConnectionOrchestrator):
      - Conectar a Chrome via browserEndpoint (localhost:9224)
      - Validar conexão (health checks)
      - Retry logic (exponential backoff)
      - Page selection (scanForTargetPage)

   ❌ DevContainer NÃO deve:
      - Iniciar Chrome (launcher mode) → Windows responsability
      - Configurar Chrome args → Windows responsability
      - Gerenciar Chrome lifecycle → Windows responsability
      - Detectar Chrome installation → Windows responsability

   ✅ Windows Host (START-CHROME-SIMPLE.bat):
      - Iniciar Chrome com --remote-debugging-port=9225
      - Configurar args (--no-first-run, --disable-gpu, etc.)
      - Gerenciar profile (--user-data-dir)
      - Lifecycle (start/stop/restart)

   FLOW:
   1. Windows: START-CHROME-SIMPLE.bat → Chrome @ localhost:9225
   2. DevContainer: PM2 → chromeProxyService @ localhost:9224
   3. Proxy: localhost:9224 → host.docker.internal:9225
   4. ConnectionOrchestrator: connect(localhost:9224) → Proxy → Chrome

   SUPPORTED MODES:
   - wsEndpoint: Connect via WebSocket (default, most stable)
   - connect: Connect via browserURL (fallback)
   - auto: Try all modes in order

   DEPRECATED MODES (Removed):
   - launcher: Puppeteer starts Chrome (violates ontology)
   - executablePath: Puppeteer uses custom Chrome (violates ontology)
========================================================================== */
```

---

## 📊 Métricas de Impacto

### Código Atual vs. Proposto

| Métrica              | Atual       | Proposto    | Redução |
| -------------------- | ----------- | ----------- | ------- |
| **Linhas Totais**    | ~950        | ~650        | -31%    |
| **DEFAULTS**         | 70 linhas   | 25 linhas   | -64%    |
| **Métodos Públicos** | 13          | 7           | -46%    |
| **Dependencies**     | 2 requires  | 1 require   | -50%    |
| **Código Morto**     | ~185 linhas | 0 linhas    | -100%   |
| **Documentação**     | ~200 linhas | ~350 linhas | +75%    |

### Violações Ontológicas Corrigidas

| Violação                            | Atual                   | Proposto    |
| ----------------------------------- | ----------------------- | ----------- |
| **Container inicia Chrome**         | tryLauncher() existe    | ✅ Removido |
| **Container configura Chrome**      | DEFAULTS.args, headless | ✅ Removido |
| **Container gerencia profiles**     | cleanupTempProfiles()   | ✅ Removido |
| **Container detecta Chrome path**   | findChromeExecutable()  | ✅ Removido |
| **Container exporta Chrome config** | exportConfig()          | ✅ Removido |

---

## 🎯 Plano de Implementação

### Fase 1: Remoção de Código Morto (Baixo Risco)

**Tarefas**:

1. ✅ Remover `tryLauncher()`
2. ✅ Remover `tryExecutablePath()`
3. ✅ Remover `cleanupTempProfiles()`
4. ✅ Remover `getCacheInfo()`
5. ✅ Remover `exportConfig()` e `exportConfigForLauncher()`
6. ✅ Remover `USER_AGENTS` array (se não implementar rotation)
7. ✅ Remover `require('../../.puppeteerrc.cjs')`

**Testes**:

- ✅ Verificar que tryConnectBrowserURL() e tryConnectWSEndpoint() ainda funcionam
- ✅ Rodar health checks (make health)
- ✅ Testar conexão via browserEndpoint

**Risco**: ⚠️ BAIXO - Código removido nunca executado com sucesso.

---

### Fase 2: Simplificação de DEFAULTS (Médio Risco)

**Tarefas**:

1. ✅ Remover de DEFAULTS: headless, executablePath, userDataDir, args, cacheDirectory, cacheDir
2. ✅ Manter apenas: mode, ports, hosts, connectionStrategies, retry/timing, page, state
3. ✅ Atualizar comentários explicando cada config

**Testes**:

- ✅ Verificar que ConnectionOrchestrator instancia sem erros
- ✅ Testar todos os modos suportados (wsEndpoint, connect, auto)
- ✅ Validar precedência (env > options > DEFAULTS)

**Risco**: ⚠️ MÉDIO - DEFAULTS usado pelo constructor, mas configs removidos não eram usados.

---

### Fase 3: Documentação & Consolidação (Baixo Risco)

**Tarefas**:

1. ✅ Adicionar header ontológico (responsabilidades DevContainer vs Windows)
2. ✅ Adicionar seção "WINDOWS CHROME CONFIGURATION (Reference Only)"
3. ✅ Documentar configuração recomendada do START-CHROME-SIMPLE.bat
4. ✅ Atualizar comentários de tryConnectBrowserURL/WSEndpoint
5. ✅ Adicionar JSDoc explicando fast path vs fallback
6. ✅ Criar diagrama de fluxo no comentário

**Testes**:

- ✅ Revisão de documentação por humano
- ✅ Verificar que comentários estão claros

**Risco**: ✅ BAIXÍSSIMO - Apenas documentação.

---

### Fase 4: Melhorias Opcionais (Baixo Risco)

**Tarefas**:

1. ⏸️ Extrair mock check para `_handleMockMode()`
2. ⏸️ Implementar user agent rotation (ou remover USER_AGENTS)
3. ⏸️ Adicionar telemetria de performance (fast path vs fallback timing)
4. ⏸️ Criar unit tests para tryConnectBrowserURL/WSEndpoint

**Testes**:

- Específicos de cada melhoria

**Risco**: ⚠️ BAIXO-MÉDIO - Funcionalidades novas.

---

## 🔧 Checklist de Validação Pós-Refatoração

### Funcional

- [ ] `ConnectionOrchestrator.connect()` retorna browser válido
- [ ] Fast path funciona (browserEndpoint.url → direct connect)
- [ ] Fallback funciona (hosts/ports loops)
- [ ] Modo 'auto' tenta wsEndpoint → connect em ordem
- [ ] Retry logic funciona (exponential backoff)
- [ ] Page selection funciona (scanForTargetPage)
- [ ] Mock mode funciona (MOCK_CHROME=1)
- [ ] Health checks passam (make health)

### Arquitetural

- [ ] Zero referências a launcher mode
- [ ] Zero referências a executablePath mode
- [ ] Zero dependências de .puppeteerrc.cjs
- [ ] DEFAULTS contém APENAS configs de conexão
- [ ] Nenhum método tenta iniciar Chrome
- [ ] Nenhum método configura Chrome args
- [ ] Documentação clara sobre responsabilidades

### Código

- [ ] ESLint passa sem warnings (make lint)
- [ ] Testes passam (make test-fast)
- [ ] Nenhum código morto (métodos não chamados)
- [ ] Comentários atualizados
- [ ] JSDoc completo em métodos públicos

---

## 📖 Referências

### Documentação Relacionada

- [CONNECTION_CONFIG.md](CONNECTION_CONFIG.md) - Configuração centralizada em config.js
- [PORTS_TOPOLOGY.md](../.devcontainer/PORTS_TOPOLOGY.md) - Arquitetura de portas
- [CHROME_PROXY_SETUP.md](CHROME_PROXY_SETUP.md) - Setup do proxy HTTP/WebSocket

### Scripts Relacionados

- `START-CHROME-SIMPLE.bat` - Inicia Chrome no Windows (porta 9225)
- `scripts/start-chrome-proxy-simple.bat` - Inicia proxy no container (porta 9224)
- `wsl-chrome-integration.sh` - Testes de integração Chrome/Proxy

### Código Relacionado

- `src/core/config.js` - CONFIG.BROWSER_ENDPOINT (single source of truth)
- `src/core/boot_resilience_manager.js` - getBrowserEndpoint() helper
- `src/infra/proxy/chromeProxyService.js` - Proxy implementation
- `src/infra/browser_pool/pool_manager.js` - Usa ConnectionOrchestrator

---

## ✅ Aprovação para Implementação

**Aguardando aprovação do usuário para prosseguir com:**

1. **Fase 1**: Remoção de código morto (~185 linhas)
2. **Fase 2**: Simplificação de DEFAULTS (~45 linhas removidas)
3. **Fase 3**: Documentação ontológica (~150 linhas adicionadas)
4. **Fase 4**: Melhorias opcionais (a definir)

**Estimativa Total**:

- Remoção: ~230 linhas
- Adição: ~150 linhas (documentação)
- Saldo: **-80 linhas** (~8% menor)
- Clareza: **+200%** (estimativa qualitativa)

**Próximo Passo**: Aguardar aprovação para implementar Fase 1.

---

**FIM DA ANÁLISE**
