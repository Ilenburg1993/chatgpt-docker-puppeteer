# Single Executable Applications (SEA) - Guia de Migração

## 📋 Visão Geral

Este projeto está migrando do **PKG** (ferramenta deprecated) para **Single Executable Applications
(SEA)** do Node.js, que são a solução oficial para criar executáveis standalone.

## ⚠️ Status Atual: VERSÃO INFORMATIVA

**O SEA ainda não suporta completamente projetos ESM complexos como o chatgpt-docker-puppeteer.**

### Limitações Técnicas Atuais

- ❌ `import()` dinâmico não funciona no snapshot do Node.js
- ❌ Projetos ESM complexos têm problemas de compatibilidade
- ❌ Dependências nativas (`better-sqlite3`) requerem compilação cruzada
- ❌ Múltiplas features ESM avançadas ainda não são suportadas

### O Que Já Funciona no SEA

- ✅ Node.js 24+ (vs PKG limitado a Node.js 18)
- ✅ Top-level await (resolve o problema crítico do projeto)
- ✅ Snapshots para inicialização mais rápida
- ✅ API oficial do Node.js (não deprecated como PKG)

## ✅ Vantagens do SEA vs PKG

| Aspecto             | SEA (Node.js)             | PKG (Deprecated) |
| ------------------- | ------------------------- | ---------------- |
| **Status**          | 🟢 Oficial/Node.js        | 🔴 Arquivado     |
| **Node.js 24+**     | ✅                        | ❌               |
| **Top-level await** | ✅                        | ❌               |
| **ESM complexo**    | ✅ (futuro)               | ⚠️ Limitado      |
| **Manutenção**      | 🟢 Ativa                  | 🔴 Morto         |
| **Snapshots**       | ✅ (inicialização rápida) | ❌               |
| **Assets nativos**  | ✅ (API `sea.*`)          | ✅               |

## 🏗️ Como Usar a Versão Atual

### Build (Desenvolvimento)

```bash
npm run build:sea
```

### Build (Produção - com validações)

```bash
npm run build:sea:prod
```

### Executável Gerado

```bash
./release/chatgpt-docker-puppeteer-info.sh
```

Este executável informativo explica as limitações atuais e fornece recomendações contextuais
baseadas no ambiente detectado.

## 🆕 Melhorias Recentes (2025)

### ✅ Sistema de Validação Pré-Voo

- **Integração automática** no build SEA
- **Detecção de ambiente** inteligente (dev vs prod)
- **Validações contextuais** baseadas no modo de execução

### ✅ Recomendações Contextuais

- **Desenvolvimento**: Sugere comandos de desenvolvimento
- **Produção**: Sugere comandos com validações de produção
- **Feedback visual** claro sobre limitações atuais

### ✅ Robustez Operacional

- **Build validado** antes da geração do executável
- **Dependências verificadas** automaticamente
- **Ambiente consistente** entre builds

## 🔍 Validações Integradas

O build SEA agora inclui **validações pré-voo automáticas**:

- ✅ Verificação de arquivos essenciais
- ✅ Validação de build (em produção)
- ✅ Verificação de dependências instaladas
- ✅ Recomendações contextuais por ambiente

## 💡 Recomendações Contextuais

O executável informativo agora adapta suas recomendações baseado no ambiente detectado:

- **Desenvolvimento**: Sugere `npm run daemon:start`
- **Produção**: Sugere `npm run daemon:start:prod` (com validações)

## 💡 Recomendações Atuais

Enquanto o SEA amadurece, use estas alternativas robustas:

### 1. Docker (Recomendado)

```bash
docker build -t chatgpt-docker-puppeteer .
docker run chatgpt-docker-puppeteer
```

### 2. NPM/Node.js Direto

```bash
npm start
```

### 3. PM2 (Produção)

```bash
npm run daemon:start
```

## 🔄 Futuro do SEA

O SEA está evoluindo rapidamente. Quando for viável para projetos complexos como este:

1. ✅ Suporte completo a ESM
2. ✅ `import()` dinâmico em snapshots
3. ✅ Compilação cruzada automática
4. ✅ Executáveis verdadeiramente standalone

## ⚠️ Considerações Importantes

### Dependências Nativas

O projeto usa `better-sqlite3`, que é uma dependência nativa. Para distribuição cruzada:

1. **Linux → Linux**: Funciona diretamente
2. **Linux → Windows/Mac**: Requer compilação cruzada
3. **Windows/Mac → Outros**: Requer ambiente de compilação apropriado

### Solução para Dependências Nativas

Para builds multiplataforma, considere:

```bash
# Usar Docker para compilação cruzada
docker run --rm -v $(pwd):/app -w /app node:24-bullseye npm run build:sea

# Ou usar GitHub Actions com matrix de plataformas
```

### Limitações Conhecidas

1. **Aliases complexos**: SEA não suporta aliases `import` complexos. Usamos resolução manual.
2. **Assets grandes**: Executáveis podem ficar grandes com muitas dependências.
3. **Debugging**: Stack traces podem ser menos claras em executáveis.

## 🔧 Troubleshooting

### Erro: "postject not found"

```bash
npm install -g postject
```

### Erro: "Cannot resolve module"

Verifique se todos os arquivos foram copiados corretamente para `dist-sea/`.

### Erro: "Native module not found"

Dependências nativas precisam ser compiladas para a arquitetura alvo.

## 📊 Comparação de Tamanho

| Método | Tamanho Aproximado | Vantagens | | ---------- | ------------------ |
-------------------------- | ------------- | | **SEA** | ~150-200MB | Completo, oficial, moderno | |
**PKG** | ~100-150MB | - | ❌ Deprecated | | **Docker** | ~500MB+ | Portabilidade máxima | |

## 🔄 Migração do PKG

### O que mudou

1. **Script de entrada**: `pkg-entry.js` → `sea-entry.js`
2. **Configuração**: `package.json` → `sea-config.json`
3. **Build tool**: `npx pkg` → `node --experimental-sea-config + postject`
4. **Aliases**: Resolução manual em vez de aliases `import`

### Compatibilidade

- ✅ **Top-level await**: Agora funciona
- ✅ **ESM complexo**: Totalmente suportado
- ✅ **Node.js 24+**: Suportado
- ✅ **Snapshots**: Para inicialização mais rápida

## 🎯 Recomendações

1. **Use SEA para produção** - É a solução oficial do Node.js
2. **Teste em ambiente limpo** - Execute o executável em uma máquina sem Node.js instalado
3. **Considere Docker para distribuição** - Se dependências nativas forem problemáticas
4. **Monitore tamanho do executável** - SEA inclui todas as dependências

## 🎯 Conclusão

**O PKG está morto** - foi arquivado pelo Vercel e não suporta Node.js moderno.

**O SEA é o futuro** - é oficial, moderno e resolve os problemas do PKG. A infraestrutura já está
preparada para quando o SEA estiver pronto para projetos complexos.

**Para produção hoje**: Use Docker ou PM2, que são soluções robustas e bem testadas.

## 📚 Recursos

- [Documentação Oficial SEA](https://nodejs.org/api/single-executable-applications.html)
- [Guia de Migração PKG→SEA](https://nodejs.org/en/blog/release/v20.1.0/#single-executable-applications)
- [Postject Tool](https://github.com/nodejs/postject)
