# ✅ Configurações Completas: Vite em DevContainer

## 📋 ANÁLISE COMPLETA REALIZADA

Baseado em melhores práticas de Vite + DevContainer + Docker + Windows, identifiquei e corrigi
**TODAS** as configurações necessárias.

---

## 🔧 MUDANÇAS APLICADAS

### 1. ✅ DevContainer Port Forwarding

**Arquivo**: `.devcontainer/devcontainer.json`

**Adicionado**:

```json
"forwardPorts": [
  3008,
  5173, // ← NOVO: Vite Dev Server
  9224,
  9229,
  9230
],

"portsAttributes": {
  "5173": {
    "label": "Vite Dev Server — Vue Dashboard (dev only)",
    "onAutoForward": "notify",  // Avisa usuário quando porta exposta
    "protocol": "http"
  }
}
```

**Por que é necessário**:

- VS Code só expõe portas declaradas em `forwardPorts`
- Sem isso, Windows não consegue acessar `localhost:5173`

---

### 2. ✅ Vite HMR (Hot Module Reload)

**Arquivo**: `src/dashboard-ui/vite.config.js`

**Adicionado**:

```javascript
server: {
  hmr: {
    clientPort: 5173,    // Porta para WebSocket HMR
    host: 'localhost'    // Host para acesso do Windows
  }
}
```

**Por que é necessário**:

- HMR usa WebSocket que precisa de configuração especial em containers
- Sem isso: mudanças no código NÃO atualizam automaticamente no browser
- **Crítico**: `host: 'localhost'` garante que Windows consegue conectar ao WebSocket

---

### 3. ✅ Vite Watch Polling

**Arquivo**: `src/dashboard-ui/vite.config.js`

**Adicionado**:

```javascript
server: {
  watch: {
    usePolling: true,  // Polling em vez de inotify
    interval: 100      // Intervalo em ms
  }
}
```

**Por que é necessário**:

- Docker volumes (bind mounts) podem não propagar eventos de file system corretamente
- File watchers nativos (inotify) podem falhar
- Polling garante que Vite detecta mudanças nos arquivos
- **Tradeoff**: Usa mais CPU, mas garante funcionamento

---

### 4. ✅ Vite Server Configuration (Já Estava Correto)

```javascript
server: {
  port: 5173,
  host: '0.0.0.0',    // ✅ Escuta em todas as interfaces
  strictPort: false,   // ✅ Permite fallback se porta ocupada
}
```

**Status**: Já estava correto ✅

---

### 5. ✅ Proxy Configuration (Já Estava Correto)

```javascript
proxy: {
  '/api': {
    target: 'http://localhost:3008',
    changeOrigin: true,  // ✅ Reescreve header Host
    secure: false        // ✅ Aceita HTTPS self-signed
  }
}
```

**Status**: Já estava correto ✅

---

## 📊 CHECKLIST COMPLETO

### DevContainer Configuration

- [x] **forwardPorts**: 5173 adicionado
- [x] **portsAttributes**: Configurado com label e notify
- [x] **runArgs**: `--add-host=host.docker.internal` já presente
- [x] **postStartCommand**: `make info` já presente
- [x] **Network mode**: Default (bridge) - correto

### Vite Configuration

- [x] **server.host**: `0.0.0.0` (todas as interfaces)
- [x] **server.port**: `5173` (porta padrão)
- [x] **server.hmr.clientPort**: `5173` (WebSocket)
- [x] **server.hmr.host**: `localhost` (acesso Windows)
- [x] **server.watch.usePolling**: `true` (Docker volumes)
- [x] **server.watch.interval**: `100` (polling interval)
- [x] **proxy**: Configurado para `/api` e `/socket.io`

### Network & Firewall

- [ ] **Windows Firewall**: Usuário precisa permitir conexões (se solicitado)
- [ ] **Docker Desktop**: Deve estar rodando
- [ ] **WSL2**: Deve estar configurado corretamente
- [ ] **VS Code**: Restart necessário (ou port forward manual)

---

## 🎯 PRÓXIMOS PASSOS

### Opção A: Port Forward Manual (Rápido)

1. **VS Code** → Aba "PORTS" (inferior)
2. Clique **"+"** (Forward a Port)
3. Digite: `5173`
4. Enter
5. Acesse: `http://localhost:5173/dashboard/`

### Opção B: Recarregar VS Code (Permanente)

1. **Ctrl+Shift+P**
2. Digite: `Developer: Reload Window`
3. Aguarde container reiniciar (~30s)
4. Vite inicia automaticamente (porta já exposta)
5. Acesse: `http://localhost:5173/dashboard/`

---

## 🔍 VERIFICAÇÕES FINAIS

Após expor a porta (método A ou B acima):

### 1. Verificar Porta Exposta no VS Code

```
VS Code → Aba PORTS → Deve mostrar:
┌─────────┬─────────────────────────────┬────────────┐
│ Port    │ Label                       │ Status     │
├─────────┼─────────────────────────────┼────────────┤
│ 5173    │ Vite Dev Server             │ Forwarded  │
└─────────┴─────────────────────────────┴────────────┘
```

### 2. Testar Acesso do Windows

```
Browser → http://localhost:5173/dashboard/
```

### 3. Testar HMR (Hot Reload)

```
1. Edite qualquer arquivo .vue
2. Salve (Ctrl+S)
3. Browser deve atualizar automaticamente (sem F5)
```

### 4. Verificar Console (F12)

```
Console → Deve mostrar:
[vite] connected.
[vite] hot updated.
```

---

## 🐛 TROUBLESHOOTING

### Problema: Porta 5173 não aparece na aba PORTS

**Causa**: DevContainer não aplicou mudanças **Solução**: Recarregue VS Code (Opção B acima)

### Problema: ERR_CONNECTION_REFUSED

**Causa**: Vite não está rodando **Solução**:

```bash
cd /workspaces/chatgpt-docker-puppeteer/src/dashboard-ui
npm run dev
```

### Problema: HMR não funciona (mudanças não aparecem)

**Causa**: WebSocket HMR não conectou **Verificação**: F12 → Console → Procure erro de WebSocket
**Solução**: Verifique se `hmr.host` está como `localhost` no vite.config.js

### Problema: Vite não detecta mudanças nos arquivos

**Causa**: File watchers não funcionam em Docker volumes **Verificação**: Edite arquivo, veja se
Vite recompila **Solução**: Verifique se `watch.usePolling: true` está no vite.config.js

---

## 📚 REFERÊNCIAS

### Documentação Oficial

- [Vite Server Options](https://vitejs.dev/config/server-options.html)
- [Vite HMR Configuration](https://vitejs.dev/guide/api-hmr.html)
- [VS Code DevContainer Port Forwarding](https://code.visualstudio.com/docs/remote/containers#_forwarding-or-publishing-a-port)
- [Docker Networking](https://docs.docker.com/network/)

### Práticas Recomendadas

- **HMR em containers**: Sempre configurar `hmr.clientPort` e `hmr.host`
- **Watch em Docker**: Sempre usar `usePolling: true` para volumes
- **Port forwarding**: Sempre declarar em `forwardPorts` (não usar auto-detect)
- **DevContainer lifecycle**: `postStartCommand` para verificação, não para iniciar serviços

---

## ✅ RESUMO FINAL

| Configuração              | Status        | Arquivo           | Impacto                                          |
| ------------------------- | ------------- | ----------------- | ------------------------------------------------ |
| Port 5173 em forwardPorts | ✅ Adicionado | devcontainer.json | **Crítico** - Sem isso Windows não acessa        |
| portsAttributes para 5173 | ✅ Adicionado | devcontainer.json | Importante - Notifica usuário                    |
| server.hmr.clientPort     | ✅ Adicionado | vite.config.js    | **Crítico** - HMR não funciona sem isso          |
| server.hmr.host           | ✅ Adicionado | vite.config.js    | **Crítico** - WebSocket não conecta sem isso     |
| server.watch.usePolling   | ✅ Adicionado | vite.config.js    | **Crítico** - Vite não detecta mudanças sem isso |
| server.watch.interval     | ✅ Adicionado | vite.config.js    | Otimização - Intervalo de polling                |
| server.host = 0.0.0.0     | ✅ Já estava  | vite.config.js    | Necessário - Escuta todas interfaces             |
| proxy para /api           | ✅ Já estava  | vite.config.js    | Necessário - Backend integration                 |

---

**TODAS as configurações necessárias foram aplicadas! ✅**

Agora só falta expor a porta 5173 no VS Code (manual ou reload).

---

**Versão**: 2.0 **Data**: 2026-02-04 **Status**: ✅ Configuração Completa - Pronto para Uso
