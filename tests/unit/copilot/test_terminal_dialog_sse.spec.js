// @ts-check
/**
 * tests/unit/copilot/test_terminal_dialog_sse.spec.js
 *
 * Contrato: terminal/dialog/sse.js
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { describe, it } from 'node:test';

describe("terminal/dialog/sse.js — contrato", () => {
    it("importa sem erros", async () => {
        const mod = await import("../../../src/copilot/terminal/dialog/sse.js");
        assert.ok(mod, "módulo deve carregar");
    });

    it("exporta broadcastSse", async () => {
        const mod = await import("../../../src/copilot/terminal/dialog/sse.js");
        assert.equal(typeof mod.broadcastSse !== "undefined", true, "broadcastSse deve estar exportado");
    });

    it("exporta CRITICAL_EVENTS", async () => {
        const mod = await import("../../../src/copilot/terminal/dialog/sse.js");
        assert.equal(typeof mod.CRITICAL_EVENTS !== "undefined", true, "CRITICAL_EVENTS deve estar exportado");
    });

});
