// @ts-check - Type checking rigoroso habilitado (arquivo core)
/**
 * Transformer identitário com trim defensivo para pipelines de contexto.
 *
 * @param {string|null|undefined} content
 * @returns {string}
 */
export default content => (content || '').trim();
