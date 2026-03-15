# Checklist de Auditoria Manual

Use este checklist para orientar a leitura profunda do escopo auditado.

> Objetivo: detectar falhas semânticas, lógicas e de contrato que normalmente passam por análise
> automática.

## 1) Correção funcional e lógica de negócio

- O comportamento implementado corresponde ao comportamento esperado?
- Há condições invertidas (`if`/`else`) ou branches inalcançáveis?
- Existem caminhos de execução sem retorno válido?
- Há suposições implícitas não garantidas em runtime?

## 2) Invariantes e máquina de estados

- Quais invariantes o fluxo assume como sempre verdadeiras?
- Há transições de estado inválidas ou sem guarda?
- Existem estados terminais inconsistentes com resultado real da operação?
- Há risco de estado parcialmente atualizado em falha intermediária?

## 3) Contratos entre módulos/APIs

- O produtor e o consumidor concordam sobre shape/tipos/semântica dos dados?
- Há campos obrigatórios sem validação no boundary?
- Erros/exceções propagam com formato consistente?
- Contratos mudaram sem ajustes de compatibilidade?

## 4) Fluxo de dados e validação

- Entradas externas são validadas cedo?
- Dados críticos podem chegar como `null/undefined` sem tratamento?
- Conversões (string/number/date) podem causar ambiguidade?
- Há dados sensíveis trafegando/logando sem necessidade?

## 5) Concorrência, reentrância e idempotência

- Há risco de processamento duplicado sem proteção?
- Locks são liberados em todos os caminhos (inclusive erro)?
- Existe janela de corrida entre checagem e ação (TOCTOU)?
- O retry/backoff possui condição de parada alcançável?

## 6) Tratamento de erro e resiliência

- Exceções relevantes são engolidas silenciosamente?
- Mensagens de erro permitem diagnóstico sem expor segredo?
- Há fallback seguro quando dependência externa falha?
- Timeouts/cancelamento são tratados de forma consistente?

## 7) Segurança e superfície de ataque

- Há validação insuficiente em input potencialmente hostil?
- Existe risco de injeção (SQL, comando, template, path traversal)?
- Autorização é verificada no local correto do fluxo?
- Dados sensíveis estão protegidos em trânsito/log/persistência?

## 8) Persistência e atomicidade

- Operações relacionadas são atômicas quando necessário?
- Falhas intermediárias deixam dados inconsistentes?
- Atualizações concorrentes podem sobrescrever estado sem detecção?
- Há rollback/compensação para falhas parciais?

## 9) Performance e eficiência semântica

- Loops/queries desnecessários em caminhos quentes?
- Há risco de N+1, carga duplicada ou recomputação evitável?
- Estratégia de cache invalida corretamente?
- Custos de serialização/deserialização são justificáveis?

## 10) Testabilidade e observabilidade

- O design permite validar cenários críticos facilmente?
- Há pontos cegos sem logs/telemetria para diagnóstico?
- Logs têm contexto suficiente para rastrear incidente?
- Comportamento crítico depende de side effects difíceis de observar?

## Sinal de qualidade do achado

Considere um achado forte quando houver:

1. Evidência em linha/caminho de execução.
2. Cenário concreto de manifestação.
3. Impacto técnico claro.
4. Proposta de correção acionável.
