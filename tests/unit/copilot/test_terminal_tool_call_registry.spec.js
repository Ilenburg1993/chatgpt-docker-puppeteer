// @ts-check
/**
 * tests/unit/copilot/test_terminal_tool_call_registry.spec.js
 *
 * Contrato: src/copilot/terminal/state/tool-call-registry.js
 *
 * Cobre:
 *
 * - register / getEntry / complete
 * - isInFlight / isNameInFlight / wasRecentlyCompleted
 * - resolveByRequestId / resolveNameByRequestId
 * - pruning de entradas expiradas
 * - clear em session.shutdown
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { createToolCallRegistry } from '../../../src/copilot/terminal/state/tool-call-registry.js';

describe('createToolCallRegistry', () => {
    it('exporta factory function', async () => {
        const mod = await import('../../../src/copilot/terminal/state/tool-call-registry.js');
        expect(typeof mod.createToolCallRegistry).toBe('function');
    });

    describe('interface retornada', () => {
        /** @type {ReturnType<typeof createToolCallRegistry>} */
        let registry;

        beforeEach(() => {
            registry = createToolCallRegistry();
        });

        it('começa vazio — nenhuma tool in-flight', () => {
            expect(registry.getAllInFlight()).toHaveLength(0);
        });

        it('register retorna entry com campos corretos', () => {
            const entry = registry.register('call-1', 'read_file', 'native');
            expect(entry.toolCallId).toBe('call-1');
            expect(entry.toolName).toBe('read_file');
            expect(entry.kind).toBe('native');
            expect(entry.requestId).toBeNull();
            expect(entry.completedAt).toBeNull();
            expect(entry.success).toBeNull();
        });

        it('register com requestId mapeia no índice de requestId', () => {
            registry.register('call-ext-1', 'browser_action', 'external', { requestId: 'req-abc' });
            const found = registry.resolveByRequestId('req-abc');
            expect(found).not.toBeNull();
            expect(found?.toolName).toBe('browser_action');
        });

        it('getEntry retorna entry in-flight', () => {
            registry.register('call-2', 'write_file', 'native');
            const entry = registry.getEntry('call-2');
            expect(entry?.toolCallId).toBe('call-2');
        });

        it('getEntry retorna null para id desconhecido', () => {
            expect(registry.getEntry('nao-existe')).toBeNull();
        });

        it('isInFlight retorna true para id registrado', () => {
            registry.register('call-3', 'list_dir', 'native');
            expect(registry.isInFlight('call-3')).toBe(true);
        });

        it('isInFlight retorna false para id desconhecido', () => {
            expect(registry.isInFlight('nao-existe')).toBe(false);
        });

        it('isNameInFlight retorna true quando tool com esse nome está em voo', () => {
            registry.register('call-4', 'grep_search', 'native');
            expect(registry.isNameInFlight('grep_search')).toBe(true);
        });

        it('isNameInFlight retorna false quando tool não está em voo', () => {
            expect(registry.isNameInFlight('tool-inexistente')).toBe(false);
        });

        it('complete move entry para recently-completed', () => {
            registry.register('call-5', 'bash', 'native');
            expect(registry.isInFlight('call-5')).toBe(true);

            const completed = registry.complete('call-5', true);
            expect(completed?.toolCallId).toBe('call-5');
            expect(completed?.success).toBe(true);
            expect(completed?.completedAt).not.toBeNull();
            expect(registry.isInFlight('call-5')).toBe(false);
        });

        it('wasRecentlyCompleted retorna true após complete', () => {
            registry.register('call-6', 'bash', 'native');
            registry.complete('call-6', true);
            expect(registry.wasRecentlyCompleted('call-6')).toBe(true);
        });

        it('wasRecentlyCompleted retorna false para id nunca registrado', () => {
            expect(registry.wasRecentlyCompleted('fantasma')).toBe(false);
        });

        it('wasRecentlyCompleted por requestId', () => {
            registry.register('call-7', 'external_tool', 'external', { requestId: 'req-xyz' });
            registry.complete('call-7', false);
            expect(registry.wasRecentlyCompleted('call-7', 'req-xyz')).toBe(true);
            expect(registry.wasRecentlyCompleted('nao-id', 'req-xyz')).toBe(true);
        });

        it('complete retorna null para id desconhecido', () => {
            const result = registry.complete('call-fantasma', true);
            expect(result).toBeNull();
        });

        it('getAllInFlight retorna apenas entradas em voo', () => {
            registry.register('call-a', 'tool_a', 'native');
            registry.register('call-b', 'tool_b', 'native');
            registry.complete('call-a', true);
            const inFlight = registry.getAllInFlight();
            expect(inFlight).toHaveLength(1);
            expect(inFlight[0]?.toolCallId).toBe('call-b');
        });

        it('updateProgress atualiza lastProgress na entry ativa', () => {
            registry.register('call-p', 'tool_progress', 'native');
            registry.updateProgress('call-p', 42, 'carregando...');
            const entry = registry.getEntry('call-p');
            expect(entry?.lastProgress).toBe(42);
            expect(entry?.lastProgressMessage).toBe('carregando...');
        });

        it('markRequestIdForExternalTool / resolveNameByRequestId', () => {
            registry.markRequestIdForExternalTool('req-999', 'my_mcp_tool');
            expect(registry.resolveNameByRequestId('req-999')).toBe('my_mcp_tool');
        });

        it('resolveNameByRequestId retorna null para requestId nulo', () => {
            expect(registry.resolveNameByRequestId(null)).toBeNull();
        });

        it('resolveByName usa nome bruto e canônico para recuperar entrada ativa', () => {
            registry.register('call-name-1', 'workspace.read_file', 'native', { canonicalName: 'read_file_content' });
            expect(registry.resolveByName('workspace.read_file')?.toolCallId).toBe('call-name-1');
            expect(registry.resolveByName('read_file_content')?.toolCallId).toBe('call-name-1');
            expect(registry.resolveByName('missing')).toBeNull();
        });

        it('resolveSingleInFlight só retorna quando há uma única entrada ativa do tipo solicitado', () => {
            registry.register('call-one', 'read_file_content', 'native');
            expect(registry.resolveSingleInFlight('native')?.toolCallId).toBe('call-one');
            registry.register('call-two', 'patch_file', 'native');
            expect(registry.resolveSingleInFlight('native')).toBeNull();
            expect(registry.resolveSingleInFlight('external')).toBeNull();
        });

        it('clear remove todo o estado', () => {
            registry.register('call-z1', 'tool_z', 'native', { requestId: 'req-z1' });
            registry.register('call-z2', 'tool_z', 'native');
            registry.complete('call-z2', true);
            registry.markRequestIdForExternalTool('req-z2', 'ext_z');

            registry.clear();

            expect(registry.getAllInFlight()).toHaveLength(0);
            expect(registry.isInFlight('call-z1')).toBe(false);
            expect(registry.wasRecentlyCompleted('call-z2')).toBe(false);
            expect(registry.resolveByRequestId('req-z1')).toBeNull();
            expect(registry.resolveNameByRequestId('req-z2')).toBeNull();
        });

        it('suporta múltiplas tools com mesmo nome em concorrência', () => {
            registry.register('call-c1', 'bash', 'native');
            registry.register('call-c2', 'bash', 'native');
            expect(registry.isNameInFlight('bash')).toBe(true);
            expect(registry.getAllInFlight()).toHaveLength(2);

            registry.complete('call-c1', true);
            // ainda há um bash em voo
            expect(registry.isNameInFlight('bash')).toBe(true);

            registry.complete('call-c2', true);
            expect(registry.isNameInFlight('bash')).toBe(false);
        });

        it('isNameInFlight verifica canonicalName também', () => {
            registry.register('call-d1', 'str_replace_editor', 'native', { canonicalName: 'edit' });
            expect(registry.isNameInFlight('edit')).toBe(true);
            expect(registry.isNameInFlight('str_replace_editor')).toBe(true);
        });
    });
});
