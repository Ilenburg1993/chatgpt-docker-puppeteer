// @ts-check
/**
 * tests/unit/copilot/test_terminal_file_context.spec.js
 *
 * Contrato: terminal/file-context.js
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

describe("terminal/file-context.js — contrato", () => {
    it("importa sem erros", async () => {
        const mod = await import("../../../src/copilot/terminal/file-context.js");
        assert.ok(mod, "módulo deve carregar");
    });

    it("exporta getFileCacheStats", async () => {
        const mod = await import("../../../src/copilot/terminal/file-context.js");
        assert.equal(typeof mod.getFileCacheStats !== "undefined", true, "getFileCacheStats deve estar exportado");
    });

    it("exporta clearFileCache", async () => {
        const mod = await import("../../../src/copilot/terminal/file-context.js");
        assert.equal(typeof mod.clearFileCache !== "undefined", true, "clearFileCache deve estar exportado");
    });

});
