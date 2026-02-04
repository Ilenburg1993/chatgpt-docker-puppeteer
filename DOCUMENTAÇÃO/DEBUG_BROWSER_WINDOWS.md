# 🔍 DEBUG: O Que Ver no Browser (Windows)

## ✅ CORREÇÕES APLICADAS NO CÓDIGO

### 1. Sidebar Paths Corrigidos
**Antes**: `/dashboard/tasks`, `/dashboard/metrics` (quebrado)
**Depois**: `/tasks`, `/metrics` (correto - match com router)

### 2. Import Desnecessário Removido
**Antes**: Importava `Settings` mas não tinha `Settings.vue`
**Depois**: Removido `Settings` do menu

### 3. HTML com Diagnóstico
**Antes**: `<div id="app"></div>` (vazio, sem feedback)
**Depois**: Loading screen + error handlers (mostra erros visualmente)

---

## 🌐 COMO TESTAR NO BROWSER (Windows)

### Passo 1: Abrir Chrome/Edge
Navegue para:
```
http://172.17.0.2:5173/dashboard/
```

### Passo 2: O QUE VOCÊ DEVE VER

**Cenário A: Vue Carregou ✅**
- Você verá o **Dashboard completo**
- Sidebar à esquerda (Menu: Dashboard, Tasks, Metrics, System Health)
- Header no topo (Search bar, notificações)
- Conteúdo principal (Dashboard view)
- Tema dark (fundo #0a0e1a)

**Cenário B: Vue NÃO Carregou ❌**
- Você verá a mensagem **"Loading Vue App..."**
- Se houver erro, aparecerá caixa vermelha/laranja com mensagem

### Passo 3: Abrir DevTools (F12)

**Console Tab**:
1. Pressione `F12`
2. Vá para aba "Console"
3. Procure por:
   ```
   [DIAGNÓSTICO] HTML carregado, aguardando Vue...
   ```

**Se NÃO ver essa mensagem**:
→ HTML não carregou (problema de rede)

**Se ver a mensagem mas nada mais**:
→ JavaScript não está executando

**Se ver erros vermelhos**:
→ Copie e cole TODOS os erros aqui

### Passo 4: Network Tab

1. Pressione `F12`
2. Vá para aba "Network"
3. Recarregue a página (Ctrl+R)
4. Verifique:
   - ✅ `dashboard/` → Status 200 (HTML)
   - ✅ `dashboard/src/main.js` → Status 200 (JS)
   - ✅ `dashboard/src/App.vue` → Status 200 (Vue)
   - ✅ `dashboard/src/assets/styles/tailwind.css` → Status 200 (CSS)

**Se algum arquivo retornar 404**:
→ Problema no path resolution

**Se algum arquivo ficar "pending" eternamente**:
→ Problema no servidor Vite

---

## 📊 COMANDOS DE DEBUG (Container Linux)

### Verificar Vite Rodando
```bash
ps aux | grep vite
```

Deve mostrar processo `node .../vite`

### Ver Logs do Vite
```bash
tail -50 /tmp/vite-clean.log
```

### Testar URL Diretamente
```bash
curl -I http://localhost:5173/dashboard/
```

Deve retornar `HTTP/1.1 200 OK`

### Testar Conteúdo HTML
```bash
curl -s http://localhost:5173/dashboard/ | grep "Loading Vue App"
```

Deve mostrar a mensagem de loading

### Reiniciar Vite Limpo
```bash
pkill -9 -f vite
cd /workspaces/chatgpt-docker-puppeteer/src/dashboard-ui
rm -rf node_modules/.vite
npm run dev
```

---

## 🐛 PROBLEMAS COMUNS E SOLUÇÕES

### Problema 1: "Loading Vue App..." Fica Para Sempre

**Causa**: JavaScript não está executando
**Debug**:
1. F12 → Console → Procurar erros
2. F12 → Network → Verificar se `main.js` carregou

**Possíveis Causas**:
- ❌ Erro de sintaxe em algum `.vue` file
- ❌ Import quebrado (`import X from 'Y'` onde Y não existe)
- ❌ Componente com erro que trava o render

### Problema 2: Página em Branco (Sem Mensagem)

**Causa**: HTML não carregou
**Debug**:
1. Ctrl+U (View Source) → Ver se HTML está lá
2. F12 → Network → Verificar se request foi feito

**Possíveis Causas**:
- ❌ Vite não está rodando
- ❌ Firewall bloqueando porta 5173
- ❌ IP 172.17.0.2 não é acessível do Windows

### Problema 3: Erro Vermelho na Página

**Causa**: JavaScript executou mas deu erro
**O Que Fazer**: Copie o texto da caixa vermelha e envie aqui

### Problema 4: Console Mostra Erro de Module

**Exemplo**:
```
Failed to resolve module specifier "lucide-vue-next"
```

**Causa**: Dependência não instalada
**Solução**:
```bash
cd /workspaces/chatgpt-docker-puppeteer/src/dashboard-ui
npm install lucide-vue-next
```

### Problema 5: CORS Error no Console

**Exemplo**:
```
Access to XMLHttpRequest at 'http://localhost:3008/api/health'
from origin 'http://172.17.0.2:5173' has been blocked by CORS policy
```

**Causa**: Backend não permite origin
**Status**: ✅ JÁ CORRIGIDO (CORS configurado com IPs 172.17.0.2)

---

## 📸 O QUE ENVIAR DE VOLTA

Para eu diagnosticar corretamente, preciso de:

### 1. Screenshot da Página
- Tire print do que você está vendo no browser

### 2. Console Completo (F12)
- Copie TODO o conteúdo da aba Console
- Cole aqui

### 3. Network Tab (F12)
- Screenshot da lista de requests
- Mostre status codes (200, 404, etc)

### 4. View Source (Ctrl+U)
- Copie as primeiras 30 linhas do HTML

---

## ✅ CHECKLIST DE VALIDAÇÃO

Antes de reportar problema, verifique:

- [ ] URL está correta: `http://172.17.0.2:5173/dashboard/`
- [ ] Porta 5173 está aberta (não bloqueada pelo firewall)
- [ ] Container Linux está rodando
- [ ] Vite está rodando (comando: `ps aux | grep vite`)
- [ ] Express está rodando (comando: `npx pm2 list`)
- [ ] Abriu F12 e verificou Console
- [ ] Abriu F12 e verificou Network
- [ ] Tentou Ctrl+Shift+R (hard reload sem cache)

---

## 🎯 PRÓXIMO PASSO

**AGORA VOCÊ PRECISA**:

1. Abrir Chrome/Edge no Windows
2. Navegar para `http://172.17.0.2:5173/dashboard/`
3. Ver o que aparece
4. Abrir F12 (DevTools)
5. Copiar TODO o conteúdo do Console
6. Enviar aqui

**NÃO ME DIGA**: "Continua igual"
**ME DIGA**:
- O QUE você vê na tela (loading? branco? erro?)
- O QUE o Console mostra (copiar e colar TUDO)
- O QUE o Network mostra (status codes)

Só assim posso identificar o problema REAL no código.

---

**Versão**: 1.0
**Data**: 2026-02-04
**Status**: ✅ Código Corrigido - Aguardando Teste do Browser
