# 🎯 Como Acessar o Dashboard

**Data**: 4 de Fevereiro de 2026 **Status**: ✅ Sistema Funcionando

## URLs de Acesso

### 🌐 No Windows (Navegador)

Abra seu navegador e acesse:

```
http://172.17.0.2:5176/dashboard/
```

**Ou tente também:**

```
http://localhost:5176/dashboard/
```

### 📱 Dentro do Container (teste)

```bash
curl http://localhost:5174/dashboard/
```

## ⚙️ Serviços Rodando

### Frontend (Vite Dev Server)

- **Porta**: 5174
- **Status**: 🟢 ONLINE
- **Build time**: 195ms
- **Processo**: nohup npm run dev

### Backend (PM2)

- **Porta API**: 3008
- **Porta Socket.io**: 3008
- **Status**: 🟢 ONLINE
- **Processos**:
  - agente-gpt (fork)
  - dashboard-web (fork)
  - chrome-proxy (cluster)

## 🔍 Verificar Status

### Vite Dev Server

```bash
tail -f /tmp/vite-final.log
```

### Backend API

```bash
curl http://localhost:3008/health
curl http://localhost:3008/api/dashboard/tasks
```

### PM2 Status

```bash
npx pm2 list
npx pm2 logs
```

## 🚨 Troubleshooting

### Dashboard não abre no navegador?

1. **Verifique se está usando a URL correta:**

   ```
   http://172.17.0.2:5174/dashboard/
   ```

   Note o `/dashboard/` no final!

2. **Teste se o servidor está respondendo:**

   ```bash
   curl -I http://172.17.0.2:5174/dashboard/
   ```

3. **Veja logs do Vite:**

   ```bash
   tail -50 /tmp/vite-final.log
   ```

4. **Restart manual:**
   ```bash
   pkill -9 -f "npm run dev"
   cd /workspaces/chatgpt-docker-puppeteer/src/dashboard-ui
   npm run dev
   ```

### API não responde?

1. **Verifique PM2:**

   ```bash
   npx pm2 list
   npx pm2 restart dashboard-web
   ```

2. **Teste API:**
   ```bash
   curl http://localhost:3008/health
   ```

### Socket.io não conecta?

1. **Verifique console do navegador** (F12)
2. **Logs do backend:**
   ```bash
   npx pm2 logs dashboard-web --lines 50
   ```

## ✅ Teste Completo

Rode esse script para verificar tudo:

```bash
#!/bin/bash

echo "=== Testando Dashboard ==="

echo "1. Vite (5174):"
curl -s -o /dev/null -w "%{http_code}" http://localhost:5174/dashboard/ && echo " ✅ OK" || echo " ❌ FAIL"

echo "2. API Health (3008):"
curl -s http://localhost:3008/health | grep -q "alive" && echo " ✅ OK" || echo " ❌ FAIL"

echo "3. API Tasks (3008):"
curl -s http://localhost:3008/api/dashboard/tasks | grep -q "tasks" && echo " ✅ OK" || echo " ❌ FAIL"

echo "4. PM2:"
npx pm2 list | grep -q "online" && echo " ✅ OK" || echo " ❌ FAIL"

echo "=== Teste Completo ==="
```

## 📝 Notas

- O Vite pode mudar de porta automaticamente se 5173 estiver ocupada
- Sempre verifique logs em `/tmp/vite-final.log`
- Se dashboard travar, rode: `pkill -9 -f vite && npm run dev`
- Backend PM2 é persistente, não precisa restart frequente
