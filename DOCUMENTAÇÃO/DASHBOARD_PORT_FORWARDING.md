# 🌐 Dashboard Access Guide - Port Forwarding in VS Code DevContainer

## 📋 Problema

**Sintoma:** Navegador Windows mostra `ERR_CONNECTION_REFUSED` ao acessar `http://localhost:5173/dashboard/`

**Causa:** Port forwarding do VS Code não está ativo (apesar do `devcontainer.json` estar configurado corretamente)

---

## ✅ Verificação Rápida (Container)

Dentro do container, execute:

```bash
bash scripts/check-dashboard-access.sh
```

**Resultado Esperado:**
- ✅ Vite rodando
- ✅ Porta 5173 escutando
- ✅ HTTP 200 OK
- ✅ DevContainer configurado

Se todos os checks passarem → **Problema é port forwarding do VS Code**.

---

## 🔧 Solução: Forward Manual da Porta 5173

### **Guia Visual Completo**

Execute no terminal do container:

```bash
bash scripts/guide-port-forwarding.sh
```

Ou siga os passos abaixo:

---

### **Passo 1: Abrir Aba PORTS**

No **VS Code**, painel inferior:

```
┌──────────────────────────────────────────────────────┐
│                                                      │
│  [TERMINAL] [PROBLEMS] [OUTPUT] [DEBUG] [PORTS] ←──  │
│                                           ↑          │
│                                           └─ Clique  │
└──────────────────────────────────────────────────────┘
```

**Se não aparecer a aba PORTS:**
1. Pressione `Ctrl + Shift + P`
2. Digite: `Ports: Focus on Ports View`
3. Enter

---

### **Passo 2: Adicionar Porta 5173**

Na aba **PORTS**:

```
┌─────────────────────────────────────────────────────────┐
│  PORTS                                [+] [⚙]          │
│                                        ↑                │
│                                        └─ Clique aqui   │
└─────────────────────────────────────────────────────────┘
```

1. Clique no botão **[+]** ("Forward a Port")
2. Digite: `5173`
3. Pressione **Enter**

---

### **Passo 3: Verificar Porta Forwarded**

Após adicionar, a aba PORTS deve mostrar:

```
┌─────────────────────────────────────────────────────────┐
│  PORTS                                                  │
│                                                         │
│  Port    Forwarded Address      Local Address          │
│  ────    ──────────────────      ─────────────          │
│  3008    localhost:3008          127.0.0.1:3008        │
│  5173    localhost:5173          127.0.0.1:5173    ← ✅│
│  9224    localhost:9224          127.0.0.1:9224        │
└─────────────────────────────────────────────────────────┘
```

---

### **Passo 4: Testar no Navegador**

Abra seu navegador **Windows** e acesse:

```
http://localhost:5173/dashboard/
```

**Resultado Esperado:**
- ✅ Dashboard aparece (tema escuro)
- ✅ Sidebar com menu (Overview, Tasks, etc.)
- ✅ Console (F12): `[vite] connected.`

---

## 🧪 Teste Automatizado (Windows)

Execute no **PowerShell do Windows** (não dentro do container):

```powershell
cd C:\seu\projeto
.\scripts\test-dashboard-from-windows.ps1
```

Este script testa:
1. ✅ Porta 5173 acessível do Windows
2. ✅ HTTP respondendo
3. ✅ HTML correto carregado

---

## 🌐 Alternativa: VS Code Simple Browser

Se não quiser configurar port forwarding, use o **navegador interno** do VS Code:

### **Método Automático:**

```bash
bash scripts/open-dashboard-browser.sh
```

### **Método Manual:**

1. Pressione `Ctrl + Shift + P`
2. Digite: `Simple Browser: Show`
3. Cole: `http://localhost:5173/dashboard/`
4. Enter

**Vantagem:** Funciona sem port forwarding manual (usa conexão interna do VS Code)

---

## 🚨 Troubleshooting

### ❌ **Porta não aparece na aba PORTS**

**Solução:**
1. Reload VS Code: `Ctrl + Shift + P` → `Reload Window`
2. Reabra o DevContainer: `Ctrl + Shift + P` → `Reopen in Container`

### ❌ **Porta aparece mas navegador erra**

**Possíveis causas:**
- Firewall do Windows bloqueando
- Docker Desktop não está rodando
- VS Code precisa de reload

**Soluções:**
1. Limpar cache do navegador: `Ctrl + Shift + Delete`
2. Testar outro navegador (Firefox, Edge)
3. Verificar console do navegador (F12) para erros
4. Reiniciar Docker Desktop

### ❌ **Simple Browser não funciona**

**Solução:**
- Use port forwarding manual (guia acima)
- Ou acesse via IP do container: `http://172.17.0.2:5173/dashboard/`
  (⚠️ Requer mudar `vite.config.js` de `127.0.0.1` para `0.0.0.0`)

---

## 📖 Por Que Isso Acontece?

### **Arquitetura do DevContainer:**

```
Windows Host
    ↓
VS Code (com DevContainer extension)
    ↓
Container (Vite rodando em 127.0.0.1:5173)
    ↓
Port Forwarding (manual ou automático)
    ↓
Windows Browser → localhost:5173
```

### **O Problema:**

1. **Vite** escuta em `127.0.0.1:5173` **dentro do container**
2. Windows **não consegue** acessar `127.0.0.1` do container (rede isolada)
3. **VS Code** precisa fazer **port forwarding** (túnel) para `localhost:5173` no Windows
4. `devcontainer.json` declara `forwardPorts: [5173]` mas isso **nem sempre é automático**
5. **Forward manual** garante que o túnel seja criado

### **Por Que 127.0.0.1 e Não 0.0.0.0?**

Segundo a [documentação oficial do Vite](https://vite.dev/config/server-options.html#server-host):

> When using VS Code DevContainers, use `host: '127.0.0.1'` instead of `'0.0.0.0'` because VS Code port forwarding does not support IPv6.

---

## 📚 Arquivos Relacionados

- **Config:** `.devcontainer/devcontainer.json` (linhas 303-363)
- **Vite:** `src/dashboard-ui/vite.config.js`
- **Documentação:** `DOCUMENTAÇÃO/VITE_CONFIG_FINAL.md`
- **Scripts:**
  - `scripts/check-dashboard-access.sh` - Diagnóstico completo
  - `scripts/guide-port-forwarding.sh` - Guia visual
  - `scripts/open-dashboard-browser.sh` - Abre Simple Browser
  - `scripts/test-dashboard-from-windows.ps1` - Teste Windows

---

## 🎯 Comandos Úteis

```bash
# Diagnóstico completo (container)
bash scripts/check-dashboard-access.sh

# Guia visual de port forwarding
bash scripts/guide-port-forwarding.sh

# Abrir Simple Browser (alternativa)
bash scripts/open-dashboard-browser.sh

# Verificar Vite status
ps aux | grep vite | grep -v grep

# Testar HTTP interno
curl -I http://127.0.0.1:5173/dashboard/

# Ver logs do Vite
cat /tmp/vite.log
```

```powershell
# Teste Windows (PowerShell)
.\scripts\test-dashboard-from-windows.ps1

# Testar porta manualmente
Test-NetConnection -ComputerName localhost -Port 5173
```

---

## ✅ Checklist de Verificação

- [ ] Vite está rodando (dentro do container)
- [ ] Porta 5173 está escutando em 127.0.0.1
- [ ] HTTP 200 OK internamente
- [ ] `devcontainer.json` tem `5173` em `forwardPorts`
- [ ] VS Code aba PORTS mostra 5173 como **Forwarded**
- [ ] Navegador Windows acessa `http://localhost:5173/dashboard/`
- [ ] Dashboard carrega (tema escuro, sidebar)
- [ ] Console (F12) mostra `[vite] connected.`

---

**Versão:** 1.0
**Última atualização:** Fevereiro 2026
**Autor:** Sistema Autônomo chatgpt-docker-puppeteer
