// @ts-check
/**
 * Alias de compatibilidade para consumidores históricos.
 *
 * O motor real é o servidor LSP nativo do TypeScript 7. Os nomes `Tsserver*` permanecem temporariamente para não
 * ampliar a migração da API interna.
 */
export {
    NativeTypeScriptLspDaemon as TsserverDaemon,
    getNativeTypeScriptLspDaemon as getTsserverDaemon,
    startNativeTypeScriptLspDaemon as startTsserverDaemon,
    stopNativeTypeScriptLspDaemon as stopTsserverDaemon,
} from './tsgo-lsp-daemon.mjs';
