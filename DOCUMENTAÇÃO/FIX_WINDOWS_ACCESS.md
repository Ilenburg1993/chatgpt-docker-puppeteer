# 🔧 FIX: Acesso do Windows ao Dashboard

## ❌ PROBLEMA IDENTIFICADO

**Erro**: `ERR_CONNECTION_TIMED_OUT` ao acessar `http://172.17.0.2:5173`

**Causa**: Docker Desktop (WSL2) não roteia tráfego do Windows diretamente para IPs internos do container (172.17.x.x).

---

## ✅ SOLUÇÃO: Use localhost

O Docker Desktop faz **port forwarding automático** de `localhost` do Windows para o container.

### URL CORRETA (Windows)

**❌ NÃO USE** (não funciona):
```
http://172.17.0.2:5173/dashboard/
```

**✅ USE** (funciona):
```
http://localhost:5173/dashboard/
```

Ou também funciona:
```
http://127.0.0.1:5173/dashboard/
```

---

## 🔍 COMO FUNCIONA

```
Windows Browser
    ↓
localhost:5173 (Windows)
    ↓
[Docker Desktop Port Forward]
    ↓
Container (0.0.0.0:5173)
    ↓
Vite Dev Server
```

O Vite já está configurado para escutar em `0.0.0.0:5173` (todas as interfaces), então o port forwarding funciona automaticamente.

---

## 🎯 TESTE AGORA

1. **No Windows**, abra Chrome/Edge
2. Navegue para: `http://localhost:5173/dashboard/`
3. A página deve carregar!

Se ainda não funcionar, envie screenshot mostrando:
- O que aparece na tela
- Console (F12) completo
- Network tab (F12)

---

## 📊 VERIFICAÇÃO (Container Linux)

Para confirmar que Vite está rodando e acessível:

```bash
# 1. Vite está rodando?
ps aux | grep vite

# 2. Porta 5173 está aberta?
ss -tlnp | grep :5173

# 3. Teste local (dentro do container)
curl -I http://localhost:5173/dashboard/
```

Todos devem retornar sucesso ✅

---

## 🐛 TROUBLESHOOTING

### Se localhost:5173 não funcionar

**Verifique no Windows (PowerShell)**:
```powershell
# Testar se porta está acessível
Test-NetConnection -ComputerName localhost -Port 5173
```

**Se retornar "False"**:
→ Docker Desktop não está fazendo port forward

**Solução**:
1. Restart Docker Desktop
2. Ou exponha porta explicitamente no `docker-compose.yml`:
   ```yaml
   ports:
     - "5173:5173"
   ```

### Vite não está rodando

```bash
cd /workspaces/chatgpt-docker-puppeteer/src/dashboard-ui
nohup npm run dev > /tmp/vite-clean.log 2>&1 &
```

### Verificar logs do Vite

```bash
tail -50 /tmp/vite-clean.log
```

---

**Versão**: 1.1
**Data**: 2026-02-04
**Status**: ✅ Networking Fix - Use localhost ao invés de IP
