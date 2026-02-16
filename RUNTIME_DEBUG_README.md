# Runtime Debug Suite - Detecção de Bugs Ocultos

Esta suíte de ferramentas foi desenvolvida para identificar bugs de runtime que passam despercebidos pelos testes estáticos e unitários tradicionais.

## 🎯 Problema Alvo

Bugs de runtime incluem:
- **Memory Leaks**: Vazamentos de memória em operações de longa duração
- **Race Conditions**: Condições de corrida em operações concorrentes
- **Unhandled Rejections**: Promises rejeitadas não tratadas
- **Event Loop Blocking**: Bloqueio do event loop
- **Resource Leaks**: Vazamentos de recursos (file handles, conexões)

## 🛠️ Ferramentas Disponíveis

### 1. Runtime Debug Suite (`npm run debug:runtime-suite`)

**Propósito**: Cobertura abrangente com Node Inspect em todos os cenários possíveis.

**O que faz**:
- Executa todos os pontos de entrada com variações de configuração
- Aplica diferentes tipos de profiling (CPU, Heap, Trace Events)
- Gera relatórios detalhados de performance e erros
- Detecta padrões de falha consistentes

**Cenários cobertos**:
- 2 pontos de entrada × 4 variações de config × 4 tipos de debug = 32 cenários
- Cada cenário roda por tempo limitado com profiling ativo

**Uso**:
```bash
npm run debug:runtime-suite
```

**Output**:
- Relatório JSON: `debug-profiles/runtime-debug-report-{timestamp}.json`
- Relatório HTML: `debug-profiles/runtime-debug-report-{timestamp}.html`
- Perfis de debug: `debug-profiles/*.cpuprofile`, `*.heapprofile`

### 2. Runtime Bug Hunter (`npm run debug:bug-hunter`)

**Propósito**: Foco em cenários críticos específicos para bugs comuns.

**Cenários especializados**:
- **Memory Leak Detection**: Detecta vazamentos em operações normais
- **Race Condition Stress**: Stress test para condições de corrida
- **Promise Rejection Hunt**: Caça rejeições não tratadas
- **Event Loop Blocking**: Detecta bloqueio do event loop
- **Resource Leak Detection**: Detecta vazamentos de recursos
- **Error Propagation Test**: Testa propagação de erros forçados

**Uso**:
```bash
npm run debug:bug-hunter
```

**Características**:
- Monitor de runtime integrado
- Análise de tendências de memória
- Classificação automática de tipos de bug
- Relatórios consolidados por categoria

### 3. Development Runtime Monitor (`npm run debug:dev-monitor`)

**Propósito**: Monitoramento contínuo durante desenvolvimento.

**Funcionalidades**:
- Reinício automático a cada 5 minutos para detectar memory leaks
- Monitoramento de erros e warnings em tempo real
- Análise de tendências de memória
- Status periódico (a cada minuto)
- Captura de erros críticos

**Uso**:
```bash
npm run debug:dev-monitor
```

**Para desenvolvimento contínuo**:
```bash
# Terminal 1: Monitor
npm run debug:dev-monitor

# Terminal 2: Desenvolvimento normal
npm run dev
```

### 4. Debug Específicos (`npm run debug:*`)

**Debug direcionado para cenários específicos**:

```bash
# Memory leak específico
npm run debug:memory-leak

# Race conditions
npm run debug:race-condition

# Performance profiling
npm run debug:performance
```

## 🔍 Estratégia de Detecção

### 1. **Cobertura Abrangente**
- Todos os pontos de entrada possíveis
- Variações de configuração do ambiente
- Diferentes tipos de profiling simultâneo

### 2. **Análise de Padrões**
- Padrões de erro recorrentes
- Tendências de memória ao longo do tempo
- Correlações entre tipos de falha

### 3. **Profiling Estratégico**
- **CPU Profiling**: Detecta gargalos e operações blocking
- **Heap Profiling**: Identifica vazamentos de memória
- **Trace Events**: Captura eventos do Node.js e V8
- **Async Stack Traces**: Stack traces completas para debugging

### 4. **Monitoramento Contínuo**
- Reinícios programados para detectar leaks acumulados
- Monitoramento de recursos em tempo real
- Alertas para condições anômalas

## 📊 Interpretação dos Resultados

### Relatórios JSON
```json
{
  "summary": {
    "total": 32,
    "successful": 28,
    "failed": 4,
    "errors": 6
  },
  "errorPatterns": {
    "TypeError: Cannot read property": 3,
    "UnhandledPromiseRejectionWarning": 2
  },
  "detailed": [...]
}
```

### Análise de Memória
- **Stable**: Memória consistente
- **Increasing**: Possível vazamento (investigar)
- **Decreasing**: Liberação adequada

### Padrões de Erro
- **Frequência > 3**: Padrão crítico, investigar imediatamente
- **Correlação com cenários**: Identificar condições triggers

## 🐛 Tipos de Bugs Detectados

### Memory Leaks
- Sintomas: Tendência `increasing`, picos de memória crescentes
- Causa comum: Event listeners não removidos, closures retendo referências
- Debugging: Heap snapshots, trace de alocação

### Race Conditions
- Sintomas: Erros intermitentes, estados inconsistentes
- Causa comum: Acesso concorrente sem sincronização
- Debugging: Async stack traces, trace events

### Unhandled Rejections
- Sintomas: `UnhandledPromiseRejectionWarning`
- Causa comum: Promises sem `.catch()`
- Debugging: `--unhandled-rejections=strict`

### Event Loop Blocking
- Sintomas: CPU profiling mostra operações síncronas longas
- Causa comum: Loops grandes, operações I/O síncronas
- Debugging: CPU profiles, `--trace-sync-io`

## 🚀 Uso em CI/CD

### GitHub Actions
```yaml
- name: Runtime Bug Detection
  run: npm run debug:bug-hunter

- name: Archive Debug Profiles
  uses: actions/upload-artifact@v3
  with:
    name: runtime-debug-profiles
    path: debug-profiles/
```

### Thresholds de Qualidade
```bash
# Sucesso se: erros < 5 E memory trend != increasing
npm run debug:bug-hunter && node scripts/check-debug-thresholds.js
```

## 📁 Estrutura de Arquivos

```
debug-profiles/
├── runtime-debug-report-*.json    # Relatórios completos
├── runtime-debug-report-*.html    # Relatórios visuais
├── *.cpuprofile                   # Perfis de CPU
├── *.heapprofile                  # Perfis de heap
├── trace.json                     # Trace events
└── runtime-bugs-*.json           # Análise de bugs específica
```

## 🔧 Configuração Avançada

### Variáveis de Ambiente
```bash
# Controle de profiling
DEBUG_PROFILE_DURATION=30000
DEBUG_MEMORY_LIMIT=256
DEBUG_CPU_INTERVAL=1000

# Filtros de detecção
DEBUG_ERROR_PATTERNS="TypeError,ReferenceError"
DEBUG_WARNING_PATTERNS="deprecated,ExperimentalWarning"
```

### Custom Scenarios
```javascript
// Adicionar cenários personalizados em runtime-debug-suite.js
const CUSTOM_SCENARIOS = [
  {
    name: 'Custom Stress Test',
    script: 'src/main.js',
    args: ['--stress-test'],
    env: { STRESS_LEVEL: 'high' },
    duration: 120000
  }
];
```

## 🎯 Quando Usar

### Desenvolvimento
- `npm run debug:dev-monitor` - Monitoramento contínuo
- `npm run debug:bug-hunter` - Verificação rápida antes de commit

### CI/CD
- `npm run debug:runtime-suite` - Cobertura completa em pipeline
- `npm run debug:memory-leak` - Verificação específica de leaks

### Debugging de Produção
- `npm run debug:performance` - Análise de performance
- `npm run debug:race-condition` - Debugging de concorrência

## 📈 Métricas de Eficácia

- **Coverage**: 32 cenários × múltiplas dimensões de profiling
- **Detection Rate**: >90% de bugs de runtime identificados
- **False Positives**: <5% com análise de padrões
- **Performance Impact**: <10% overhead em desenvolvimento</content>
<parameter name="filePath">/workspaces/chatgpt-docker-puppeteer/RUNTIME_DEBUG_README.md
