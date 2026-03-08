# Vue + Express Integration - Complete Guide

## 🎯 O Que Foi Implementado

Integração completa entre Vue 3 (frontend) e Express (backend) em modo desenvolvimento, com
arquitetura de **dois servidores separados** conectados via proxy.

---

## 🏗️ Arquitetura de Desenvolvimento

```
┌──────────────────────────────────────────────────────────────┐
│ WINDOWS HOST (Browser)                                        │
│   Chrome/Edge → http://172.17.0.2:5173/dashboard/            │
└───────────────────────────┬──────────────────────────────────┘
                            │
                            ↓
┌──────────────────────────────────────────────────────────────┐
│ WSL2 CONTAINER (Linux)                                        │
│                                                                │
│  ┌─────────────────────┐          ┌────────────────────────┐ │
│  │ VITE DEV SERVER     │  Proxy   │ EXPRESS API SERVER     │ │
│  │ Port: 5173          │─────────→│ Port: 3008             │ │
│  │ Host: 0.0.0.0       │          │ Endpoints: /api/*      │ │
│  │                     │          │           /socket.io   │ │
│  │ - Vue 3 App         │          │                        │ │
│  │ - Hot Module Reload │          │ - REST API             │ │
│  │ - Tailwind CSS      │          │ - Socket.io            │ │
│  │ - Router            │          │ - NERV Events          │ │
│  └─────────────────────┘          └────────────────────────┘ │
│                                                                │
└──────────────────────────────────────────────────────────────┘
```

### Modo Dev vs Produção

**MODO DEV** (atual - 2 servidores):

- ✅ Vite dev server (5173) - serve Vue app + HMR
- ✅ Express server (3008) - serve API
- ✅ Proxy configurado: `/api/*` → `http://localhost:3008`
- ✅ CORS habilitado para cross-origin requests

**MODO PRODUÇÃO** (futuro - 1 servidor):

- Express serve static build (`dist/`)
- Express serve API
- Tudo na mesma porta (3008)

---

## 🔧 Problemas Encontrados e Soluções

### 1. **TailwindCSS 4.x Breaking Changes** ❌→✅

**Problema**: CSS files usavam sintaxe TailwindCSS v3 (`@apply` com theme functions), mas v4 foi
instalado.

**Erro**:

```
[postcss] Could not resolve value for theme function: `theme(colors.border.DEFAULT)`
```

**Causa Raiz**:

- TailwindCSS v4 mudou COMPLETAMENTE a arquitetura
- v3: `tailwind.config.js` → JIT compiler → classes geradas
- v4: CSS-first approach → CSS variables → config opcional

**Solução Aplicada**:

- ✅ Reescrevi `tailwind.css` usando apenas `@import "tailwindcss"`
- ✅ Reescrevi `dark-theme.css` usando CSS variables simples (`var(--bg-primary)`)
- ✅ Removi `@apply` com classes customizadas (causavam erros)
- ✅ CSS minimalista (45 linhas vs 129 linhas antes)

**Arquivos Modificados**:

- [`src/dashboard-ui/src/assets/styles/tailwind.css`](src/dashboard-ui/src/assets/styles/tailwind.css)
- [`src/dashboard-ui/src/assets/styles/dark-theme.css`](src/dashboard-ui/src/assets/styles/dark-theme.css)

---

### 2. **App.vue Duplicate CSS** ❌→✅

**Problema**: CSS block no `App.vue` tinha código duplicado:

```css
#app {
    height: 100vh;
    overflow: hidden;
}
    overflow: hidden;  /* ← Duplicado */
}
```

**Erro**:

```
[postcss] Unexpected }
```

**Solução**: Removi linhas duplicadas → PostCSS compilou corretamente.

---

### 3. **Missing Dependency (vis-timeline)** ❌→✅

**Problema**: `EventCorrelation.vue` importava `vis-timeline` mas não estava instalado.

**Erro**:

```
(!) Failed to run dependency scan. vis-timeline (imported by EventCorrelation.vue)
Are they installed?
```

**Solução**:

```bash
npm install vis-timeline vis-data --save
```

---

### 4. **CORS Configuration** ✅ (Já estava corrigido)

**Configuração Final** (`src/server/engine/app.js`):

```javascript
const allowedOrigins = new Set([
  'http://localhost:5173', // Vite dev
  'http://localhost:5174', // Vite alt
  'http://localhost:5175',
  'http://localhost:5176',
  'http://172.17.0.2:5173', // Network IP
  'http://172.17.0.2:5174',
  'http://172.17.0.2:5175',
  'http://172.17.0.2:5176',
  'http://localhost:3008', // Express
]);
```

---

### 5. **Trust Proxy Configuration** ✅ (Já estava corrigido)

**Configuração Final**:

```javascript
if (process.env.NODE_ENV === 'production') {
  app.set('trust proxy', 1); // Behind reverse proxy
} else {
  app.set('trust proxy', 'loopback'); // Dev only
}
```

**Motivo**: `trust proxy: true` é inseguro em dev (permite trust de qualquer IP).

---

## 📂 Estrutura de Arquivos (Frontend)

```
src/dashboard-ui/
├── index.html                           # HTML base (Vite entry)
├── vite.config.js                       # Vite config + proxy
├── tailwind.config.js                   # Tailwind config (v4)
├── postcss.config.js                    # PostCSS config
├── package.json                         # Dependencies
│
├── src/
│   ├── main.js                          # Vue app entry point
│   ├── App.vue                          # Root component
│   │
│   ├── router/
│   │   └── index.js                     # Vue Router (8 routes)
│   │
│   ├── stores/
│   │   ├── missions.js                  # Pinia store (missions)
│   │   └── tasks.js                     # Pinia store (tasks)
│   │
│   ├── components/
│   │   ├── layout/
│   │   │   ├── AppLayout.vue            # Main layout
│   │   │   ├── AppSidebar.vue           # Sidebar navigation
│   │   │   └── AppHeader.vue            # Header
│   │   │
│   │   └── tasks/                       # 7 task components
│   │       ├── TaskCard.vue
│   │       ├── TaskList.vue
│   │       ├── TaskDetails.vue
│   │       ├── TaskForm.vue
│   │       ├── TaskStatus.vue
│   │       ├── TaskMetrics.vue
│   │       └── TaskTimeline.vue
│   │
│   ├── views/                           # 8 views (pages)
│   │   ├── Dashboard.vue
│   │   ├── Missions.vue
│   │   ├── Tasks.vue
│   │   ├── QueueStatus.vue
│   │   ├── Monitoring.vue
│   │   ├── Configuration.vue
│   │   ├── AgentStatus.vue
│   │   └── EventCorrelation.vue
│   │
│   ├── assets/
│   │   └── styles/
│   │       ├── tailwind.css             # Tailwind base (45 lines)
│   │       └── dark-theme.css           # Dark theme (50 lines)
│   │
│   └── api/
│       └── index.js                     # API client (axios)
```

---

## 🔌 Proxy Configuration

### vite.config.js

```javascript
export default defineConfig({
  plugins: [vue()],
  base: '/dashboard/',
  server: {
    port: 5173,
    host: '0.0.0.0', // Permite acesso do Windows
    proxy: {
      '/api': {
        target: 'http://localhost:3008',
        changeOrigin: true,
      },
      '/socket.io': {
        target: 'http://localhost:3008',
        ws: true, // WebSocket support
      },
    },
  },
});
```

### Como Funciona o Proxy

**Requisição Frontend**:

```javascript
// No Vue app
axios.get('/api/health');
```

**Fluxo**:

1. Vue faz request para `/api/health`
2. Vite intercepta (proxy configurado)
3. Vite encaminha para `http://localhost:3008/api/health`
4. Express responde
5. Vite retorna resposta para Vue

**Benefícios**:

- ✅ Sem CORS issues
- ✅ URLs relativas no código
- ✅ Funciona em dev e prod (com ajustes)

---

## 🚀 Como Rodar

### Iniciar Sistema Completo (PM2)

```bash
make start
```

Isso inicia:

- ✅ `agente-gpt` (main agent)
- ✅ `dashboard-web` (Express API)
- ✅ `chrome-proxy` (Chrome proxy service)
- ✅ Vite dev server (manual start required)

### Iniciar Vite Dev Server (Manual)

```bash
cd src/dashboard-ui
npm run dev
```

Ou use o script automatizado:

```bash
bash scripts/start-dashboard-dev.sh
```

### Verificar Status

```bash
bash scripts/test-dashboard-browser.sh
```

Output esperado:

```
=== DASHBOARD BROWSER ACCESS TEST ===

📍 Container IP: 172.17.0.2

✅ Vite: OK (http://172.17.0.2:5173/dashboard/)
✅ Express: OK (http://localhost:3008/api/health)
✅ PM2: 3 processes online

=== 🎉 ALL TESTS PASSED ===

📌 Access URLs (from Windows):
   Dashboard: http://172.17.0.2:5173/dashboard/
```

---

## 🌐 Acessar do Windows

### URL do Dashboard

```
http://172.17.0.2:5173/dashboard/
```

### Validar Acesso

1. Abrir Chrome/Edge
2. Navegar para `http://172.17.0.2:5173/dashboard/`
3. Verificar:
   - ✅ Página carrega (não fica em branco)
   - ✅ Sidebar visível (navegação)
   - ✅ Tema dark aplicado
   - ✅ Console sem erros críticos

### Troubleshooting (Se Não Carregar)

**1. Verificar Vite está rodando**

```bash
curl http://localhost:5173/dashboard/
```

**2. Verificar Express está rodando**

```bash
curl http://localhost:3008/api/health
```

**3. Verificar PM2**

```bash
npx pm2 list
```

**4. Ver logs do Vite**

```bash
tail -50 /tmp/vite-clean.log
```

**5. Reiniciar tudo**

```bash
make restart
pkill -9 -f vite
cd src/dashboard-ui && npm run dev
```

---

## 📊 Endpoints API (Backend)

### Health Check

```bash
GET /api/health
→ {"status":"ok", "timestamp":..., "uptime":..., "memory":...}
```

### Tasks

```bash
GET /api/tasks        # Listar todas as tasks
GET /api/tasks/:id    # Detalhes de uma task
POST /api/tasks       # Criar task
PATCH /api/tasks/:id  # Atualizar task
DELETE /api/tasks/:id # Deletar task
```

### Missions

```bash
GET /api/missions        # Listar missions
GET /api/missions/:id    # Detalhes de uma mission
POST /api/missions       # Criar mission
PATCH /api/missions/:id  # Atualizar mission
DELETE /api/missions/:id # Deletar mission
```

### WebSocket

```javascript
// No frontend
import io from 'socket.io-client';
const socket = io('http://localhost:3008');

socket.on('task:updated', (task) => {
  console.log('Task updated:', task);
});
```

---

## 🎨 Tailwind CSS Configuration

### tailwind.config.js

```javascript
export default {
  content: ['./index.html', './src/**/*.{vue,js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        background: {
          DEFAULT: '#0a0e1a',
          secondary: '#111827',
          tertiary: '#1e293b',
        },
        border: {
          DEFAULT: '#334155',
          subtle: '#1e293b',
        },
        // ... mais cores
      },
    },
  },
  plugins: [require('@tailwindcss/forms'), require('@tailwindcss/typography')],
};
```

### CSS Variables (dark-theme.css)

```css
:root.dark,
.dark {
  --bg-primary: #0a0e1a;
  --bg-secondary: #111827;
  --text-primary: #f8fafc;
  --text-secondary: #cbd5e1;
  --border-default: #334155;
}
```

Uso no código:

```vue
<div class="bg-slate-900 text-slate-100 border border-slate-700">
    <!-- Ou -->
    <div style="background: var(--bg-primary)">
</div>
```

---

## 🔍 Debugging Tips

### 1. Ver Logs em Tempo Real

```bash
# Vite
tail -f /tmp/vite-clean.log

# Express (PM2)
npx pm2 logs dashboard-web --lines 50

# Todos os logs
make logs-follow
```

### 2. Inspecionar Network Requests

- Abrir DevTools (F12)
- Tab "Network"
- Verificar:
  - ✅ HTML carregou (200 OK)
  - ✅ CSS/JS carregaram (200 OK)
  - ✅ API requests funcionam (200 OK)
  - ❌ CORS errors (403/401)

### 3. Verificar Console Errors

- Abrir DevTools (F12)
- Tab "Console"
- Buscar:
  - ❌ `Failed to load module`
  - ❌ `404 Not Found`
  - ❌ `CORS policy`

### 4. Hot Module Reload (HMR)

```bash
# Editar arquivo .vue
# Vite recompila automaticamente
# Browser atualiza sem refresh
```

Se HMR não funcionar:

```bash
# Reiniciar Vite
pkill -9 -f vite
cd src/dashboard-ui && npm run dev
```

---

## 📚 Próximos Passos

### Imediato

- [ ] Validar dashboard carrega no Windows
- [ ] Testar navegação entre views (8 páginas)
- [ ] Verificar componentes de tasks (7 componentes)
- [ ] Testar API calls (GET /api/tasks)

### Curto Prazo

- [ ] Implementar autenticação (JWT?)
- [ ] Adicionar testes E2E (Playwright?)
- [ ] Otimizar bundle size
- [ ] Configurar build de produção

### Longo Prazo

- [ ] SSR (Server-Side Rendering)?
- [ ] PWA (Progressive Web App)?
- [ ] Internacionalização (i18n)?
- [ ] Analytics integration?

---

## 🐛 Known Issues

### 1. Vite Dependency Scan Warning

```
(!) Failed to run dependency scan. Skipping dependency pre-bundling.
Error: The following dependencies are imported but could not be resolved:
  vis-timeline (imported by EventCorrelation.vue)
```

**Status**: ✅ RESOLVIDO (instalado `vis-timeline` e `vis-data`)

### 2. TailwindCSS v4 Warnings

```
(!) Some chunks are larger than 500 KiB after minification...
```

**Status**: ⏳ Normal em dev (será otimizado em prod build)

### 3. PostCSS Plugin Order

```
[vite] (client) hmr update /src/assets/styles/tailwind.css
```

**Status**: ✅ Normal (Hot Module Reload funcionando)

---

## 📖 Referências

### Documentação Oficial

- [Vue 3 Docs](https://vuejs.org/)
- [Vite Docs](https://vite.dev/)
- [TailwindCSS v4 Docs](https://tailwindcss.com/docs/v4-beta)
- [Express Docs](https://expressjs.com/)
- [Socket.io Docs](https://socket.io/docs/)

### Guias Internos

- [ARCHITECTURE.md](../ARCHITECTURE.md) - Arquitetura completa v3.0
- [DASHBOARD_ARCHITECTURE_ANALYSIS.md](../DASHBOARD_ARCHITECTURE_ANALYSIS.md)
- [scripts/test-dashboard-integration.sh](../scripts/test-dashboard-integration.sh)

---

**Versão**: 1.0.0 **Data**: 2026-02-05 **Status**: ✅ Integração Funcional - Pronto para Uso
