# 📂 Legacy Scripts

Scripts obsoletos mantidos apenas para referência histórica.

## ⚠️ AVISO

**NÃO USE estes scripts!** Eles estão desatualizados e podem causar erros.

Use os comandos npm modernos em vez disso.

---

## 📜 Scripts Legados

### `rodar_agente.bat` (147 linhas)

**Status**: ⚠️ **OBSOLETO**

**Problema Original**:
- Implementa watchdog manual para `index.js`
- Conflita com PM2 que já faz watchdog melhor
- Hardcoded paths Windows (não funciona no Docker)
- Audit Level antigo (10) vs moderno (700)

**Use em vez disso**:
```bash
# Windows/Linux/macOS
npm run daemon:start    # Inicia PM2 com ecosystem.config.js
npm run daemon:status   # Verifica status
npm run daemon:logs     # Vê logs
npm run daemon:stop     # Para tudo
```

**Por que foi deprecado**:
1. PM2 é superior (auto-restart, memory limits, logs, clustering)
2. `ecosystem.config.js` centraliza configuração de ambos processos
3. BAT scripts não funcionam cross-platform
4. Adiciona complexidade desnecessária

**Quando este script era usado**:
- Antes da migração para PM2 (pre-2025)
- Desenvolvimento local Windows sem PM2
- Testes ad-hoc de boot sequence

---

## 🔄 Migração

Se você estava usando `rodar_agente.bat`:

**Antes** (obsoleto):
```bat
rodar_agente.bat
```

**Depois** (moderno):
```bash
# 1. Instale PM2 globalmente (opcional)
npm install -g pm2

# 2. Inicie o daemon
npm run daemon:start

# 3. Verifique status
npm run daemon:status

# 4. Acesse dashboard
start http://localhost:3008
```

**Benefícios do PM2**:
- ✅ Auto-restart em crashes
- ✅ Memory limits (evita leaks)
- ✅ Logs centralizados
- ✅ Múltiplos processos (agente + dashboard)
- ✅ Zero-downtime reload
- ✅ Cross-platform (Linux/Windows/macOS)

---

## 📚 Documentação

- **Scripts npm**: Ver [DOCUMENTAÇÃO/SCRIPTS.md](../../DOCUMENTAÇÃO/SCRIPTS.md)
- **PM2 Setup**: Ver [DOCUMENTAÇÃO/DEPLOYMENT.md](../../DOCUMENTAÇÃO/DEPLOYMENT.md)
- **Troubleshooting**: Ver [DOCUMENTAÇÃO/TROUBLESHOOTING.md](../../DOCUMENTAÇÃO/TROUBLESHOOTING.md)

---

**Movido para legacy**: 2026-01-21
**Razão**: Conflito com PM2, complexidade desnecessária, não cross-platform
