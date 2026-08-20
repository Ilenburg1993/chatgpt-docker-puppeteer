# Playbook de reprodução de bugs

## Objetivo

Transformar uma evidência inicial em uma reprodução mínima, determinística e segura antes de alterar
o código. O resultado deve distinguir o sintoma observado da causa-raiz confirmada.

## 1. Confirmar a evidência atual

- Registrar a mensagem, o comportamento, o arquivo e a condição exatos do defeito.
- Confirmar que a evidência pertence ao `HEAD` e ao ambiente atuais.
- Preservar logs e saídas relevantes sem registrar segredos ou dados pessoais.

```bash
rg -n "trecho exato do erro" src scripts tests
git log -n 5 --oneline -- caminho/suspeito.js
```

## 2. Encontrar o menor caminho reproduzível

Preferir, nesta ordem:

1. teste existente que já falha;
2. teste focal novo no runner nativo do módulo;
3. script temporário fora da árvore versionada;
4. reprodução manual documentada, quando o defeito depende de sistema externo.

Não usar a suíte completa como primeira tentativa. Reduzir entradas, concorrência e dependências até
restar apenas o comportamento necessário para provocar o defeito.

## 3. Controlar o ambiente

- Fixar variáveis de ambiente relevantes e registrar somente seus nomes/valores não sensíveis.
- Usar diretório criado por `mktemp -d` para estado mutável.
- Fixar relógio, aleatoriedade e timeouts quando influírem no resultado.
- Substituir rede apenas no limite externo; preservar o contrato real dentro do sistema.
- Encerrar timers, listeners, processos filhos e arquivos temporários no teardown.

## 4. Provar a causa-raiz

Uma hipótese só é confirmada quando:

- a reprodução falha antes do patch pelo motivo esperado;
- uma mudança isolada na causa proposta altera o resultado;
- o teste não depende de texto incidental, timing arbitrário ou estado de outra suíte;
- caminhos vizinhos relevantes continuam cobertos.

Logs temporários podem ser usados durante a investigação, mas devem ser removidos antes do patch
final. Não confundir correlação temporal com causalidade.

## 5. Converter a reprodução em regressão

- Nomear o teste pelo contrato violado, não pela implementação.
- Assegurar que o teste falhe no estado defeituoso e passe com a correção.
- Para corrida ou lifecycle, usar handshake explícito em vez de `sleep` como sinal de prontidão.
- Para validação negativa, atravessar uma fronteira runtime explícita; não usar supressão do
  compilador.
- Para filesystem, nunca escrever ou remover fixtures versionados.

## 6. Evidência de fechamento

Registrar no formato de `evidence-template.md`:

- comando focal e resultado;
- causa-raiz confirmada;
- patch mínimo aplicado;
- gate da área afetada;
- gate amplo proporcional ao risco;
- limitações externas ou skips condicionais, se houver.

O finding só pode ser encerrado quando a reprodução original não ocorrer mais e os gates
relacionados estiverem verdes.
