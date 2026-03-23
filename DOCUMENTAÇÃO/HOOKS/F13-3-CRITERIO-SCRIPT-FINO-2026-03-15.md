# F13.3 — Critério Objetivo de “Script Fino” para Hooks Automáticos

**Data**: 2026-03-15 **Escopo**: 9 hooks automáticos de `.github/hooks/copilot-hooks.json`
**Dependências**: F13.1 (contrato canônico), F13.2 (matriz hook->script->libs->owner)

## Objetivo

Transformar “script fino” em um critério **mensurável e auditável**, apto para enforcement
automático no F16.

## Conceito operacional

Um script automático é **fino** quando atua como:

1. bootstrap de runtime,
2. carregador de libs,
3. dispatcher de função pública da lib,
4. finalizador mínimo (exit/payload),

sem concentrar regras de domínio extensas.

## Hard Gates (obrigatórios)

Se qualquer hard gate falhar, o script é **não conforme** independentemente da pontuação.

1. **HG-1: lib dedicada carregada**
   - o script deve carregar sua lib de entrada dedicada definida em F13.2.
2. **HG-2: função pública canônica invocada**
   - o script deve chamar `run_<script>_hook` (ou nome oficial equivalente documentado).
3. **HG-3: fail-fast de contrato de entrada**
   - ausências críticas (lib/função/entrada mínima) devem resultar em erro explícito.

## Rubric quantitativo (0 a 100)

| Métrica                  | Peso | Regra de medição                                      | Faixa ideal                |
| ------------------------ | ---: | ----------------------------------------------------- | -------------------------- |
| M1 Bootstrap/IO enxuto   |   20 | % de linhas de bootstrap versus total do script       | >= 60% do conteúdo total   |
| M2 Acoplamento a domínio |   25 | quantidade de blocos de lógica de negócio inline      | <= 3 blocos                |
| M3 Dispatch canônico     |   20 | presença de dispatch único para função pública da lib | 1 dispatch principal       |
| M4 Persistência inline   |   20 | operações de escrita de estado diretamente no script  | 0 (ou exceção documentada) |
| M5 Duplicação com lib    |   15 | padrões redundantes já existentes na lib dedicada     | 0 duplicações críticas     |

## Método de pontuação operacional

Pontuação final:

- `score_final = M1 + M2 + M3 + M4 + M5`
- cada métrica retorna valor inteiro entre `0` e `peso_da_métrica`.

### Regras de cálculo por métrica

- **M1 (20)**
  - 20 pontos: bootstrap/IO >= 60% das linhas úteis do script.
  - 10 pontos: bootstrap/IO entre 45% e 59%.
  - 0 ponto: bootstrap/IO < 45%.
- **M2 (25)**
  - 25 pontos: <= 3 blocos de lógica de domínio inline.
  - 10 pontos: 4 a 6 blocos.
  - 0 ponto: >= 7 blocos.
- **M3 (20)**
  - 20 pontos: exatamente 1 dispatch principal para função pública canônica da lib.
  - 10 pontos: dispatch principal existe, mas com ramificações concorrentes não críticas.
  - 0 ponto: ausência de dispatch canônico único.
- **M4 (20)**
  - 20 pontos: 0 persistências inline.
  - 10 pontos: 1 persistência inline com exceção documentada.
  - 0 ponto: > 1 persistência inline ou sem justificativa.
- **M5 (15)**
  - 15 pontos: 0 duplicações críticas com a lib dedicada.
  - 5 pontos: duplicações leves não críticas.
  - 0 ponto: qualquer duplicação crítica.

## Níveis de conformidade

- **Verde (>= 85 + hard gates OK)**: script fino conforme.
- **Amarelo (70–84 + hard gates OK)**: aceitável temporariamente, exige plano de ajuste.
- **Vermelho (< 70 ou hard gate falho)**: não conforme, bloqueável por gate estrutural.

## Exceções controladas

### `agent-stop.sh`

- Pode manter volume maior de coordenação temporariamente.
- Continua sujeito aos hard gates.
- A redução principal virá da modularização interna de `agent-stop-lib.sh` em F15.2.

## Uso na trilha F14→F16

1. **F14**: mover lógica para libs para aumentar score M2/M4/M5.
2. **F15**: tratar exceção do Stop com modularização interna da lib.
3. **F16**: incorporar hard gates + score mínimo no verificador estrutural/smoke.

## Fluxo de avaliação (pronto para automação em F16)

1. Resolver mapeamento oficial `hook -> script -> lib` de F13.2.
2. Avaliar hard gates HG-1/HG-2/HG-3.
3. Se qualquer hard gate falhar, classificar como **Vermelho** imediatamente.
4. Se hard gates passarem, calcular `score_final` pelas regras M1..M5.
5. Classificar por faixa (Verde/Amarelo/Vermelho) e persistir evidências por script.
6. Em caso Amarelo/Vermelho, abrir item de backlog com owner e prazo.

## Critérios de aceite de F13.3

1. Rubric objetivo publicado (este documento).
2. Artefato machine-readable correspondente publicado
   (`.github/hooks/state/f13-script-fino-rubric.json`).
3. Níveis de conformidade definidos com limiar de bloqueio para F16.
4. ROADMAP/PLANO/pending-tasks sincronizados.
5. Método de cálculo e fluxo de avaliação explícitos para automação posterior.
