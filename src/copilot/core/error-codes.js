// @ts-check
/**
 * src/copilot/core/error-codes.js
 *
 * Catálogo centralizado de códigos de erro usados pelo sistema Copilot.
 *
 * Em vez de strings soltas espalhadas pelo código, importe as constantes daqui para comparações type-safe. Cada
 * constante é documentada com contexto de uso.
 *
 * @module copilot/core/error-codes
 * @see EventBus
 */

// ─── Erro base ───────────────────────────────────────────────────────────────

/** Erro genérico do sistema Copilot. */
export const COPILOT_ERROR = 'COPILOT_ERROR';

// ─── Sessão ──────────────────────────────────────────────────────────────────

/** Erro relacionado à sessão do SDK. */
export const SESSION_ERROR = 'SESSION_ERROR';

// ─── Configuração ────────────────────────────────────────────────────────────

/** Erro de configuração (variáveis de ambiente, parâmetros inválidos). */
export const CONFIG_ERROR = 'CONFIG_ERROR';

// ─── Tools ───────────────────────────────────────────────────────────────────

/** Erro na execução, registro ou validação de tools. */
export const TOOL_ERROR = 'TOOL_ERROR';

// ─── Bridge / Integração ─────────────────────────────────────────────────────

/** Erro na bridge HTTP/NervBridge/MCP. */
export const BRIDGE_ERROR = 'BRIDGE_ERROR';

// ─── Timeout ─────────────────────────────────────────────────────────────────

/** Operação excedeu o tempo limite. */
export const TIMEOUT = 'TIMEOUT';

/** Timeout específico de diálogo (turn/Promise.race). */
export const DIALOG_TIMEOUT = 'DIALOG_TIMEOUT';

// ─── Validação ───────────────────────────────────────────────────────────────

/** Dados de entrada falharam em validação de schema/formato. */
export const VALIDATION_ERROR = 'VALIDATION_ERROR';

// ─── FSM / Estado ────────────────────────────────────────────────────────────

/** Transição de estado inválida (ex: AgentContext FSM). */
export const STATE_TRANSITION = 'STATE_TRANSITION';

// ─── Dialog ──────────────────────────────────────────────────────────────────

/** Dialog loop não está ativo (turn rejeitado). */
export const DIALOG_NOT_ACTIVE = 'DIALOG_NOT_ACTIVE';

/** Fila de mensagens do dialog está cheia (backpressure). */
export const DIALOG_QUEUE_FULL = 'DIALOG_QUEUE_FULL';

// ─── LLM Bridge ──────────────────────────────────────────────────────────────

/** LLM-B está processando outra mensagem (busy). */
export const LLM_B_BUSY = 'LLM_B_BUSY';

/** LLM-B não está disponível (desconectado ou não iniciado). */
export const LLM_B_UNAVAILABLE = 'LLM_B_UNAVAILABLE';

// ─── Payload ─────────────────────────────────────────────────────────────────

/** Payload excedeu o tamanho máximo permitido. */
export const PAYLOAD_TOO_LARGE = 'PAYLOAD_TOO_LARGE';
