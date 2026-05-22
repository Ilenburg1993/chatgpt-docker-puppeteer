// @ts-check
/**
 * Especificacoes puras dos comandos locais expostos ao SDK como `CommandDefinition[]`.
 *
 * A lista mora em `config/` porque e contrato estatico compartilhado entre o agent, que materializa os handlers do
 * SDK, e o terminal, que apenas exibe o catalogo operacional. Nenhum dos lados precisa importar o outro.
 *
 * @module copilot/config/terminal-sdk-command-specs
 */

const TERMINAL_SDK_COMMAND_SPECS = Object.freeze([
    {
        name: 'terminal_status',
        description: 'Mostra um snapshot operacional do terminal LLM-B.',
        localCommand: '/status',
        safe: true,
    },
    {
        name: 'terminal_health',
        description: 'Executa diagnostico de saude do runtime, IO, SDK e lifecycle.',
        localCommand: '/health',
        safe: true,
    },
    {
        name: 'terminal_session',
        description: 'Mostra o cockpit da sessao SDK viva, sessao preparada e boundary BYOK.',
        localCommand: '/session sdk',
        safe: true,
    },
    {
        name: 'terminal_session_events',
        description: 'Resume lifecycle e comandos SDK a partir do archive SSE canonico.',
        localCommand: '/session sdk events',
        safe: true,
    },
    {
        name: 'terminal_session_waits',
        description: 'Resume ask_user, elicitation e permission a partir do archive SSE canonico.',
        localCommand: '/session sdk waits',
        safe: true,
    },
    {
        name: 'terminal_byok',
        description: 'Mostra status BYOK, provider preparado, binding vivo e health resumido.',
        localCommand: '/byok status',
        safe: true,
    },
    {
        name: 'terminal_events',
        description: 'Mostra o archive recente de eventos canonicos do terminal.',
        localCommand: '/events',
        safe: true,
    },
]);

/**
 * @returns {{ name: string; description: string; localCommand: string; safe: boolean }[]}
 */
export function listTerminalSdkCommandSpecs() {
    return TERMINAL_SDK_COMMAND_SPECS.map((spec) => ({ ...spec }));
}
