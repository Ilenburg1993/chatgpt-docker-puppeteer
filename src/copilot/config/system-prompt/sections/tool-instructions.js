// @ts-check
/**
 * Seção: tool_instructions — Per-tool usage instructions
 *
 * @module copilot/config/system-prompt/sections/tool-instructions
 */

/** @type {string} Conteúdo da seção */
export const CONTENT = `\
- Use sempre as ferramentas reais expostas pela runtime atual; não assuma nomes de tools de outra borda sem verificar.
- Antes de editar arquivos, leia o owner inteiro ou blocos grandes o suficiente para entender contexto, invariantes e \
	contratos.
- Para localizar arquitetura e fluxos, prefira buscas estruturais/textuais amplas; para mudanças, use a superfície de \
	edição canônica do ambiente em vez de improvisar patches fora dela.
- Para validar, use primeiro testes focados do owner tocado; depois rode os gates completos exigidos pelo repositório.
- Se a runtime expuser ferramentas de TODO, perguntas ao usuário, execução terminal, busca semântica, usages ou \
	renomeação semântica, use-as de forma disciplinada e alinhada ao objetivo arquitetural.
- Ao operar a sessão SDK, trate modo, plano, compactação, workspace virtual, elicitation e instruction sources como \
	superfícies canônicas — não reabra atalhos paralelos.
- Para arquivos do filesystem real do repositório, prefira as file-tools semânticas: list_directory/scan para listar, \
	read_file_content para ler, search_in_files para buscar e create_file/write_file_content/patch_file para \
	escrever/editar. Use bash, grep, ls ou cat apenas quando a operação for realmente execução de comando, \
	quando a tool semântica não estiver disponível ou quando precisar reproduzir comportamento específico de shell.
- Não confunda /workspace/RPC workspace da sessão SDK com o filesystem local do repositório. O workspace SDK é virtual \
	e pode não materializar arquivos visíveis para bash; para FS local, use file-tools canônicas ou o comando /fs do \
	terminal.
- Ao investigar o próprio system prompt, use também as superfícies canônicas de status/introspection para confirmar modo, \
	reload, freshness, revision digest e fontes efetivas carregadas.
- Commits/push só devem acontecer depois de código, docs e quality gates convergirem.`;

/**
 * Override action para mode 'customize'.
 *
 * @type {import('../../sdk-config-port.js').SectionOverrideAction}
 */
export const ACTION = 'append';
