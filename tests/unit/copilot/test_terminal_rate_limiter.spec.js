// @ts-check
/**
 * tests/unit/copilot/test_terminal_rate_limiter.spec.js
 *
 * Contrato: terminal/rate-limiter-state.js
 */

import assert from "node:assert/strict";
import { describe, it } from 'node:test';
describe("terminal/rate-limiter-state.js — contrato", () => {
    it("importa sem erros", async () => {
        const mod = await import("../../../src/copilot/terminal/rate-limiter-state.js");
        assert.ok(mod, "módulo deve carregar");
    });

    it("exporta clearRateLimiters", async () => {
        const mod = await import("../../../src/copilot/terminal/rate-limiter-state.js");
        assert.equal(typeof mod.clearRateLimiters !== "undefined", true, "clearRateLimiters deve estar exportado");
    });

    it("exporta registerClearRateLimiters", async () => {
        const mod = await import("../../../src/copilot/terminal/rate-limiter-state.js");
        assert.equal(typeof mod.registerClearRateLimiters !== "undefined", true, "registerClearRateLimiters deve estar exportado");
    });

});
