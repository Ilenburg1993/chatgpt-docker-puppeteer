# Cross-Platform Support Documentation

**Última atualização:** 21/01/2026
**Versão:** 2.1

## 📋 Política de Suporte Multi-Plataforma

**TODOS os componentes deste projeto devem ter suporte completo para:**

- ✅ **Windows** (Windows 10/11)
  - cmd.exe (Command Prompt)
  - PowerShell 5.1+
  - Git Bash (opcional mas recomendado)
- ✅ **Linux** (Ubuntu 20.04+, Debian 11+, outros)
  - bash shell
  - Distribuições modernas com systemd
- ✅ **macOS** (10.15 Catalina+)
  - bash/zsh shell
  - Apple Silicon (M1/M2) e Intel

## 🎯 Componentes com Suporte Cross-Platform

### 1. Super Launcher v2.0 (FASE 1)

| Componente | Windows | Linux | macOS | Status |
|------------|---------|-------|-------|--------|
| LAUNCHER.bat / launcher.sh | ✅ | ✅ | ✅ | COMPLETO |
| Menu interativo | ✅ | ✅ | ✅ | COMPLETO |
| 10 operações | ✅ | ✅ | ✅ | COMPLETO |

**Arquivos:**
- Windows: `LAUNCHER.bat`
- Linux/macOS: `launcher.sh`

### 2. Scripts Utilitários (FASE 2)

| Script | Windows | Linux | macOS | Localização |
|--------|---------|-------|-------|-------------|
| quick-ops | ✅ | ✅ | ✅ | `scripts/quick-ops.{bat,sh}` |
| watch-logs | ✅ | ✅ | ✅ | `scripts/watch-logs.{bat,sh}` |
| install-pm2-gui | ✅ | ✅ | ✅ | `scripts/install-pm2-gui.{bat,sh}` |
| setup-pm2-plus | ✅ | ✅ | ✅ | `scripts/setup-pm2-plus.{bat,sh}` |

**Convenção:**
- Todos os scripts têm versões `.bat` (Windows) e `.sh` (Linux/macOS)
- Mesma funcionalidade em todas as plataformas
- Mesmo formato de output

### 3. Dashboard HTML (FASE 5)

| Recurso | Windows | Linux | macOS | Notas |
|---------|---------|-------|-------|-------|
| Interface HTML | ✅ | ✅ | ✅ | Roda em qualquer browser |
| Health endpoints | ✅ | ✅ | ✅ | Server escuta localhost:2998 |
| Auto-refresh | ✅ | ✅ | ✅ | JavaScript cross-platform |
| Abrir via Makefile | ✅ | ✅ | ✅ | `start`/`xdg-open`/`open` |

**Arquivo:** `scripts/launcher-dashboard.html`

### 4. Makefile v2.1 (FASE 1 - Otimização)

| Comando | Windows | Linux | macOS | Implementação |
|---------|---------|-------|-------|---------------|
| make help | ✅ | ✅ | ✅ | Echo puro |
| make start | ✅ | ✅ | ✅ | npm scripts |
| make health | ✅ | ✅ | ✅ | PowerShell (Win) / curl (Linux/Mac) |
| make launcher | ✅ | ✅ | ✅ | Detecção de OS |
| make quick CMD=X | ✅ | ✅ | ✅ | Chama script correto |
| make dashboard | ✅ | ✅ | ✅ | `start`/`xdg-open`/`open` |
| make test-integration | ✅ | ✅ | ✅ | Node.js puro |
| make pm2-monit | ✅ | ✅ | ✅ | PM2 CLI |

**Detecção de plataforma:**
```makefile
ifeq ($(OS),Windows_NT)
    DETECTED_OS := Windows
    LAUNCHER = LAUNCHER.bat
    QUICK_OPS = scripts\quick-ops.bat
else
    UNAME_S := $(shell uname -s)
    ifeq ($(UNAME_S),Linux)
        DETECTED_OS := Linux
        LAUNCHER = bash launcher.sh
    endif
    ifeq ($(UNAME_S),Darwin)
        DETECTED_OS := macOS
        LAUNCHER = bash launcher.sh
    endif
endif
```

### 5. Testes Integração (FASE 8)

| Teste | Windows | Linux | macOS | Status |
|-------|---------|-------|-------|--------|
| test_launcher_integration.js | ✅ | ✅ | ✅ | 8/8 suites |
| Detecção de plataforma | ✅ | ✅ | ✅ | process.platform |
| Validação de arquivos | ✅ | ✅ | ✅ | fs.existsSync |
| Execução de scripts | ✅ | ✅ | ✅ | child_process.execSync |

**Arquivo:** `tests/integration/test_launcher_integration.js`

## 🛠️ Tecnologias Cross-Platform Utilizadas

### Core
- **Node.js** (v20+) - Runtime JavaScript multiplataforma
- **npm** - Gerenciador de pacotes (funciona em todas)
- **PM2** - Process manager (instalável em todas)

### Automação
- **Puppeteer** - Controle de browser (Chrome/Edge em todas)
- **Chromium** - Browser engine (versões para todas)

### Shell/Scripts
- **Windows**: cmd.exe + PowerShell 5.1+
- **Linux/macOS**: bash shell (compatível POSIX)

### Build Tools
- **GNU Make** - Disponível nativamente (Linux/Mac) ou via MinGW/Git Bash (Windows)

## 📝 Diretrizes de Desenvolvimento

### Ao criar novos scripts:

1. **SEMPRE criar versões .bat e .sh**
   ```
   scripts/
     ├── new-feature.bat    # Windows
     └── new-feature.sh     # Linux/macOS
   ```

2. **Testar em todas as plataformas antes de commit**
   - Windows 10/11 (cmd + PowerShell)
   - Ubuntu 22.04+ ou similar
   - macOS 12+ (Intel ou Apple Silicon)

3. **Usar Node.js para lógica complexa**
   - Evita diferenças entre shells
   - Facilita manutenção
   - Exemplo: `test-health-logic.js`

4. **Documentar comandos específicos de plataforma**
   ```bash
   # Linux/macOS
   curl -s http://localhost:2998/api/health

   # Windows (PowerShell)
   Invoke-WebRequest -Uri http://localhost:2998/api/health -UseBasicParsing
   ```

5. **Evitar hardcoded paths**
   ```javascript
   // ❌ Não fazer
   const path = 'C:\\Users\\data\\file.json';

   // ✅ Fazer
   const path = require('path').join(__dirname, 'data', 'file.json');
   ```

6. **Usar variáveis de ambiente cross-platform**
   ```javascript
   // ❌ Windows-only
   const home = process.env.USERPROFILE;

   // ✅ Cross-platform
   const home = require('os').homedir();
   ```

### Comandos que funcionam diferente:

| Comando | Windows (cmd) | Windows (PowerShell) | Linux/macOS |
|---------|---------------|---------------------|-------------|
| Limpar tela | `cls` | `Clear-Host` | `clear` |
| Listar arquivos | `dir` | `Get-ChildItem` | `ls` |
| Remover arquivo | `del` | `Remove-Item` | `rm` |
| Variável de ambiente | `%VAR%` | `$env:VAR` | `$VAR` |
| Path separator | `\` | `\` ou `/` | `/` |
| Executável | `.exe` | `.exe` | (sem extensão) |
| Fim de linha | `CRLF` | `CRLF` | `LF` |
| Null device | `nul` | `$null` | `/dev/null` |

## 🧪 Como Testar Cross-Platform

### 1. Testes Manuais

**Windows:**
```cmd
cd C:\path\to\project
make help
make version
make test-integration
LAUNCHER.bat
```

**Linux/macOS:**
```bash
cd /path/to/project
make help
make version
make test-integration
bash launcher.sh
```

### 2. Testes Automatizados

```bash
# Executa suite completa (detecta plataforma automaticamente)
node tests/integration/test_launcher_integration.js
```

### 3. CI/CD Multi-Plataforma

Nosso GitHub Actions deve testar em:
- Windows Server 2022
- Ubuntu 22.04
- macOS 12+

## 📊 Status de Compatibilidade

| Componente | Windows | Linux | macOS | Última verificação |
|------------|---------|-------|-------|-------------------|
| Super Launcher | ✅ 100% | ✅ 100% | ✅ 100% | 21/01/2026 |
| Scripts Utilitários | ✅ 100% | ✅ 100% | ✅ 100% | 21/01/2026 |
| Health Endpoints | ✅ 100% | ✅ 100% | ✅ 100% | 21/01/2026 |
| Dashboard HTML | ✅ 100% | ✅ 100% | ✅ 100% | 21/01/2026 |
| Makefile v2.1 | ✅ 100% | ✅ 100% | ✅ 100% | 21/01/2026 |
| Testes Integração | ✅ 100% | ✅ 100% | ✅ 100% | 21/01/2026 |
| Core Agent | ✅ 100% | ✅ 100% | ✅ 100% | (Node.js nativo) |
| Puppeteer | ✅ 100% | ✅ 100% | ✅ 100% | (Cross-platform) |
| PM2 | ✅ 100% | ✅ 100% | ✅ 100% | (Cross-platform) |

## 🔍 Troubleshooting Cross-Platform

### Windows

**Problema:** `make: command not found`
- **Solução:** Instale Git for Windows (inclui Git Bash + make) ou use nmake

**Problema:** Scripts .sh não executam
- **Solução:** Use Git Bash ou WSL2, não cmd.exe puro

**Problema:** PowerShell restrição de execução
- **Solução:** `Set-ExecutionPolicy RemoteSigned -Scope CurrentUser`

### Linux

**Problema:** Permission denied em scripts .sh
- **Solução:** `chmod +x script.sh`

**Problema:** curl não encontrado
- **Solução:** `sudo apt install curl` (Debian/Ubuntu)

### macOS

**Problema:** "Developer cannot be verified"
- **Solução:** System Preferences > Security > Allow

**Problema:** bash vs zsh
- **Solução:** Scripts compatíveis com ambos

## 📚 Referências

- [Node.js Platform API](https://nodejs.org/api/os.html#osplatform)
- [Cross-platform Node.js Best Practices](https://github.com/sindresorhus/guides/blob/main/node-best-practices.md)
- [GNU Make Manual](https://www.gnu.org/software/make/manual/)
- [PowerShell Documentation](https://docs.microsoft.com/en-us/powershell/)

## ✅ Checklist para Novos Recursos

Antes de fazer PR/commit, verificar:

- [ ] Script .bat criado para Windows
- [ ] Script .sh criado para Linux/macOS
- [ ] Makefile atualizado (se aplicável)
- [ ] Testado em Windows 10/11
- [ ] Testado em Linux (Ubuntu ou similar)
- [ ] Testado em macOS (se disponível)
- [ ] Documentação atualizada
- [ ] Testes integração passando
- [ ] Paths usando `path.join()` ou similar
- [ ] Comandos shell documentados por plataforma

---

## 📦 Makefile v2.2 - Arquitetura Delegada (21/01/2026)

### Princípio Arquitetural

**"Make = orquestrador, Scripts = implementação"**

O Makefile v2.2 foi auditado e corrigido seguindo o princípio de que **Make é excelente para orquestração; não excelente como substituto de shell scripts**. Lógica complexa foi delegada para scripts dedicados por plataforma.

### Correções Críticas Implementadas

**1. Variáveis Centralizadas**
```make
NPM := npm
PM2 := pm2
NODE := node
DC := docker-compose
CURL := curl
HEALTH_PORT ?= 2998
```

**2. Scripts Delegados por Plataforma**
```make
ifeq ($(OS),Windows_NT)
    HEALTH_SCRIPT := powershell -ExecutionPolicy Bypass -File scripts/health-windows.ps1
else
    HEALTH_SCRIPT := bash scripts/health-posix.sh
endif
```

**3. Helpers Cross-Platform (defines)**
```make
define sleep_cmd
    cmd /C "timeout /t $(1) /nobreak >nul 2>&1"  # Windows
    sleep $(1)  # Linux/Mac
endef

define open_cmd
    cmd /C "start $(1)"  # Windows
    open $(1) 2>/dev/null  # macOS
    xdg-open $(1) 2>/dev/null  # Linux
endef
```

**4. Validação Shell (corrigido de `ifndef`)**
```make
# ERRADO (v2.1): ifndef dentro de receita
quick:
ifndef CMD
    @echo "Error..."
endif

# CORRETO (v2.2): validação no shell
quick:
    @if [ -z "$(CMD)" ]; then \
        echo "Error: CMD required"; \
        exit 1; \
    fi
```

**5. Check Dependencies**
```make
check-deps:
    @command -v node >/dev/null 2>&1 || (echo "✗ Node.js not found" && exit 1)
    @command -v npm >/dev/null 2>&1 || (echo "✗ NPM not found" && exit 1)
    @command -v pm2 >/dev/null 2>&1 || echo "⚠ PM2 not installed"

start: check-deps
    @$(NPM) run daemon:start
```

### Scripts de Health Delegados

**Windows:** `scripts/health-windows.ps1` (PowerShell)
```powershell
param([int]$Port = 2998)
$pm2Output = & pm2 jlist 2>$null | ConvertFrom-Json
Invoke-WebRequest -Uri "http://localhost:$Port/api/health" -UseBasicParsing
```

**Linux/macOS:** `scripts/health-posix.sh` (bash)
```bash
#!/usr/bin/env bash
PORT=${1:-2998}
pm2 jlist 2>/dev/null | grep -q '"status":"online"'
curl -s -f "http://localhost:$PORT/api/health"
```

### Comando Usage

```bash
# Windows (cmd.exe)
make help
make start
make health

# Windows (PowerShell)
mingw32-make help

# Linux/macOS
make help
make start
make health
```

---

**Nota:** Esta documentação deve ser atualizada sempre que houver mudanças na estratégia cross-platform ou novos componentes forem adicionados.

