# 🏗️ Arquitetura de Conexão - Índice

**Versão**: 3.0 Docker Desktop Edition
**Data**: 01 de Fevereiro de 2026
**Status**: ✅ Documentação Completa

---

## 📚 Documentos Disponíveis

### 1. [README.md](./README.md) - Visão Geral e Fundamentos Teóricos

**Para quem**: Desenvolvedores de todos os níveis
**Conteúdo**: 13 seções cobrindo:
- Explicação para iniciantes (analogia controle remoto + TV)
- Decisões arquiteturais detalhadas
- Diagramas de arquitetura completos
- Fluxo de dados e sequência de boot
- Evolução histórica (v1.0 → v2.0 → v3.0)
- Por que não podemos simplificar
- Trade-offs e limitações
- Troubleshooting completo

**Tempo de leitura**: ~45 minutos
**Nível técnico**: Iniciante → Avançado

---

### 2. [PRACTICAL_GUIDE.md](./PRACTICAL_GUIDE.md) - Guia Prático de Operação

**Para quem**: Operadores, DevOps, desenvolvedores em onboarding
**Conteúdo**:
- Checklist de setup (Windows + Container)
- Startup passo a passo (4 etapas)
- 5 cenários de troubleshooting mais comuns
- Scripts de monitoramento e alertas
- Debug avançado (tcpdump, wscat, logs)
- Referências rápidas de comandos

**Tempo de leitura**: ~30 minutos
**Nível técnico**: Operacional (requer conhecimento básico de Docker)

---

### 3. [DECISION_TREE.md](./DECISION_TREE.md) - Árvore de Decisões e Diagramas

**Para quem**: Arquitetos, líderes técnicos, auditores
**Conteúdo**:
- Árvore de decisão visual (por que cada escolha foi feita)
- Matriz de comparação (Chrome container vs Windows, etc.)
- Fluxograma de debugging
- Sequência de startup ideal
- Mapa de componentes e dependências
- Glossário visual de conceitos-chave
- Checklist de validação completa

**Tempo de leitura**: ~20 minutos
**Nível técnico**: Arquitetural (foco em decisões de design)

---

## 🎯 Guia de Navegação por Perfil

### 👶 Iniciante (primeiro contato)

**Ordem sugerida**:
1. [README.md](./README.md) → **Seção "Para Iniciantes"** (analogia TV)
2. [DECISION_TREE.md](./DECISION_TREE.md) → **Glossário Visual**
3. [PRACTICAL_GUIDE.md](./PRACTICAL_GUIDE.md) → **Checklist de Setup**

**Objetivo**: Entender o básico e conseguir executar o sistema.

---

### 💼 Operador/DevOps (já tem sistema rodando)

**Ordem sugerida**:
1. [PRACTICAL_GUIDE.md](./PRACTICAL_GUIDE.md) → **Troubleshooting Completo**
2. [PRACTICAL_GUIDE.md](./PRACTICAL_GUIDE.md) → **Monitoramento e Logs**
3. [README.md](./README.md) → **Troubleshooting (teoria)**

**Objetivo**: Resolver problemas rapidamente e manter sistema saudável.

---

### 🏗️ Arquiteto/Tech Lead (design de sistema)

**Ordem sugerida**:
1. [DECISION_TREE.md](./DECISION_TREE.md) → **Árvore de Decisão**
2. [README.md](./README.md) → **Decisões Arquiteturais**
3. [README.md](./README.md) → **Trade-offs e Limitações**
4. [DECISION_TREE.md](./DECISION_TREE.md) → **Mapa de Dependências**

**Objetivo**: Entender racional de design e avaliar alternativas.

---

### 🔬 Desenvolvedor (vai modificar código)

**Ordem sugerida**:
1. [README.md](./README.md) → **Arquitetura Completa** (diagramas)
2. [README.md](./README.md) → **Componentes e Responsabilidades**
3. [README.md](./README.md) → **Fluxo de Dados**
4. [PRACTICAL_GUIDE.md](./PRACTICAL_GUIDE.md) → **Debug Avançado**
5. [README.md](./README.md) → **Referências Técnicas** (código-fonte)

**Objetivo**: Entender implementação para fazer modificações seguras.

---

## 🔍 Busca por Tópico

### Problemas de Conexão

- **Erro "Connection refused"**: [PRACTICAL_GUIDE.md](./PRACTICAL_GUIDE.md#cenário-1-connection-refused-ao-acessar-chrome)
- **Host header error**: [PRACTICAL_GUIDE.md](./PRACTICAL_GUIDE.md#cenário-2-host-header-error) + [README.md](./README.md#problema-1-host-header-validation)
- **Proxy não inicia**: [PRACTICAL_GUIDE.md](./PRACTICAL_GUIDE.md#cenário-3-proxy-não-inicia)
- **WebSocket fecha**: [PRACTICAL_GUIDE.md](./PRACTICAL_GUIDE.md#cenário-4-websocket-fecha-inesperadamente)

### Arquitetura e Design

- **Por que proxy é necessário?**: [README.md](./README.md#por-que-usar-proxy-chromeproxyservice)
- **Por que Chrome no Windows?**: [README.md](./README.md#por-que-não-podemos-simplificar)
- **Decisões de design**: [DECISION_TREE.md](./DECISION_TREE.md#matriz-de-decisões)
- **Evolução histórica**: [README.md](./README.md#evolução-histórica)

### Configuração e Setup

- **Checklist completo**: [PRACTICAL_GUIDE.md](./PRACTICAL_GUIDE.md#checklist-de-setup) + [DECISION_TREE.md](./DECISION_TREE.md#checklist-de-validação-completa)
- **Variáveis de ambiente**: [PRACTICAL_GUIDE.md](./PRACTICAL_GUIDE.md#variáveis-de-ambiente)
- **Arquivos de configuração**: [README.md](./README.md#referências-técnicas)
- **Startup passo a passo**: [PRACTICAL_GUIDE.md](./PRACTICAL_GUIDE.md#startup-completo-passo-a-passo)

### Monitoramento e Debug

- **Logs**: [PRACTICAL_GUIDE.md](./PRACTICAL_GUIDE.md#logs-do-proxy)
- **Health checks**: [PRACTICAL_GUIDE.md](./PRACTICAL_GUIDE.md#health-checks-automatizados)
- **Debug avançado**: [PRACTICAL_GUIDE.md](./PRACTICAL_GUIDE.md#debug-avançado)
- **Estados do sistema**: [DECISION_TREE.md](./DECISION_TREE.md#estados-e-transições)

### Conceitos Técnicos

- **CDP (Chrome DevTools Protocol)**: [DECISION_TREE.md](./DECISION_TREE.md#glossário-visual) + [README.md](./README.md#referências-técnicas)
- **Docker Desktop networking**: [README.md](./README.md#restrições-da-rede-docker-desktop)
- **WebSocket tunneling**: [README.md](./README.md#fluxo-de-dados)
- **Bind addresses (0.0.0.0 vs 127.0.0.1)**: [DECISION_TREE.md](./DECISION_TREE.md#glossário-visual)

---

## 📊 Estatísticas da Documentação

```
┌─────────────────────────────────────────────────────────┐
│ README.md                                                │
│   Linhas: 1,200+                                         │
│   Seções: 11                                             │
│   Diagramas: 5                                           │
│   Exemplos de código: 30+                                │
│   Nível: Completo (teoria + prática)                    │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│ PRACTICAL_GUIDE.md                                       │
│   Linhas: 800+                                           │
│   Seções: 9                                              │
│   Cenários de troubleshooting: 5                         │
│   Scripts de exemplo: 10+                                │
│   Nível: Operacional (foco em execução)                 │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│ DECISION_TREE.md                                         │
│   Linhas: 600+                                           │
│   Diagramas de decisão: 4                                │
│   Matrizes de comparação: 3                              │
│   Fluxogramas: 2                                         │
│   Nível: Arquitetural (foco em design)                  │
└─────────────────────────────────────────────────────────┘

TOTAL: 2,600+ linhas de documentação técnica
```

---

## 🎓 Glossário Rápido

| Termo                      | Significado                                                          | Onde Aprender Mais                                             |
| -------------------------- | -------------------------------------------------------------------- | -------------------------------------------------------------- |
| **CDP**                    | Chrome DevTools Protocol - protocolo WebSocket para controlar Chrome | [README.md](./README.md#referências-técnicas)                  |
| **host.docker.internal**   | DNS especial do Docker Desktop para acessar Windows Host             | [DECISION_TREE.md](./DECISION_TREE.md#glossário-visual)        |
| **Bind Address**           | IP onde servidor escuta conexões (0.0.0.0 = todas interfaces)        | [README.md](./README.md#restrições-da-rede-docker-desktop)     |
| **WebSocket Upgrade**      | Transformação de HTTP request em conexão WebSocket persistente       | [DECISION_TREE.md](./DECISION_TREE.md#glossário-visual)        |
| **Proxy**                  | Intermediário que reescreve headers e URLs para compatibilidade      | [README.md](./README.md#por-que-usar-proxy-chromeproxyservice) |
| **ConnectionOrchestrator** | Módulo que decide estratégia de conexão ao Chrome                    | [README.md](./README.md#1-connectionorchestrator)              |
| **ChromeProxyService**     | Servidor HTTP + WebSocket que faz forwarding para Chrome             | [README.md](./README.md#2-chromeproxyservice)                  |

---

## ✅ Validação de Leitura

Após ler a documentação, você deve conseguir responder:

### Nível Iniciante ⭐
- [ ] Por que não podemos usar Chrome headless no container?
- [ ] O que significa "0.0.0.0" em bind address?
- [ ] Como validar se Chrome está rodando no Windows?

### Nível Intermediário ⭐⭐
- [ ] Por que o proxy reescreve URLs de WebSocket?
- [ ] Qual a diferença entre `host.docker.internal` e `localhost`?
- [ ] Como debugar conexões WebSocket que fecham inesperadamente?

### Nível Avançado ⭐⭐⭐
- [ ] Por que o proxy roda no container e não no Windows?
- [ ] Quais são os trade-offs de latência vs manutenibilidade?
- [ ] Como a arquitetura evoluiu da v1.0 para v3.0 e por quê?

**Gabarito**: Todas as respostas estão nos documentos! 😉

---

## 🔄 Manutenção da Documentação

**Quando atualizar**:
- Mudança de versão de componente (Puppeteer, Chrome, etc.)
- Novo cenário de troubleshooting descoberto
- Mudança arquitetural (ex: v4.0)
- Feedback de usuários/operadores

**Como atualizar**:
1. Editar documento relevante (README, PRACTICAL_GUIDE, ou DECISION_TREE)
2. Atualizar "Última Atualização" no rodapé
3. Se mudança significativa, incrementar versão (3.0 → 3.1)
4. Atualizar este índice se necessário

**Responsável**: Equipe de Arquitetura + DevOps

---

## 📞 Suporte

**Problemas não documentados**:
1. Verificar [Issues do Puppeteer](https://github.com/puppeteer/puppeteer/issues)
2. Consultar [Chrome DevTools Protocol Docs](https://chromedevtools.github.io/devtools-protocol/)
3. Checar [Docker Desktop Networking Docs](https://docs.docker.com/desktop/networking/)
4. Abrir issue no repositório do projeto

**Contribuições**:
- Novos cenários de troubleshooting são bem-vindos!
- Pull requests com melhorias na documentação serão revisados
- Sugestões de diagramas/exemplos: abrir issue com tag `documentation`

---

## 🎯 Próximos Passos

Após ler esta documentação:

1. **Iniciantes**: Execute o [Checklist de Setup](./PRACTICAL_GUIDE.md#checklist-de-setup)
2. **Operadores**: Configure [Monitoramento](./PRACTICAL_GUIDE.md#monitoramento-e-logs)
3. **Desenvolvedores**: Estude [Componentes](./README.md#componentes-e-responsabilidades)
4. **Arquitetos**: Analise [Trade-offs](./README.md#trade-offs-e-limitações)

**Dúvidas persistem?**
Releia a seção específica no documento indicado. A documentação é modular e permite consultas rápidas.

---

**Última Atualização**: 01 de Fevereiro de 2026
**Versão da Documentação**: 1.0
**Cobertura**: 100% da arquitetura v3.0
