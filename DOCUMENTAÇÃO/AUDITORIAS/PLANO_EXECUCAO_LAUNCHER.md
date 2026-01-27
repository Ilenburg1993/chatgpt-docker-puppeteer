# Plano de Execução: Super Launcher Ecosystem

**Status**: 🚀 PRONTO PARA INICIAR
**Estratégia**: PM2-First (Opção A maximizada)
**Data**: 21 de Janeiro de 2026
**Tempo Total**: 5 horas (8 fases)

---

## Visão Geral

Transformar `INICIAR_TUDO.BAT` rudimentar em **Super Launcher NASA-Grade** usando PM2 + ferramentas standalone (sem precisar programar Tauri).

**Resultado Final**: Sistema 100% operacional com GUI nativa (pm2-gui) + Dashboard HTML agregado + Scripts CLI robustos.

---

## 📋 Fases de Implementação

### ✅ **FASE 1: Super Launcher .BAT v2.0** (1.5h)
**Objetivo**: Menu interativo com 10 operações completas

**Funcionalidades**:
- Menu com 10 opções (start/stop/restart/status/logs/gui/monit/clean/diagnose/backup)
- Validações pré-boot (Node.js, PM2, Chrome)
- Health checks HTTP + PM2 JSON parsing
- Crash detector (logs/crash_reports/)
- Backup automático (config/controle/fila)
- Limpeza inteligente (locks, processos)
- Auto-detect Chrome path

**Arquivos**:
- `INICIAR_TUDO.BAT` (substituir existente)

**LOC**: ~350 linhas

---

### ✅ **FASE 2: Scripts Utilitários** (1h)
**Objetivo**: CLIs standalone para operações rápidas

**Scripts**:
1. `scripts/quick-ops.bat` - Operações via linha de comando
   - `quick-ops status` → PM2 status
   - `quick-ops restart` → Restart sem menu
   - `quick-ops logs` → Tail logs
   - `quick-ops health` → Health checks

2. `scripts/watch-logs.bat` - Logs agregados tempo real (PowerShell)

3. `scripts/install-pm2-gui.bat` - Helper instalação pm2-gui

4. `scripts/setup-pm2-plus.bat` - Instruções PM2 Plus

**LOC**: ~200 linhas total

---

### ✅ **FASE 3: Health Check Endpoints** (0.5h)
**Objetivo**: APIs para validação automática de componentes

**Arquivo**: `src/server/api/health.js`

**Endpoints**:
```javascript
GET /health              // Agregador (todos subsistemas)
GET /health/chrome       // Valida porta 9222
GET /health/pm2          // Status processos PM2
GET /health/kernel       // Estado Kernel via NERV
GET /health/disk         // Espaço logs/disk
```

**Integração**: Router em `src/server/main.js`

**LOC**: ~120 linhas

---

### ✅ **FASE 4: Exportador Chrome Config** (0.5h)
**Objetivo**: ConnectionOrchestrator exporta configuração para consumo externo

**Modificação**: `src/infra/ConnectionOrchestrator.js`

**Método novo**:
```javascript
static exportConfig(outputPath = './chrome-config.json') {
    // Exporta DEFAULTS + env detection
    // Formato: { mode, ports, hosts, args, executablePath, userDataDir, ... }
}
```

**Uso**:
- Launcher .BAT lê `chrome-config.json` para iniciar Chrome
- Scripts utilitários consultam configuração
- Dashboard HTML valida conectividade

**Arquivo gerado**: `chrome-config.json` (raiz do projeto)

**LOC**: ~40 linhas

---

### ✅ **FASE 5: Dashboard Agregado HTML** (1h)
**Objetivo**: Interface standalone que agrega status de todos componentes

**Arquivo**: `scripts/launcher-dashboard.html`

**Funcionalidades**:
- Standalone (não depende de Node.js rodando)
- Fetch status via APIs (`/health`, `/health/chrome`, `/health/pm2`)
- Auto-refresh 5s
- Cards visuais: Chrome/PM2/Server/Kernel/Dashboard
- Botões de ação (integração futura com API control)
- iframe com dashboard web (quando existir)
- Dark theme (VS Code style)

**Stack**: HTML5 + CSS Grid + Fetch API

**LOC**: ~250 linhas

---

### ✅ **FASE 6: Documentação LAUNCHER.md** (0.5h)
**Objetivo**: Guia completo do super launcher

**Arquivo**: `DOCUMENTAÇÃO/LAUNCHER.md`

**Seções**:
1. Arquitetura do Super Launcher
2. Guia de Uso (menu interativo)
3. Scripts Utilitários (quick reference)
4. Troubleshooting comum
5. Comparação: .BAT vs pm2-gui vs Tauri
6. FAQ
7. Diagrama de boot sequence
8. Integração com ConnectionOrchestrator

**LOC**: ~400 linhas MD

---

### ✅ **FASE 7: Atualizar ROADMAP_LAUNCHER_DASHBOARD.md** (0.5h)
**Objetivo**: Refletir estratégia PM2-First no roadmap oficial

**Modificações**:
- Substituir "FASE 1: Tauri" por "FASE 1: Super Launcher .BAT"
- Mover Tauri para FASE 3 (opcional/congelado)
- Atualizar cronograma (5h Fase 1 vs 10h Tauri)
- Adicionar referências a pm2-gui
- Documentar stack PM2-First

**Arquivo**: `DOCUMENTAÇÃO/ROADMAP_LAUNCHER_DASHBOARD.md`

---

### ✅ **FASE 8: Testes Integrados** (1h)
**Objetivo**: Validar todos os flows end-to-end

**Cenários de Teste**:
1. Boot completo (Chrome → PM2 → Health checks)
2. Crash recovery (simular crash, validar detecção)
3. Health checks (todos endpoints respondendo)
4. Menu interativo (testar todas 10 opções)
5. Scripts utilitários (quick-ops em todos os modos)
6. Dashboard agregado HTML (fetch APIs)
7. pm2-gui integration (se instalado)
8. Validação cross-platform (Windows/Linux se possível)

**Critérios de Sucesso**:
- ✅ 100% das opções do menu funcionam
- ✅ Health checks retornam 200/503 corretamente
- ✅ Dashboard HTML renderiza todos cards
- ✅ Logs agregados aparecem em tempo real
- ✅ Backup/restore funciona
- ✅ Crash detector identifica relatórios

---

## 📊 Resumo de Entregáveis

| Fase | Componente | LOC | Tempo | Arquivos |
|------|------------|-----|-------|----------|
| 1 | Super Launcher .BAT | ~350 | 1.5h | INICIAR_TUDO.BAT |
| 2 | Scripts Utilitários | ~200 | 1h | scripts/*.bat (4 arquivos) |
| 3 | Health Endpoints | ~120 | 0.5h | src/server/api/health.js |
| 4 | Chrome Config Export | ~40 | 0.5h | ConnectionOrchestrator.js |
| 5 | Dashboard HTML | ~250 | 1h | scripts/launcher-dashboard.html |
| 6 | Documentação | ~400 | 0.5h | DOCUMENTAÇÃO/LAUNCHER.md |
| 7 | Roadmap Update | N/A | 0.5h | ROADMAP_LAUNCHER_DASHBOARD.md |
| 8 | Testes | N/A | 1h | Validação manual |
| **TOTAL** | **8 fases** | **~1360** | **5h** | **10 arquivos** |

---

## 🎯 Dependências e Ordem de Execução

```
FASE 1 (Launcher) ─────┐
                       ├─→ FASE 8 (Testes)
FASE 2 (Scripts) ──────┤
                       │
FASE 3 (Health API) ───┼─→ FASE 5 (Dashboard HTML) ─→ FASE 8
                       │
FASE 4 (Chrome Config) ┘

FASE 6 (Docs) ─────────────────────────────────────→ Independente
FASE 7 (Roadmap) ──────────────────────────────────→ Independente
```

**Ordem Recomendada**:
1. FASE 4 (Chrome Config) - Base para tudo
2. FASE 3 (Health API) - Necessário para validações
3. FASE 1 (Launcher) - Core do sistema
4. FASE 2 (Scripts) - Complementares ao launcher
5. FASE 5 (Dashboard HTML) - Usa health API
6. FASE 6 (Docs) - Documenta tudo acima
7. FASE 7 (Roadmap) - Atualização de planejamento
8. FASE 8 (Testes) - Validação final

---

## 🚀 Próximos Passos

**Agora**: Iniciar **FASE 4** (Chrome Config Export) - é a base para tudo
- Modificar ConnectionOrchestrator.js
- Adicionar método `exportConfig()`
- Gerar chrome-config.json de exemplo
- Testar exportação

**Depois**: Seguir ordem acima até completar todas as fases

**Confirmação necessária**: Posso começar pela FASE 4? (5-10 minutos)
