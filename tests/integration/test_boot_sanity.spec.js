import assert from 'node:assert';
import { describe, it } from 'node:test';
import path from 'node:path';
import fs from 'fs/promises';

describe('Boot Sequence Sanity Check (V2.0)', () => {
    it('should have MissionManager module available', async () => {
        const { MissionManager } = await import('#missions/mission_manager');
        assert.ok(MissionManager, 'MissionManager deveria estar disponível');
        assert.strictEqual(typeof MissionManager, 'function', 'MissionManager deveria ser uma classe');
    });

    it('should have WorkflowGenerator module available', async () => {
        const { WorkflowGenerator } = await import('#missions/workflow_generator');
        assert.ok(WorkflowGenerator, 'WorkflowGenerator deveria estar disponível');
        assert.strictEqual(typeof WorkflowGenerator, 'function', 'WorkflowGenerator deveria ser uma classe');
    });

    it('should have MissionStateManager module available', async () => {
        const { MissionStateManager, MISSION_STATUS } = await import('#missions/mission_state_manager');
        assert.ok(MissionStateManager, 'MissionStateManager deveria estar disponível');
        assert.ok(MISSION_STATUS, 'MISSION_STATUS deveria estar disponível');
        assert.strictEqual(typeof MISSION_STATUS.PENDING, 'string', 'Status PENDING deveria estar definido');
    });

    it('should have book_writing template available', async () => {
        const templatePath = path.join(import.meta.dirname, '../../src/missions/templates/book_writing.json');
        const exists = await fs
            .access(templatePath)
            .then(() => true)
            .catch(() => false);

        assert.ok(exists, 'Template book_writing.json deveria existir');

        // Valida estrutura do template
        const content = await fs.readFile(templatePath, 'utf8');
        const template = JSON.parse(content);

        assert.ok(template.id, 'Template deveria ter ID');
        assert.ok(template.workflow_template, 'Template deveria ter workflow_template');
        assert.ok(template.workflow_template.steps, 'Template deveria ter steps');
        assert.ok(template.params, 'Template deveria ter params');
    });

    it('should have missions REST API controller available', async () => {
        const missionsController = await import('#server/api/controllers/missions').then(m => m.default ?? m);
        assert.ok(missionsController, 'Missions controller deveria estar disponível');
        assert.strictEqual(
            typeof missionsController.setMissionManager,
            'function',
            'Controller deveria ter método setMissionManager'
        );
    });

    it('should have missions directory created', async () => {
        const missionsDir = path.join(import.meta.dirname, '../../missions');
        const exists = await fs
            .access(missionsDir)
            .then(() => true)
            .catch(() => false);

        assert.ok(exists, 'Diretório missions/ deveria existir');
    });

    it('should be able to create MissionManager instance with mocked dependencies', async () => {
        const { MissionManager } = await import('#missions/mission_manager');

        // Mock simples de Kernel e NERV
        const mockKernel = {
            executeTask: async () => {}
        };

        const mockNERV = {
            onReceive: () => {},
            emit: () => {},
            emitCommand: () => {},
            emitEvent: () => {}
        };

        // Cria instância
        const manager = new MissionManager({
            kernel: mockKernel,
            nerv: mockNERV
        });

        assert.ok(manager, 'MissionManager deveria ser instanciado');
        assert.ok(typeof manager.createMission === 'function', 'Deveria ter método createMission');
        assert.ok(typeof manager.executeMission === 'function', 'Deveria ter método executeMission');
        assert.ok(typeof manager.pauseMission === 'function', 'Deveria ter método pauseMission');
        assert.ok(typeof manager.resumeMission === 'function', 'Deveria ter método resumeMission');
    });

    it('should have OrchestratorEngine integrated in Kernel', async () => {
        const { createKernel } = await import('#kernel/kernel');

        assert.ok(createKernel, 'createKernel deveria estar disponível');
        assert.strictEqual(typeof createKernel, 'function', 'createKernel deveria ser função');
    });

    it('should have TaskExecutionOrchestrator module available', async () => {
        const { TaskExecutionOrchestrator } = await import('#kernel/task_execution_orchestrator');

        assert.ok(TaskExecutionOrchestrator, 'TaskExecutionOrchestrator deveria estar disponível');
        assert.strictEqual(
            typeof TaskExecutionOrchestrator,
            'function',
            'TaskExecutionOrchestrator deveria ser uma classe'
        );
    });

    it('should have OrchestratorEngine module available', async () => {
        const { OrchestratorEngine } = await import('#orchestrator/orchestrator_engine');

        assert.ok(OrchestratorEngine, 'OrchestratorEngine deveria estar disponível');
        assert.strictEqual(typeof OrchestratorEngine, 'function', 'OrchestratorEngine deveria ser uma classe');
    });
});
