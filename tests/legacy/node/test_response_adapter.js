import path from 'node:path';
import fs from 'node:fs';
import { saveResponse, loadResponse, isResponseV2, convertV1toV2 } from '#infra/storage/response_adapter';
import { log } from '#core/logger';

// Diretórios temporários para testes (NOTA: response_store_v2 salva em respostas/ produção)
const TEST_DIR = path.join(import.meta.dirname, 'temp_test_responses');
const RESPONSES_DIR = path.join(TEST_DIR, 'respostas');

// Mock task para testes
const createMockTask = taskId => ({
    meta: {
        id: taskId,
        created_at: new Date().toISOString(),
        schema_version: '5.0',
    },
    spec: {
        prompt: 'Test prompt',
        target: 'chatgpt',
    },
    result: {},
});

// Testes
/** Função exportada: runTests. */
async function runTests() {
    let passed = 0;
    let failed = 0;

    console.log('\n========================================');
    console.log('  Response Adapter V2.0 Tests');
    console.log('========================================\n');

    // Test 1: isResponseV2 - detecta V2 corretamente
    {
        const testName = 'isResponseV2() - Detecta formato V2';
        try {
            // Response V2 REAL: { content, generation, preview }
            const v2Response = {
                content: {
                    text: 'hello',
                    markdown: '# hello',
                    json: { msg: 'hello' },
                    html: '<p>hello</p>',
                },
                generation: {
                    model: 'chatgpt',
                    started_at: new Date().toISOString(),
                    completed_at: new Date().toISOString(),
                    duration_ms: 1000,
                },
                preview: {},
            };

            const result = isResponseV2(v2Response);
            if (result === true) {
                console.log(`✅ ${testName}`);
                passed++;
            } else {
                throw new Error(`Expected true, got ${result}`);
            }
        } catch (error) {
            console.error(`❌ ${testName}: ${error.message}`);
            failed++;
        }
    }

    // Test 2: isResponseV2 - detecta V1 corretamente
    {
        const testName = 'isResponseV2() - Detecta formato V1 (string)';
        try {
            const v1Response = 'This is a plain string response';

            const result = isResponseV2(v1Response);
            if (result === false) {
                console.log(`✅ ${testName}`);
                passed++;
            } else {
                throw new Error(`Expected false, got ${result}`);
            }
        } catch (error) {
            console.error(`❌ ${testName}: ${error.message}`);
            failed++;
        }
    }

    // Test 3: convertV1toV2 - converte string simples
    {
        const testName = 'convertV1toV2() - Converte string para V2';
        try {
            const v1Text = 'Hello world';
            const task = createMockTask('test-v1-conversion');

            const v2Response = convertV1toV2(v1Text, task);

            // Validar estrutura V2 real
            if (
                v2Response.content &&
                v2Response.content.text === v1Text &&
                v2Response.content.markdown === v1Text &&
                v2Response.content.html &&
                v2Response.content.json &&
                v2Response.generation &&
                v2Response.generation.model === 'unknown' && // task.spec.model não existe no mock
                v2Response.preview &&
                v2Response.validation === null &&
                isResponseV2(v2Response) === true
            ) {
                console.log(`✅ ${testName}`);
                passed++;
            } else {
                throw new Error('V2 conversion failed validation');
            }
        } catch (error) {
            console.error(`❌ ${testName}: ${error.message}`);
            failed++;
        }
    }

    // Test 4: saveResponse - salva V2 e popula task.result
    {
        const testName = 'saveResponse() - Salva V2 e popula task.result';
        try {
            const taskId = 'test-save-v2';
            const task = createMockTask(taskId);

            // Response V2 REAL com estrutura correta
            const v2Response = {
                content: {
                    text: 'Hello world',
                    markdown: '# Hello world',
                    json: { message: 'Hello world' },
                    html: '<h1>Hello world</h1>',
                },
                generation: {
                    model: 'chatgpt',
                    started_at: new Date().toISOString(),
                    completed_at: new Date().toISOString(),
                    duration_ms: 1000,
                },
                preview: {},
            };

            await saveResponse(taskId, v2Response, task);

            // Verifica que task.result foi preenchido (campos V5)
            if (
                !task.result.storage ||
                !task.result.storage.text_file ||
                !task.result.storage.markdown_file ||
                !task.result.storage.json_file ||
                !task.result.storage.html_file ||
                !task.result.generation ||
                !task.result.file_path // Backward compatibility V4
            ) {
                throw new Error('task.result not populated correctly');
            }

            // Nota: Não verificamos arquivos físicos aqui (responsabilidade do response_store_v2)
            // Este teste foca na responsabilidade do adapter: preencher task.result

            console.log(`✅ ${testName}`);
            passed++;
        } catch (error) {
            console.error(`❌ ${testName}: ${error.message}`);
            failed++;
        }
    }

    // Test 5: saveResponse - backward compatibility com V1 (string)
    {
        const testName = 'saveResponse() - Backward compatibility V1';
        try {
            const taskId = 'test-save-v1';
            const task = createMockTask(taskId);
            const v1Response = 'Legacy V1 response text';

            await saveResponse(taskId, v1Response, task);

            // Verifica que task.result foi preenchido (conversion V1→V2)
            // O adapter converte V1 → V2 automaticamente
            if (
                task.result.storage &&
                task.result.storage.text_file &&
                task.result.generation && // V1 convertido para V2 tem generation
                task.result.file_path // V4 backward compatibility
            ) {
                console.log(`✅ ${testName}`);
                passed++;
            } else {
                throw new Error('V1 backward compatibility failed');
            }
        } catch (error) {
            console.error(`❌ ${testName}: ${error.message}`);
            failed++;
        }
    }

    // Test 6: loadResponse - carrega V2 em formato específico
    {
        const testName = 'loadResponse() - Carrega formato específico';
        try {
            const taskId = 'test-load-v2';
            const task = createMockTask(taskId);

            // Response V2 REAL
            const v2Response = {
                content: {
                    text: 'Load test',
                    markdown: '# Load test',
                    json: { test: true },
                    html: '<p>Load test</p>',
                },
                generation: {
                    model: 'chatgpt',
                    started_at: new Date().toISOString(),
                    completed_at: new Date().toISOString(),
                },
                preview: {},
            };

            // Salva primeiro
            await saveResponse(taskId, v2Response, task);

            // Carrega markdown
            const mdContent = await loadResponse(taskId, 'markdown');

            // loadResponse retorna string (content do arquivo .md)
            if (typeof mdContent === 'string' && mdContent === '# Load test') {
                console.log(`✅ ${testName}`);
                passed++;
            } else {
                throw new Error(`Expected '# Load test', got '${JSON.stringify(mdContent)}'`);
            }
        } catch (error) {
            console.error(`❌ ${testName}: ${error.message}`);
            failed++;
        }
    }

    // Summary
    console.log('\n========================================');
    console.log('  Test Summary');
    console.log('========================================');
    console.log(`✅ Passed: ${passed}`);
    console.log(`❌ Failed: ${failed}`);
    console.log(`📊 Total: ${passed + failed}`);
    console.log('========================================\n');

    return failed === 0;
}

// Run
if (import.meta.filename === process.argv[1]) {
    runTests()
        .then(success => {
            process.exit(success ? 0 : 1);
        })
        .catch(error => {
            console.error('Test runner crashed:', error);
            process.exit(1);
        });
}

export { runTests };
