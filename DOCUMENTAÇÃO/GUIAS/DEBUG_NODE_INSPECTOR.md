# 🐛 Guia de Debug - Node Inspector Port 9229

## 📋 O Problema

Você pode ter visto este erro nos logs do VS Code:

```
Error: connect ECONNREFUSED 127.0.0.1:9229
```

E um loop infinito de tentativas de port forwarding.

---

## 🔍 O Que Significa?

**ECONNREFUSED 127.0.0.1:9229** significa:

- ✅ O VS Code está tentando conectar no **Node Inspector** (porta 9229)
- ❌ Mas **não há processo escutando** nessa porta
- ❌ Ou o processo existe mas **não está com `--inspect` habilitado**

---

## 🔧 Por Que Acontece?

O `launch.json` contém configurações de **attach** (anexar debugger):

```json
{
  "type": "node",
  "request": "attach",
  "port": 9229
}
```

Essas configurações **tentam se conectar** a um processo Node existente.

Mas se o processo **não está rodando com `--inspect`**, a conexão falha.

---

## ✅ Solução 1: Verificar Se Debug Está Ativo

Execute no terminal:

```bash
# Verificar se porta 9229 está escutando
ss -lntp | grep 9229

# Testar Node Inspector
curl http://127.0.0.1:9229/json/list
```

**Se retornar vazio** → Debug NÃO está ativo.

---

## ✅ Solução 2: Iniciar Processos Com Debug

### **Opção A: Script Automático** (Recomendado)

```bash
bash scripts/start-pm2-debug.sh
```

Menu interativo permite:

- Iniciar agente com debug (porta 9229)
- Iniciar dashboard com debug (porta 9230)
- Verificar status

### **Opção B: Manual (PM2)**

```bash
# Agente
npx pm2 start ecosystem.config.cjs --only agente-gpt --node-args="--inspect=0.0.0.0:9229"

# Dashboard
npx pm2 start ecosystem.config.cjs --only dashboard-web --node-args="--inspect=0.0.0.0:9230"
```

### **Opção C: Manual (Node Direto)**

```bash
# Backend
node --inspect=0.0.0.0:9229 src/server/main.js

# Agente
node --inspect=0.0.0.0:9229 index.js
```

---

## ✅ Solução 3: Usar Configurações Corretas no VS Code

### **Para INICIAR com debug:**

Use configurações de **launch** (não attach):

```json
{
  "name": "🚀 Debug Agente",
  "type": "node",
  "request": "launch", // ← LAUNCH (inicia processo)
  "program": "${workspaceFolder}/index.js"
}
```

### **Para ANEXAR a processo existente:**

Use configurações de **attach**:

```json
{
  "name": "📌 Attach to PM2 (9229)",
  "type": "node",
  "request": "attach", // ← ATTACH (conecta a existente)
  "port": 9229
}
```

⚠️ **ATENÇÃO**: Só use **attach** se o processo já estiver rodando com `--inspect`!

---

## 🔍 Como Usar Debug no VS Code

### **1. Iniciar com Debug (Launch)**

1. Abra a aba **Run and Debug** (Ctrl+Shift+D)
2. Selecione **"🚀 Debug Agente (Enhanced)"**
3. Pressione **F5**

→ Inicia o processo **já com debug ativo**

### **2. Anexar a Processo Existente (Attach)**

1. Inicie o processo com `--inspect`:

   ```bash
   bash scripts/start-pm2-debug.sh
   ```

2. No VS Code:
   - Abra **Run and Debug** (Ctrl+Shift+D)
   - Selecione **"📌 Attach to PM2 (9229)"**
   - Pressione **F5**

→ Conecta ao processo **já rodando**

---

## 🚨 Erros Comuns

### ❌ "ECONNREFUSED 127.0.0.1:9229"

**Causa**: Tentando attach sem processo rodando com `--inspect`

**Solução**: Use **launch** ou inicie processo com debug primeiro

### ❌ "Cannot connect to runtime process"

**Causa**: Porta 9229 não está forwarded ou processo morreu

**Solução**:

1. Verifique port forwarding no VS Code (aba PORTS)
2. Verifique se processo ainda está rodando: `pm2 list`

### ❌ Loop infinito de port forwarding

**Causa**: VS Code tentando auto-attach em configurações do `launch.json`

**Solução**: Ignore (não afeta funcionalidade) ou remova configs de attach não usadas

---

## 📚 Documentação Oficial

- [Node.js Debugging Guide](https://nodejs.org/en/docs/guides/debugging-getting-started/)
- [VS Code Node.js Debugging](https://code.visualstudio.com/docs/nodejs/nodejs-debugging)
- [Vite Debugging](https://vitejs.dev/guide/debugging.html)

---

## 🎯 TL;DR (Quick Reference)

**Iniciar com debug:**

```bash
bash scripts/start-pm2-debug.sh
```

**Verificar status:**

```bash
curl http://127.0.0.1:9229/json/list
```

**Anexar debugger no VS Code:**

1. Ctrl+Shift+D
2. Selecione "📌 Attach to PM2 (9229)"
3. F5

**Debug do Vue/Vite:**

1. Certifique que Vite está rodando (porta 5173)
2. Use "🌐 Debug Vue App in Chrome"

---

## ⚙️ Configuração do DevContainer

As portas de debug já estão configuradas no `devcontainer.json`:

```json
"forwardPorts": [3008, 5173, 9224, 9229, 9230],
"portsAttributes": {
  "9229": { "label": "Node.js Debug — Primary" },
  "9230": { "label": "Node.js Debug — Fallback" }
}
```

✅ **Funcionamento garantido** dentro do DevContainer.

---

## 🔧 Troubleshooting Avançado

### Verificar Todos os Processos Node

```bash
ps aux | grep node | grep inspect
```

### Verificar Todas as Portas de Debug

```bash
netstat -tln | grep "922[0-9]"
```

### Logs de Debug do PM2

```bash
pm2 logs --lines 100
```

### Kill Processos de Debug Órfãos

```bash
pkill -f "node.*inspect"
```

---

**Versão**: 1.0 **Última atualização**: Fevereiro 2026 **Autor**: Sistema Autônomo
chatgpt-docker-puppeteer
