# 🏠 Como Não Confundir os Ambientes

## 🎯 O Problema

É fácil confundir durante o desenvolvimento:

- **RAIZ** (`/workspaces/chatgpt-docker-puppeteer/`) - para EDITAR código
- **DIST** (`/workspaces/chatgpt-docker-puppeteer/dist/`) - para EXECUTAR código

## 🔍 Verificar Ambiente Atual

### Comando rápido:

```bash
npm run check:env
```

### Ou manualmente:

```bash
pwd # Mostra onde você está
```

## 📋 Regras Essenciais

### ✅ SEMPRE:

- **Edite código** na pasta **RAIZ**
- **Execute aplicação** da pasta **DIST**
- **Faça commits** apenas da **RAIZ**
- **Use `npm run check:env`** quando duvidar

### ❌ NUNCA:

- Edite arquivos em `dist/`
- Execute `npm install` em `dist/`
- Faça commits de mudanças em `dist/`

## 🚀 Workflow Correto

```bash
# 1. Desenvolver na RAIZ
cd /workspaces/chatgpt-docker-puppeteer
# Edite arquivos em src/, scripts/, etc.

# 2. Build para produção
npm run build

# 3. Executar da DIST
cd dist
node start.js

# 4. Verificar ambiente
npm run check:env
```

## 🛠️ Sinais Visuais

### Na RAIZ (desenvolvimento):

```
💻 Ambiente: DESENVOLVIMENTO
✅ Pode editar arquivos
```

### Na DIST (produção):

```
📦 Ambiente: PRODUÇÃO
⚠️ Use apenas para execução
❌ NÃO edite arquivos aqui!
```

## 🎯 Checklist Rápido

Antes de qualquer ação importante:

- [ ] `pwd` - Estou na raiz ou dist?
- [ ] `npm run check:env` - Confirme o ambiente
- [ ] Estou editando ou executando?

**Lembre-se: RAIZ = editar, DIST = executar!** 🚀

## ⚙️ PM2: Desenvolvimento vs Produção

### ❌ PROBLEMA:

O comando `npm run daemon:start` executa da **raiz** e usa código de **desenvolvimento**!

### ✅ SOLUÇÃO:

```bash
# Desenvolvimento (código da raiz)
npm run daemon:start

# Produção (código da dist)
npm run daemon:start:prod
```

### 📋 Quando usar cada um:

- **`npm run daemon:start`**: Desenvolvimento, testes, debugging
- **`npm run daemon:start:prod`**: Produção, deployment, CI/CD

---

## 🆕 Melhorias Implementadas

### ✅ PM2 Auto-detecção de Ambiente

O `ecosystem.config.cjs` agora detecta automaticamente se está sendo executado da raiz ou dist:

- **Raiz**: Usa caminhos relativos corretos para desenvolvimento
- **Dist**: Ajusta caminhos automaticamente para produção

### ✅ Validação Pré-Voo

Antes de iniciar em produção, o sistema verifica:

- Arquivos essenciais presentes
- Build atualizado
- Dependências instaladas
- Ambiente configurado corretamente

```bash
npm run check:pre-flight # Executa validações
```

### ✅ Indicadores Visuais no Terminal

Configure seu terminal para mostrar claramente o ambiente:

```bash
npm run setup:terminal
```

- **🟢 [DEV]** Verde para desenvolvimento
- **🔴 [PROD]** Vermelho para produção (com alertas)

### ✅ Comandos Seguros

- **`npm run daemon:start:prod`**: Inclui validação pré-voo automática
- **Aliases bloqueados** em produção para prevenir acidentes
- **Prompt visual** mostra claramente o ambiente atual

---

## 📊 Status das Melhorias

| Funcionalidade                  | Status          | Comando                     |
| ------------------------------- | --------------- | --------------------------- |
| Detecção automática de ambiente | ✅ Implementado | `npm run check:env`         |
| PM2 auto-detecção               | ✅ Implementado | `ecosystem.config.cjs`      |
| Validação pré-voo               | ✅ Implementado | `npm run check:pre-flight`  |
| Indicadores visuais             | ✅ Implementado | `npm run setup:terminal`    |
| Comandos seguros                | ✅ Implementado | `npm run daemon:start:prod` |

---

**🎉 Resultado**: Sistema robusto que previne confusões entre ambientes e oferece feedback visual
claro!
