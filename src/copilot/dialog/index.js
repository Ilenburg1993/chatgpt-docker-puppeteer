// @ts-check
/**
 * src/copilot/dialog/index.js
 *
 * Barrel canônico do módulo `dialog/` — contrato READY/REPLY compartilhado entre runtime e fronteiras.
 *
 * @module copilot/dialog
 * @see EventBus
 */

export {
    DIALOG_PROTO_DONE,
    DIALOG_PROTO_READY,
    DIALOG_PROTO_REPLY,
    DIALOG_PROTO_STOPPED,
    DialogProtocol,
    MESSAGE_KIND,
} from './protocol.js';
