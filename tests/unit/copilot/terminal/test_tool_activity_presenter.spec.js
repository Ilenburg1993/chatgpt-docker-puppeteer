// @ts-check

import { describe, expect, it } from 'vitest';

import {
    buildTerminalToolActivityPresentation,
    compactTerminalDiagnosticId,
    compactTerminalOperatorToolText,
    formatTerminalToolPathForOperator,
    getTerminalHumanToolName,
    humanizeTerminalToolSurfaceText,
    isTerminalInternalCallIdentifier,
} from '../../../../src/copilot/terminal/events/tool-activity-presenter.js';

describe('terminal/tool-activity-presenter', () => {
    it('expõe helpers canônicos para diagnósticos humanos sem duplicar glossário', () => {
        expect(getTerminalHumanToolName('read_file_content')).toBe('Ler arquivo');
        expect(getTerminalHumanToolName('report_intent_local')).toBe('Intenção capturada');
        expect(getTerminalHumanToolName('workspace.read_file')).toBe('Ler arquivo');
        expect(getTerminalHumanToolName('write_file_content')).toBe('Escrever arquivo');
        expect(getTerminalHumanToolName('repo_apply_patch')).toBe('Aplicar patch');
        expect(getTerminalHumanToolName('repo_apply_file_batch')).toBe('Aplicar lote de arquivos');
        expect(getTerminalHumanToolName('read_bash')).toBe('Ler terminal');
        expect(getTerminalHumanToolName('io.mkdir.io-engine.ensure-dir')).toBe('Pasta local');
        expect(getTerminalHumanToolName('io.write.io-engine.atomic-write')).toBe('Escrita local');
        expect(getTerminalHumanToolName('io.search.io-engine.rg.search')).toBe('Busca local');
        expect(getTerminalHumanToolName('bridge.git.diff')).toBe('Git diff');
        expect(getTerminalHumanToolName('shell.exec_command')).toBe('Executar comando');
        expect(getTerminalHumanToolName('tool.fast')).toBe('tool.fast');
        expect(isTerminalInternalCallIdentifier('chatcmpl-tool-80d5a00b25801fef')).toBe(true);
        expect(isTerminalInternalCallIdentifier('toolu_bdrk_019v9X862pjamNysAemC1UAW')).toBe(true);
        expect(compactTerminalDiagnosticId('chatcmpl-tool-80d5a00b25801fef')).toBe('chatcmpl-too…');
    });

    it('humaniza superfícies default sem vazar nomes internos ou ids de chamada', () => {
        const text = humanizeTerminalToolSurfaceText(
            'LLM-B tool/Executando tool · request_user_input ainda executando · report_intent_local · read_file_content · chatcmpl-tool-80d5a00b25801fef · toolu_bdrk_123',
        );

        expect(text).toContain('LLM-B ferramenta');
        expect(text).toContain('Pergunta ao operador aguardando resposta');
        expect(text).toContain('Intenção capturada');
        expect(text).toContain('Ler arquivo');
        expect(text).not.toContain('request_user_input');
        expect(text).not.toContain('report_intent');
        expect(text).not.toContain('read_file_content');
        expect(text).not.toContain('chatcmpl-tool');
        expect(text).not.toContain('toolu_bdrk');
    });

    it('preserva nomes de protocolo quando eles fazem parte de conteúdo livre', () => {
        const text = humanizeTerminalToolSurfaceText('intenção: testar ask_user e request_user_input no prompt', {
            preserveProtocolNames: true,
        });

        expect(text).toContain('ask_user');
        expect(text).toContain('request_user_input');
        expect(text).not.toContain('Pergunta ao operador');
    });

    it('usa nome humano para alias legado e mantém operação canônica inferida', () => {
        const presentation = buildTerminalToolActivityPresentation({
            toolName: 'view',
            args: { path: 'src/copilot/terminal/repl/live-status-line.js' },
        });

        expect(presentation.toolName).toBe('view');
        expect(presentation.canonicalToolName).toBe('read_file_content');
        expect(presentation.displayToolName).toBe('Ler arquivo');
        expect(presentation.operation).toBe('read');
        expect(presentation.detail).toContain('lendo arquivo');
        expect(presentation.progressLinePrefix).toContain('Ler arquivo');
        expect(presentation.progressLinePrefix).not.toContain('alias');
    });

    it('não adiciona ruído de alias para tool já canônica', () => {
        const presentation = buildTerminalToolActivityPresentation({
            toolName: 'read_file_content',
            args: { path: 'src/copilot/terminal/state/activity-state.js' },
        });

        expect(presentation.canonicalToolName).toBe('read_file_content');
        expect(presentation.displayToolName).toBe('Ler arquivo');
        expect(presentation.detail).not.toContain('alias');
    });

    it('mostra request_user_input como espera humana com preview da pergunta', () => {
        const presentation = buildTerminalToolActivityPresentation({
            toolName: 'request_user_input',
            args: { question: 'Qual caminho seguir?' },
        });

        expect(presentation.displayToolName).toBe('Pergunta ao operador');
        expect(presentation.operation).toBe('ask');
        expect(presentation.detail).toContain('aguardando decisão humana');
        expect(presentation.startLine).toContain('Qual caminho seguir?');
        expect(presentation.questionChoices).toEqual([]);
        expect(presentation.allowFreeformQuestion).toBeNull();
        expect(presentation.completeLine(true, '1.0s')).toContain('aguardando decisão humana concluído');
    });

    it('carrega opções estruturadas de request_user_input para o card humano', () => {
        const presentation = buildTerminalToolActivityPresentation({
            toolName: 'request_user_input',
            args: {
                question: 'Como continuar?',
                choices: ['seguir', 'pausar'],
                allowFreeform: false,
            },
        });

        expect(presentation.displayToolName).toBe('Pergunta ao operador');
        expect(presentation.operation).toBe('ask');
        expect(presentation.target).toBe('Como continuar?');
        expect(presentation.questionChoices).toEqual(['seguir', 'pausar']);
        expect(presentation.allowFreeformQuestion).toBe(false);
    });

    it('mostra ask_user como pergunta humana mesmo quando vem do hook SDK', () => {
        const presentation = buildTerminalToolActivityPresentation({
            toolName: 'ask_user',
            args: { question: 'ASK-CANONICAL: responda SIM para fechar o teste' },
        });

        expect(presentation.displayToolName).toBe('Pergunta ao operador');
        expect(presentation.operation).toBe('ask');
        expect(presentation.detail).toContain('aguardando decisão humana');
        expect(presentation.detail).toContain('ASK-CANONICAL');
        expect(presentation.completeLine(false, 'n/d')).toContain('aguardando decisão humana falhou');
        expect(presentation.completeLine(false, 'n/d')).not.toContain('tool genérica');
    });

    it('usa fallback humano para ferramenta sem classificação conhecida', () => {
        const presentation = buildTerminalToolActivityPresentation({
            toolName: 'vendor_unknown_action',
            args: { value: true },
        });

        expect(presentation.operation).toBe('inspect');
        expect(presentation.detail).toContain('executando ferramenta não classificada');
        expect(presentation.detail).not.toContain('tool genérica');
    });

    it('classifica exec_command como execução mesmo quando o cwd aparece como alvo', () => {
        const presentation = buildTerminalToolActivityPresentation({
            toolName: 'exec_command',
            args: {
                command: "node -e \"console.log('ok')\"",
                cwd: '/workspaces/chatgpt-docker-puppeteer',
            },
        });

        expect(presentation.displayToolName).toBe('Executar comando');
        expect(presentation.operation).toBe('run');
        expect(presentation.detail).toContain('executando comando');
        expect(presentation.detail).toContain("node -e \"console.log('ok')\"");
        expect(presentation.target).toBe("node -e \"console.log('ok')\"");
        expect(presentation.path).toBeNull();
        expect(presentation.fileTargets).toEqual([]);
        expect(presentation.directoryTargets).toEqual(['/workspaces/chatgpt-docker-puppeteer']);
        expect(presentation.primaryTargetKind).toBe('command');
        expect(presentation.detail).not.toContain('operando arquivo');
    });

    it('extrai comando de arguments JSON serializado sem cair em ferramenta genérica', () => {
        const presentation = buildTerminalToolActivityPresentation({
            toolName: 'external_tool',
            arguments: JSON.stringify({
                toolName: 'exec_command',
                command: 'git status --short',
                cwd: '/workspaces/chatgpt-docker-puppeteer',
            }),
            toolCallId: 'chatcmpl-tool-json-args',
        });

        expect(presentation.toolName).toBe('exec_command');
        expect(presentation.displayToolName).toBe('Executar comando');
        expect(presentation.operation).toBe('run');
        expect(presentation.target).toBe('git status --short');
        expect(presentation.commands).toEqual(['git status --short']);
        expect(presentation.detail).not.toContain('chatcmpl-tool');
    });

    it('usa toolResult textResultForLlm para enriquecer conclusão de leitura', () => {
        const presentation = buildTerminalToolActivityPresentation({
            toolName: 'read_file_content',
            args: { path: 'src/copilot/terminal/events/tool-activity-presenter.js' },
            toolResult: {
                resultType: 'success',
                textResultForLlm: JSON.stringify({
                    success: true,
                    count: 1,
                    returnedLines: { start: 20, end: 28 },
                }),
            },
        });

        expect(presentation.lineRange).toEqual({ start: 20, end: 28 });
        expect(presentation.resultCount).toBe(1);
        expect(presentation.resultSummary).toBe('sucesso · 1 resultado');
        expect(presentation.completeLine(true, '0.1s')).toContain('linhas 20-28');
        expect(presentation.completeLine(true, '0.1s')).toContain('sucesso · 1 resultado');
    });

    it('prefere presentation estruturado de tool result quando disponível', () => {
        const presentation = buildTerminalToolActivityPresentation({
            toolName: 'patch_file',
            result: {
                success: true,
                presentation: {
                    operation: 'patch',
                    path: 'src/copilot/tools/file/write/patch-file.js',
                    summary: 'Patch aplicado: 1/1 ocorrencias · linhas 20-20 · +4 bytes · +0 linhas',
                },
            },
        });

        expect(presentation.operation).toBe('edit');
        expect(presentation.path).toBe('src/copilot/tools/file/write/patch-file.js');
        expect(presentation.resultSummary).toBe(
            'Patch aplicado: 1/1 ocorrencias · linhas 20-20 · +4 bytes · +0 linhas',
        );
        expect(presentation.completeLine(true, '0.1s')).toContain('Patch aplicado: 1/1 ocorrencias');
    });

    it('deduplica arquivos vindos simultaneamente de args e result', () => {
        const path = 'data/copilot-terminal/live-scratch/TERMINAL-PATCH-ROUNDTRIP.txt';
        const presentation = buildTerminalToolActivityPresentation({
            toolName: 'patch_file',
            args: { path },
            result: {
                success: true,
                path: `${process.cwd()}/${path}`,
                presentation: {
                    path: `${process.cwd()}/${path}`,
                    summary: 'Patch aplicado: 1/1 ocorrencias',
                },
            },
        });

        expect(presentation.fileTargets).toEqual([path]);
        expect(presentation.completeLine(true, '0.1s')).toContain(`arquivo: ${path}`);
        expect(presentation.completeLine(true, '0.1s')).not.toContain(`${path}, ${path}`);
    });

    it('resume read_file_content com bytes e truncamento sem poluir a superfície com conteúdo bruto', () => {
        const presentation = buildTerminalToolActivityPresentation({
            toolName: 'read_file_content',
            args: { path: `${process.cwd()}/src/copilot/terminal/events/tool-activity-presenter.js` },
            result: {
                success: true,
                path: `${process.cwd()}/src/copilot/terminal/events/tool-activity-presenter.js`,
                returnedLines: { start: 1, end: 40 },
                bytesReturned: 4096,
                truncated: true,
                content: 'x'.repeat(10_000),
            },
        });

        expect(presentation.operation).toBe('read');
        expect(presentation.target).toContain('src/copilot/terminal/events/tool-activity-presenter.js');
        expect(presentation.target).toContain('linhas 1-40');
        expect(presentation.resultSummary).toBe('sucesso · 4.0 KB · truncado');
        expect(presentation.completeLine(true, '0.2s')).toContain('sucesso · 4.0 KB · truncado');
        expect(presentation.detail).not.toContain('x'.repeat(80));
    });

    it('mostra list_tools como listagem humana com filtro e contagem materializada', () => {
        const presentation = buildTerminalToolActivityPresentation({
            toolName: 'list_tools',
            args: { category: 'code', search: 'terminal' },
            result: { success: true, count: 18 },
        });

        expect(presentation.displayToolName).toBe('Listar tools');
        expect(presentation.operation).toBe('list');
        expect(presentation.target).toContain('busca: terminal');
        expect(presentation.target).toContain('category: code');
        expect(presentation.resultCount).toBe(18);
        expect(presentation.completeLine(true, '0.1s')).toContain('18 resultados');
    });

    it('enriquece leitura com range efetivamente retornado no resultado', () => {
        const absolutePackagePath = `${process.cwd()}/package.json`;
        const presentation = buildTerminalToolActivityPresentation({
            toolName: 'read_file_content',
            args: { path: absolutePackagePath, startLine: 10 },
            result: {
                success: true,
                path: absolutePackagePath,
                returnedLines: { start: 10, end: 18 },
            },
        });

        expect(presentation.operation).toBe('read');
        expect(presentation.target).toContain('linhas 10-18');
        expect(presentation.target).toContain('package.json');
        expect(presentation.target).not.toContain(process.cwd());
        expect(presentation.lineRange).toEqual({ start: 10, end: 18 });
        expect(presentation.completeLine(true, '0.2s')).toContain('linhas 10-18');
    });

    it('normaliza paths absolutos de workspace apenas na superfície humana', () => {
        const absolute = `${process.cwd()}/src/copilot/terminal/events/tool-activity-presenter.js`;

        expect(formatTerminalToolPathForOperator(absolute)).toBe(
            'src/copilot/terminal/events/tool-activity-presenter.js',
        );
        expect(compactTerminalOperatorToolText(`arquivo: ${absolute} · linhas 1-3`, 180)).toContain(
            'arquivo: src/copilot/terminal/events/tool-activity-presenter.js · linhas 1-3',
        );
    });

    it('classifica tools de introspecção sem badge UNKNOWN', () => {
        const workspace = buildTerminalToolActivityPresentation({
            toolName: 'get_workspace_info',
            args: {},
        });
        const telemetry = buildTerminalToolActivityPresentation({
            toolName: 'get_telemetry',
            args: {},
        });
        const intent = buildTerminalToolActivityPresentation({
            toolName: 'report_intent',
            args: { intent: 'validar UX do terminal' },
        });

        expect(workspace.canonicalToolName).toBe('get_workspace_info');
        expect(workspace.operation).toBe('inspect');
        expect(workspace.detail).toContain('inspecionando contexto');
        expect(telemetry.operation).toBe('inspect');
        expect(intent.canonicalToolName).toBe('report_intent_local');
        expect(intent.displayToolName).toBe('Intenção capturada');
        expect(intent.operation).toBe('intent');
    });

    it('usa intent como alvo visual e não vaza id interno de report_intent', () => {
        const presentation = buildTerminalToolActivityPresentation({
            toolName: 'report_intent',
            args: { intent: 'validar estética do terminal' },
            toolCallId: 'toolu_bdrk_019v9X862pjamNysAemC1UAW',
        });

        expect(presentation.displayToolName).toBe('Intenção capturada');
        expect(presentation.target).toBe('validar estética do terminal');
        expect(presentation.detail).toContain('validar estética do terminal');
        expect(presentation.detail).not.toContain('toolu_bdrk');
        expect(presentation.startLine).not.toContain('toolu_bdrk');
    });

    it('não usa toolCallId/requestId como target visual default', () => {
        const presentation = buildTerminalToolActivityPresentation({
            toolName: 'external_tool',
            requestId: 'chatcmpl-tool-80d5a00b25801fef',
            toolCallId: 'toolu_bdrk_019v9X862pjamNysAemC1UAW',
        });

        expect(presentation.target).toBeNull();
        expect(presentation.detail).not.toContain('chatcmpl-tool');
        expect(presentation.detail).not.toContain('toolu_bdrk');
    });

    it('ignora nomes genéricos do SDK quando há fallback real', () => {
        const presentation = buildTerminalToolActivityPresentation(
            {
                toolName: 'unknown',
                args: { path: 'src/copilot/terminal/events/tool-activity-presenter.js' },
            },
            'read_file_content',
        );

        expect(presentation.toolName).toBe('read_file_content');
        expect(presentation.canonicalToolName).toBe('read_file_content');
        expect(presentation.operation).toBe('read');
        expect(presentation.detail).toContain('lendo arquivo');
    });

    it('recupera identidade real de tool em payloads SDK aninhados', () => {
        const fromData = buildTerminalToolActivityPresentation({
            toolName: 'external_tool',
            data: {
                toolName: 'patch_file',
                args: { path: 'src/copilot/terminal/dialog/engine.js' },
            },
        });
        const fromJsonArguments = buildTerminalToolActivityPresentation({
            name: 'unknown',
            arguments: JSON.stringify({
                mcpToolName: 'read_file_content',
                path: 'src/copilot/terminal/events/sdk-session-events.js',
            }),
        });

        expect(fromData.toolName).toBe('patch_file');
        expect(fromData.operation).toBe('edit');
        expect(fromJsonArguments.toolName).toBe('read_file_content');
        expect(fromJsonArguments.operation).toBe('read');
    });

    it('classifica copy_file e move_file como operações canônicas com source/destination reais', () => {
        const copy = buildTerminalToolActivityPresentation({
            toolName: 'copy_file',
            args: { source: 'src/a.txt', destination: 'src/b.txt' },
        });
        const move = buildTerminalToolActivityPresentation({
            toolName: 'move_file',
            operation: 'move',
            args: { source: 'src/b.txt', destination: 'src/c.txt' },
            toolCallId: 'call-move',
        });

        expect(copy.operation).toBe('copy');
        expect(copy.detail).toContain('copiando arquivo');
        expect(copy.fileTargets).toEqual(['src/a.txt', 'src/b.txt']);
        expect(move.operation).toBe('move');
        expect(move.detail).toContain('movendo arquivo');
        expect(move.target).toContain('src/b.txt');
        expect(move.target).not.toContain('call-move');
        expect(move.completeLine(true, '0.1s')).toContain('movendo arquivo concluído');
    });

    it('resume patch_file local com substituições e dry-run sem renderizar diffPreview no default', () => {
        const presentation = buildTerminalToolActivityPresentation({
            toolName: 'patch_file',
            args: {
                path: 'src/copilot/terminal/events/tool-activity-presenter.js',
                old_string: 'alpha',
                new_string: 'beta',
            },
            result: {
                success: true,
                dryRun: true,
                replacedOccurrences: 1,
                diffPreview: '-alpha\n+beta',
                diffPreviewLines: 2,
            },
        });

        expect(presentation.displayToolName).toBe('Editar arquivo');
        expect(presentation.operation).toBe('edit');
        expect(presentation.target).toContain('src/copilot/terminal/events/tool-activity-presenter.js');
        expect(presentation.resultSummary).toBe('sucesso · simulação · 1 substituição');
        expect(presentation.completeLine(true, '0.1s')).toContain('sucesso · simulação · 1 substituição');
        expect(presentation.detail).not.toContain('-alpha');
        expect(presentation.detail).not.toContain('+beta');
    });

    it('humaniza nomes repo_* observados no runtime sem vazar identificadores técnicos', () => {
        const patch = buildTerminalToolActivityPresentation({
            toolName: 'repo_apply_patch',
            args: {
                path: 'src/copilot/terminal/events/tool-activity-presenter.js',
                old_string: 'alpha',
                new_string: 'beta',
            },
            result: {
                success: true,
                replacedOccurrences: 1,
                returnedLines: { start: 10, end: 12 },
            },
        });
        const batch = buildTerminalToolActivityPresentation({
            toolName: 'repo_apply_file_batch',
            args: {
                operations: [
                    { type: 'create_file', path: 'src/copilot/.ai/jobs/a.txt', content: 'a' },
                    {
                        type: 'move_file',
                        source: 'src/copilot/.ai/jobs/a.txt',
                        destination: 'src/copilot/.ai/jobs/b.txt',
                    },
                ],
            },
            result: { success: true, operationCount: 2 },
        });

        expect(patch.displayToolName).toBe('Aplicar patch');
        expect(patch.operation).toBe('edit');
        expect(patch.detail).toContain('editando arquivo');
        expect(patch.target).toContain('src/copilot/terminal/events/tool-activity-presenter.js');
        expect(patch.detail).not.toContain('repo_apply_patch');
        expect(batch.displayToolName).toBe('Aplicar lote de arquivos');
        expect(batch.operation).toBe('write');
        expect(batch.detail).toContain('aplicando lote de arquivos');
        expect(batch.target).toContain('2 operações');
        expect(batch.target).toContain('src/copilot/.ai/jobs/a.txt');
        expect(batch.target).toContain('src/copilot/.ai/jobs/b.txt');
        expect(batch.resultSummary).toBe('sucesso · 2 operações');
        expect(batch.completeLine(true, '0.2s')).toContain('sucesso · 2 operações');
        expect(batch.detail).not.toContain('repo_apply_file_batch');
    });
});
