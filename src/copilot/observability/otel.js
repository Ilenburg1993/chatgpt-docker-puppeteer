// @ts-check
/**
 * src/copilot/observability/otel.js
 *
 * Configuração de OpenTelemetry para o CopilotClient.
 *
 * O SDK Copilot suporta OTEL nativo via `CopilotClientOptions.telemetry`:
 *
 * - Emite spans automáticos para sessões, mensagens, tool calls no CLI interno
 * - Suporte a exportação OTLP HTTP ou arquivo JSONL local
 *
 * Por padrão, exporta para `src/copilot/logs/otel-traces.jsonl`. Configurável via variáveis de ambiente:
 *
 * - `COPILOT_OTEL_DISABLED` — desabilitar completamente
 * - `COPILOT_OTEL_ENDPOINT` — OTLP HTTP endpoint (ex: http://localhost:4318)
 * - `COPILOT_OTEL_EXPORTER_TYPE` — `file` (padrão) ou `otlp-http`
 * - `COPILOT_OTEL_SOURCE_NAME` — nome da instrumentação (padrão: copilot-sdk-agent)
 * - `COPILOT_OTEL_CAPTURE_CONTENT` — capturar conteúdo de mensagens (padrão: false)
 *
 * @module copilot/observability/otel
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const LOGS_DIR = process.env['COPILOT_LOG_DIR']
    ? path.resolve(process.env['COPILOT_LOG_DIR'])
    : path.resolve(__dirname, '../logs');

const DEFAULT_TRACES_FILE = path.join(LOGS_DIR, 'otel-traces.jsonl');

/**
 * @typedef {object} TelemetryConfig
 * @property {string} [otlpEndpoint] - OTLP HTTP endpoint URL.
 * @property {string} [filePath] - Caminho do arquivo JSONL para exportação.
 * @property {string} [exporterType] - `"otlp-http"` ou `"file"`.
 * @property {string} [sourceName] - Nome da instrumentação.
 * @property {boolean} [captureContent] - Capturar conteúdo de mensagens nos spans.
 */

/**
 * Constrói a configuração de telemetria para `CopilotClient`.
 *
 * Retorna `undefined` se `COPILOT_OTEL_DISABLED=true`, desabilitando o OTEL completamente.
 *
 * @example
 *     const client = new CopilotClient({ telemetry: buildTelemetryConfig() });
 *
 * @returns {TelemetryConfig | undefined}
 */
export function buildTelemetryConfig() {
    if (process.env['COPILOT_OTEL_DISABLED'] === 'true') {
        return undefined;
    }

    const endpoint = process.env['COPILOT_OTEL_ENDPOINT'];
    const explicitExporterType = process.env['COPILOT_OTEL_EXPORTER_TYPE'];
    const sourceName = process.env['COPILOT_OTEL_SOURCE_NAME'] ?? 'copilot-sdk-agent';
    const captureContent = process.env['COPILOT_OTEL_CAPTURE_CONTENT'] === 'true';

    // Se endpoint definido → OTLP HTTP
    if (endpoint) {
        return {
            otlpEndpoint: endpoint,
            exporterType: explicitExporterType ?? 'otlp-http',
            sourceName,
            captureContent,
        };
    }

    // Padrão → exportação para arquivo local
    return {
        filePath: DEFAULT_TRACES_FILE,
        exporterType: 'file',
        sourceName,
        captureContent,
    };
}

/**
 * Verifica se OTEL está habilitado na configuração atual.
 *
 * @returns {boolean}
 */
export function isOtelEnabled() {
    return process.env['COPILOT_OTEL_DISABLED'] !== 'true';
}

/** Caminho padrão do arquivo de traces quando `exporterType = 'file'`. */
export const DEFAULT_OTEL_FILE = DEFAULT_TRACES_FILE;
