# Migração de Scripts de Inicialização do Chrome

> **Data**: 2026-01-30
> **Versão**: 3.0
> **Status**: Consolidação Completa

---

## 📋 Resumo da Migração

O sistema de inicialização do Chrome foi consolidado para resolver problemas de conectividade Docker↔Windows e eliminar duplicação de scripts.

### Problema Resolvido

**Antes**: Container Docker não conseguia conectar ao Chrome no Windows porque `webSocketDebuggerUrl` retornava `ws://localhost:9224/...` (não acessível do container).

**Solução**: Chrome Proxy Service que reescreve URLs e proxia WebSocket transparentemente.

---

## 🔄 Mudanças Realizadas

### ✅ Scripts Criados (Root)

| Arquivo                       | Propósito                                     | Quando Usar                     |
| ----------------------------- | --------------------------------------------- | ------------------------------- |
| **start-chrome-proxy.bat**    | Launcher consolidado Chrome + Proxy (Windows) | **SEMPRE** antes de `npm start` |
| **verify-chrome-setup.bat**   | Diagnóstico de configuração (Windows)         | Troubleshooting, setup inicial  |
| **CHROME_LAUNCHER_README.md** | Documentação completa dos launchers           | Referência de uso               |

### 🗑️ Scripts Removidos/Depreciados

| Arquivo                                 | Status                    | Motivo                                  |
| --------------------------------------- | ------------------------- | --------------------------------------- |
| **scripts/start-chrome.bat**            | ⚠️ DEPRECADO (.deprecated) | Não inicia proxy, substituído           |
| **scripts/start-chrome-with-proxy.bat** | ❌ DELETADO                | Duplicado, substituído pela versão root |

### 📝 Scripts Atualizados

| Arquivo          | Mudança                                      | Linha/Seção    |
| ---------------- | -------------------------------------------- | -------------- |
| **config.json**  | Referência de script atualizada              | Linha 35       |
| **LAUNCHER.bat** | Opção [11] "Start Chrome + Proxy" (pendente) | Menu principal |

---

## 🚀 Novo Fluxo de Trabalho

### Windows (Recomendado)

```batch
# 1. Verificar configuração
verify-chrome-setup.bat

# 2. Iniciar Chrome + Proxy
start-chrome-proxy.bat

# 3. Testar do container
curl http://192.168.0.2:9224/json/version

# 4. Iniciar sistema
npm start
```

### Linux/Container

```bash
# Chrome roda no Windows, container apenas conecta
curl http://192.168.0.2:9224/json/version

# Iniciar sistema
npm start
```

---

## 📂 Estrutura de Scripts Atualizada

```
/
├── start-chrome-proxy.bat          ← NOVO: Launcher principal (Windows)
├── verify-chrome-setup.bat         ← NOVO: Diagnóstico
├── CHROME_LAUNCHER_README.md       ← NOVO: Documentação
├── LAUNCHER.bat                    ← Atualizado: Menu + opção Chrome
│
scripts/
├── chrome-proxy-service.js         ← MANTIDO: Proxy Node.js
├── start-chrome.bat.deprecated     ← DEPRECADO: Apenas Chrome (sem proxy)
├── start-chrome.sh                 ← MANTIDO: Linux (referência)
├── quick-ops.bat                   ← MANTIDO: Operações CLI rápidas
├── watch-logs.bat                  ← MANTIDO: Monitor de logs
└── (outros scripts não relacionados)
```

---

## 🔍 Tabela de Migração

Se você estava usando um desses scripts, migre conforme a tabela:

| Script Antigo                         | Script Novo              | Observações                      |
| ------------------------------------- | ------------------------ | -------------------------------- |
| `scripts\start-chrome.bat`            | `start-chrome-proxy.bat` | Novo script na pasta root        |
| `scripts\start-chrome-with-proxy.bat` | `start-chrome-proxy.bat` | Mesmo script, movido e melhorado |
| Execução manual de Chrome             | `start-chrome-proxy.bat` | Agora com validações automáticas |

---

## ⚙️ Configurações Atualizadas

### config.json

**Antes**:
```json
{
  "BROWSER_MODE": "remote",
  "DEBUG_PORT": "http://host.docker.internal:9224",
  "// Scripts:": "",
  "//   • Windows: scripts/start-chrome-with-proxy.bat": ""
}
```

**Depois**:
```json
{
  "BROWSER_MODE": "wsEndpoint",
  "DEBUG_PORT": "http://192.168.0.2:9224",
  "CHROME_PROXY_ENABLED": true,
  "CHROME_PROXY_PORT": 9224,
  "// Scripts:": "",
  "//   • Windows: start-chrome-proxy.bat (launcher automatizado na pasta root)": ""
}
```

### ConnectionOrchestrator.js

**Antes**:
```javascript
const DEFAULTS = {
    mode: 'launcher',
    ports: [9224, 9223, 9224],
    hosts: ['127.0.0.1', 'localhost', 'host.docker.internal', '172.17.0.1']
};
```

**Depois**:
```javascript
const DEFAULTS = {
  mode: 'wsEndpoint',  // ← Mudança
  ports: [9224, 9223, 9224],  // ← Proxy primeiro, fallback por ordem
  hosts: ['192.168.0.2', 'host.docker.internal', '172.17.0.1', '127.0.0.1']  // ← IP público primeiro
};
```

---

## 🐛 Troubleshooting de Migração

### Problema 1: "start-chrome.bat não funciona mais"

**Sintoma**: `start-chrome.bat` mostra mensagem de deprecação

**Solução**:
```batch
cd C:\caminho\para\chatgpt-docker-puppeteer
start-chrome-proxy.bat
```

---

### Problema 2: "LAUNCHER.bat não encontra Chrome + Proxy"

**Sintoma**: Opção [11] do menu falha

**Causa**: `start-chrome-proxy.bat` não está na pasta root

**Solução**:
```batch
# Verificar se arquivo existe
dir start-chrome-proxy.bat

# Se não existir, recriar (consulte documentação)
```

---

### Problema 3: "Scripts antigos em automação/CI"

**Sintoma**: CI/CD falha com "script not found"

**Solução**:
Atualize seus scripts de CI/CD para usar o novo caminho:

**Antes**:
```yaml
- name: Start Chrome
  run: scripts\start-chrome-with-proxy.bat
```

**Depois**:
```yaml
- name: Start Chrome + Proxy
  run: start-chrome-proxy.bat
```

---

## 📊 Benefícios da Consolidação

### Antes (Fragmentado)

- ❌ 3 scripts BAT diferentes (start-chrome, start-chrome-with-proxy, outro legado)
- ❌ Duplicação de lógica
- ❌ Sem validação de configuração
- ❌ Health checks limitados
- ❌ Documentação espalhada

### Depois (Consolidado)

- ✅ 1 script principal (`start-chrome-proxy.bat`)
- ✅ 1 script de diagnóstico (`verify-chrome-setup.bat`)
- ✅ Validação completa de `config.json`
- ✅ Health checks robustos (Chrome + Proxy + URL rewriting)
- ✅ Documentação centralizada (`CHROME_LAUNCHER_README.md`)
- ✅ Troubleshooting integrado
- ✅ Auto-detecção de IP público

---

## 📚 Documentação Relacionada

- **CHROME_LAUNCHER_README.md** - Guia completo de uso dos launchers
- **DOCUMENTAÇÃO/CHROME_PROXY_SETUP.md** - Arquitetura do Chrome Proxy
- **DOCUMENTAÇÃO/CHROME_PROXY_INTEGRATION_GUIDE.md** - Guia de integração
- **DOCUMENTAÇÃO/diagrams/chrome-proxy-architecture.txt** - Diagrama ASCII

---

## ✅ Checklist de Migração

Para garantir que sua instalação está atualizada:

- [ ] `start-chrome-proxy.bat` existe na pasta root
- [ ] `verify-chrome-setup.bat` existe na pasta root
- [ ] `CHROME_LAUNCHER_README.md` existe na pasta root
- [ ] `scripts/chrome-proxy-service.js` existe
- [ ] `scripts/start-chrome.bat` foi renomeado para `.deprecated`
- [ ] `scripts/start-chrome-with-proxy.bat` foi deletado
- [ ] `config.json` referencia `start-chrome-proxy.bat` (linha 35)
- [ ] `config.json` tem `BROWSER_MODE: "wsEndpoint"`
- [ ] `config.json` tem `CHROME_PROXY_ENABLED: true`
- [ ] `config.json` tem `CHROME_PROXY_PORT: 9224`

---

## 🔄 Rollback (Se Necessário)

Se precisar reverter para o sistema antigo (não recomendado):

```batch
# 1. Restaurar scripts antigos
git checkout HEAD~1 -- scripts/start-chrome.bat
git checkout HEAD~1 -- scripts/start-chrome-with-proxy.bat

# 2. Reverter config.json
git checkout HEAD~1 -- config.json

# 3. Usar script antigo
scripts\start-chrome-with-proxy.bat
```

**Nota**: Rollback não é recomendado pois os scripts novos resolvem problemas críticos de conectividade.

---

## 📞 Suporte

Se encontrar problemas após a migração:

1. Execute `verify-chrome-setup.bat` para diagnóstico
2. Consulte `CHROME_LAUNCHER_README.md` seção "Troubleshooting"
3. Verifique logs em `logs/launcher.log`
4. Revise `DOCUMENTAÇÃO/CHROME_PROXY_SETUP.md`

---

**Última Atualização**: 2026-01-30
**Responsável**: Consolidação via Claude Code
**Versão**: 3.0 (Production-Ready)
