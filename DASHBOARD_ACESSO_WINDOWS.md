# DASHBOARD - Guia de Acesso do Windows

## ⚠️ PROBLEMA COMUM: Página em Branco (Loading Infinito)

**CAUSA #1 (90% dos casos)**: Browser cache antigo  
**CAUSA #2 (8% dos casos)**: Vite não reiniciou corretamente  
**CAUSA #3 (2% dos casos)**: JavaScript erro silencioso

---

## ✅ SOLUÇÃO COMPLETA (Passo a Passo)

### PARTE 1: Reiniciar Sistema (no Container)

```bash
# No terminal WSL/Container
bash /workspaces/chatgpt-docker-puppeteer/scripts/dashboard-full-reset.sh
```

**O que o script faz:**
- ✅ Mata todos os processos Vite/Node
- ✅ Limpa TODOS os caches (`node_modules/.vite`, `dist`, etc.)
- ✅ Reinicia Vite limpo
- ✅ Mostra URLs de acesso

**Output esperado:**
```
✅ Vite started successfully!

📌 Access URLs:
   Network: http://172.17.0.2:5173/dashboard/
```

---

### PARTE 2: Limpar Browser Cache (no Windows)

**CRÍTICO**: Sem isso o problema continua!

#### Chrome/Edge:
1. Abrir Chrome/Edge
2. Pressionar `Ctrl + Shift + Del`
3. Selecionar:
   - ☑ Imagens e arquivos em cache
   - ☑ Cookies e dados do site (opcional)
4. Período: **Última hora** (suficiente)
5. Clicar **Limpar dados**
6. **Fechar e reabrir** o browser

#### Alternativa: Modo Incógnito
```
Ctrl + Shift + N (Chrome)
Ctrl + Shift + P (Edge)
```

---

### PARTE 3: Acessar Dashboard

1. **Copiar URL** (do output do script):
   ```
   http://172.17.0.2:5173/dashboard/
   ```

2. **Colar no browser** (Chrome/Edge)

3. **Hard Refresh**:
   ```
   Ctrl + F5  (ou Ctrl + Shift + R)
   ```

4. **Aguardar 5-10 segundos**
   - Vite compila na primeira vez
   - HMR (Hot Module Reload) conecta
   - Vue monta a aplicação

---

## 🐛 SE AINDA ESTIVER EM BRANCO

### Diagnóstico 1: Console Errors

1. Abrir DevTools: `F12`
2. Tab **Console**
3. Procurar erros em **VERMELHO**

**Erros comuns:**

| Erro | Causa | Solução |
|------|-------|---------|
| `Failed to fetch` | Vite não está rodando | `bash dashboard-full-reset.sh` |
| `404 Not Found` | URL errada | Usar `http://172.17.0.2:5173/dashboard/` |
| `CORS error` | Backend não iniciado | `npx pm2 restart all` |
| `SyntaxError` | JavaScript com erro | Ver logs do Vite |

### Diagnóstico 2: Network Tab

1. Abrir DevTools: `F12`
2. Tab **Network**
3. Recarregar: `Ctrl + F5`
4. Verificar se arquivos carregam:

**Esperado (200 OK)**:
```
dashboard/          200  HTML
@vite/client        200  JS
src/main.js         200  JS
src/App.vue         200  JS
```

**Problema (404 ou FAIL)**:
```
dashboard/          404  ❌ URL errada
@vite/client        FAIL ❌ Vite parado
```

### Diagnóstico 3: Logs do Vite

```bash
# No container
tail -50 /tmp/vite-clean.log
```

**Procurar por:**
- ❌ `error`
- ❌ `ERROR`
- ❌ `Pre-transform error`
- ❌ `Failed to`

---

## 📊 Checklist de Validação

Antes de reportar problema, verificar:

- [ ] Script `dashboard-full-reset.sh` executou sem erros
- [ ] Vite mostra: `ready in XXX ms`
- [ ] Curl funciona: `curl http://localhost:5173/dashboard/`
- [ ] Browser cache foi limpo (Ctrl+Shift+Del)
- [ ] Hard refresh feito (Ctrl+F5)
- [ ] DevTools aberto (F12) e sem erros no Console
- [ ] Network tab mostra arquivos carregando (200 OK)
- [ ] Modo incógnito testado (Ctrl+Shift+N)
- [ ] Outro browser testado (Chrome vs Edge)
- [ ] IP correto usado: `172.17.0.2` (não `localhost`)

---

## 🔍 Debugging Avançado

### 1. Test HTML Standalone

Abrir este arquivo **localmente** no Windows:

**Caminho**: `\\wsl$\Ubuntu\tmp\test-dashboard-complete.html`

Ou criar manualmente:
```html
<!DOCTYPE html>
<html>
<head><title>Test</title></head>
<body>
    <h1>Dashboard Test</h1>
    <div id="results"></div>
    <script>
        fetch('http://172.17.0.2:5173/dashboard/')
            .then(r => r.text())
            .then(html => {
                document.getElementById('results').innerHTML = 
                    html ? '✅ PASS' : '❌ FAIL';
            })
            .catch(e => {
                document.getElementById('results').innerHTML = 
                    '❌ ERROR: ' + e.message;
            });
    </script>
</body>
</html>
```

### 2. Test Curl (Windows PowerShell)

```powershell
# Test HTML
Invoke-WebRequest -Uri "http://172.17.0.2:5173/dashboard/" | Select-Object StatusCode

# Test API
Invoke-RestMethod -Uri "http://localhost:3008/api/health"
```

### 3. Test PM2 Status

```bash
npx pm2 list
```

**Esperado:**
```
┌─────┬──────────────┬─────────┬─────────┐
│ id  │ name         │ status  │ cpu     │
├─────┼──────────────┼─────────┼─────────┤
│ 0   │ agente-gpt   │ online  │ 0%      │
│ 1   │ dashboard-web│ online  │ 0%      │
│ 2   │ chrome-proxy │ online  │ 0%      │
└─────┴──────────────┴─────────┴─────────┘
```

---

## 🚨 ÚLTIMA TENTATIVA (Reset Total)

Se **NADA** funcionar:

```bash
# 1. Parar TUDO
npx pm2 kill
pkill -9 -f vite
pkill -9 -f node

# 2. Limpar node_modules
cd /workspaces/chatgpt-docker-puppeteer/src/dashboard-ui
rm -rf node_modules
rm -rf package-lock.json

# 3. Reinstalar
npm install

# 4. Reiniciar sistema
cd /workspaces/chatgpt-docker-puppeteer
make restart
bash scripts/dashboard-full-reset.sh

# 5. Tentar novamente no browser (cache limpo!)
```

---

## 📞 Informações para Suporte

Se reportar problema, incluir:

1. **Output do script**:
   ```bash
   bash /workspaces/chatgpt-docker-puppeteer/scripts/dashboard-full-reset.sh
   ```

2. **Logs do Vite**:
   ```bash
   tail -50 /tmp/vite-clean.log
   ```

3. **Screenshot do DevTools** (F12 → Console + Network)

4. **Versões**:
   ```bash
   node --version
   npm --version
   cat package.json | grep '"version"'
   ```

5. **PM2 Status**:
   ```bash
   npx pm2 list
   npx pm2 logs dashboard-web --lines 20
   ```

---

**Versão**: 2.0.0  
**Data**: 2026-02-05  
**Status**: ✅ Após Pesquisa na Internet + TailwindCSS v4 Fix
