// @ts-check
/**
 * src/copilot/core/di-tokens.js — [L0] Tokens DI canônicos.
 *
 * Define todos os tokens DI do sistema copilot. Cada token representa uma dependência injetável via
 * `container.register(TOKEN, factory)`.
 *
 * Organizados por camada (L0→L6) para manter coerência com a arquitetura.
 *
 * @module copilot/core/di-tokens
 */

import { createToken } from './di.js';

// ═══════════════════════════════════════════════════════════════════════════════
// L0 — Core
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Logger para módulo core/shutdown.
 *
 * @type {import('./di.js').Token<Function>}
 */
export const SHUTDOWN_LOGGER = createToken('SHUTDOWN_LOGGER');

// ═══════════════════════════════════════════════════════════════════════════════
// L0 — DB
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Logger para módulo db/sqlite.
 *
 * @type {import('./di.js').Token<Function>}
 */
export const DB_LOGGER = createToken('DB_LOGGER');

// ═══════════════════════════════════════════════════════════════════════════════
// L1 — SDK
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Logger do SDK (proxy para observability/logger).
 *
 * @type {import('./di.js').Token<Function>}
 */
export const SDK_LOGGER = createToken('SDK_LOGGER');

/**
 * Factory de custom tools (injeta builder externo).
 *
 * @type {import('./di.js').Token<Function>}
 */
export const TOOLS_BUILDER = createToken('TOOLS_BUILDER');

// ═══════════════════════════════════════════════════════════════════════════════
// L1 — Audit
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Logger do audit pipeline.
 *
 * @type {import('./di.js').Token<Function>}
 */
export const AUDIT_LOGGER = createToken('AUDIT_LOGGER');

/**
 * Bus de eventos do audit (emitHook).
 *
 * @type {import('./di.js').Token<{
 *     emitHook: (name: string, sessionId: string, input: unknown, output?: unknown) => void;
 * }>}
 */
export const AUDIT_BUS = createToken('AUDIT_BUS');

// ═══════════════════════════════════════════════════════════════════════════════
// L3 — Tools / Bridges
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Agent ponte para LLM bridge client.
 *
 * @type {import('./di.js').Token<object>}
 */
export const BRIDGE_AGENT = createToken('BRIDGE_AGENT');

/**
 * Agent fallback para orchestrator.
 *
 * @type {import('./di.js').Token<object>}
 */
export const FALLBACK_AGENT = createToken('FALLBACK_AGENT');

/**
 * ConversationHub singleton.
 *
 * @type {import('./di.js').Token<object>}
 */
export const HUB = createToken('HUB');

/**
 * Agent de permissões.
 *
 * @type {import('./di.js').Token<object>}
 */
export const PERMISSION_AGENT = createToken('PERMISSION_AGENT');

/**
 * Session RPC facade.
 *
 * @type {import('./di.js').Token<unknown>}
 */
export const SESSION_RPC = createToken('SESSION_RPC');

/**
 * Agent para nerv-bridge (AlwaysAliveAgent-like).
 *
 * @type {import('./di.js').Token<object>}
 */
export const NERV_BRIDGE_AGENT = createToken('NERV_BRIDGE_AGENT');

// ═══════════════════════════════════════════════════════════════════════════════
// L0 — Event Bus
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Event bus cross-module centralizado.
 *
 * @type {import('./di.js').Token<import('./event-bus.js').EventBus>}
 */
export const EVENT_BUS = createToken('EVENT_BUS');

// ═══════════════════════════════════════════════════════════════════════════════
// L2 — Infra / Storage
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Repositório de conversas (SQLite store ou in-memory).
 *
 * @type {import('./di.js').Token<object>}
 */
export const CONVERSATION_STORE = createToken('CONVERSATION_STORE');

/**
 * Repositório de métricas de sessão.
 *
 * @type {import('./di.js').Token<object>}
 */
export const METRICS_STORE = createToken('METRICS_STORE');

/**
 * Pipeline de auditoria (ingesta, flush, drain).
 *
 * @type {import('./di.js').Token<object>}
 */
export const AUDIT_PIPELINE = createToken('AUDIT_PIPELINE');

/**
 * Tracker de erros (error collector/aggregator).
 *
 * @type {import('./di.js').Token<object>}
 */
export const ERROR_TRACKER = createToken('ERROR_TRACKER');

/**
 * Coletor de eventos de observabilidade.
 *
 * @type {import('./di.js').Token<object>}
 */
export const EVENT_COLLECTOR = createToken('EVENT_COLLECTOR');

// ═══════════════════════════════════════════════════════════════════════════════
// L3 — Agent / Dialog
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Motor de diálogo (loop-manager de alto nível).
 *
 * @type {import('./di.js').Token<object>}
 */
export const DIALOG_ENGINE = createToken('DIALOG_ENGINE');

/**
 * Agente AlwaysAlive (singleton gerenciado por DI).
 *
 * @type {import('./di.js').Token<object>}
 */
export const ALWAYS_ALIVE_AGENT = createToken('ALWAYS_ALIVE_AGENT');

/**
 * Namespace Socket.IO para comunicação real-time.
 *
 * @type {import('./di.js').Token<object>}
 */
export const SOCKET_NAMESPACE = createToken('SOCKET_NAMESPACE');

/**
 * InjectServer — servidor de injeção de prompts.
 *
 * @type {import('./di.js').Token<object>}
 */
export const INJECT_SERVER = createToken('INJECT_SERVER');

// ═══════════════════════════════════════════════════════════════════════════════
// L4 — Services
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Service de gerenciamento de sessões de agente.
 *
 * @type {import('./di.js').Token<object>}
 */
export const SESSION_SERVICE = createToken('SESSION_SERVICE');

/**
 * Service de conversas (orquestração de criação/busca/remoção).
 *
 * @type {import('./di.js').Token<object>}
 */
export const CONVERSATION_SERVICE = createToken('CONVERSATION_SERVICE');

/**
 * Service de agente (operações sobre AlwaysAliveAgent via services/).
 *
 * @type {import('./di.js').Token<object>}
 */
export const AGENT_SERVICE = createToken('AGENT_SERVICE');

/**
 * Service de diálogo (via services/).
 *
 * @type {import('./di.js').Token<object>}
 */
export const DIALOG_SERVICE = createToken('DIALOG_SERVICE');

// ═══════════════════════════════════════════════════════════════════════════════
// L2 — Infra / Rate / Cache / Lock
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Gerenciador de rate-limit (throttle/debounce centralizado).
 *
 * @type {import('./di.js').Token<object>}
 */
export const RATE_LIMITER = createToken('RATE_LIMITER');

/**
 * Gerenciador de cache em memória.
 *
 * @type {import('./di.js').Token<object>}
 */
export const CACHE_MANAGER = createToken('CACHE_MANAGER');

/**
 * Pool de mutexes de exclusão mútua.
 *
 * @type {import('./di.js').Token<object>}
 */
export const MUTEX_POOL = createToken('MUTEX_POOL');

/**
 * Registro de timers ativos (para cancel-all no shutdown).
 *
 * @type {import('./di.js').Token<object>}
 */
export const TIMER_REGISTRY = createToken('TIMER_REGISTRY');

// ═══════════════════════════════════════════════════════════════════════════════
// L5 — Infra / Plugins / Registry
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Registro de plugins dinâmicos.
 *
 * @type {import('./di.js').Token<object>}
 */
export const PLUGIN_REGISTRY = createToken('PLUGIN_REGISTRY');

/**
 * Registro de circuit breakers ativos.
 *
 * @type {import('./di.js').Token<object>}
 */
export const CIRCUIT_BREAKER_REGISTRY = createToken('CIRCUIT_BREAKER_REGISTRY');

/**
 * Tracer OpenTelemetry (noop se OTEL desabilitado).
 *
 * @type {import('./di.js').Token<object>}
 */
export const OTEL_TRACER = createToken('OTEL_TRACER');

// ═══════════════════════════════════════════════════════════════════════════════
// L3 — Observability / Alerting
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Gerenciador de alertas e notificações de saúde.
 *
 * @type {import('./di.js').Token<object>}
 */
export const ALERTS_MANAGER = createToken('ALERTS_MANAGER');

/**
 * Monitor de quota do SDK (Faixa 25).
 *
 * @type {import('./di.js').Token<object>}
 */
export const QUOTA_MONITOR = createToken('QUOTA_MONITOR');

/**
 * Logger raiz (root logger do sistema).
 *
 * @type {import('./di.js').Token<Function>}
 */
export const ROOT_LOGGER = createToken('ROOT_LOGGER');

/**
 * Configuração de runtime (config.json parseado + validado).
 *
 * @type {import('./di.js').Token<object>}
 */
export const APP_CONFIG = createToken('APP_CONFIG');

/**
 * Controle de fluxo de missões (controle.json).
 *
 * @type {import('./di.js').Token<object>}
 */
export const MISSION_CONTROL = createToken('MISSION_CONTROL');

/**
 * Gerenciador de saúde do sistema (health check aggregator).
 *
 * @type {import('./di.js').Token<object>}
 */
export const HEALTH_MANAGER = createToken('HEALTH_MANAGER');

/**
 * Worker pool para tarefas paralelas.
 *
 * @type {import('./di.js').Token<object>}
 */
export const WORKER_POOL = createToken('WORKER_POOL');


