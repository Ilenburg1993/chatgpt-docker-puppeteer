#!/usr/bin/env node
/**
 * Runtime Debug - Versão Simplificada
 * Teste básico sem Node inspect para validar funcionamento
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.join(__dirname, '..');

const SIMPLE_SCENARIOS = [
    {
        name: 'Basic Execution Test',
        script: 'src/main.js',
        args: [],
        env: { NODE_ENV: 'test', DEBUG: 'basic' },
        duration: 10000,
        description: 'Teste básico de execução da aplicação',
    },
    {
        name: 'Error Simulation',
        script: 'src/main.js',
        args: [],
        env: { NODE_ENV: 'test', FORCE_ERRORS: '1', DEBUG: 'errors' },
        duration: 8000,
        description: 'Simular cenários de erro',
    },
    {
        name: 'Memory Stress',
        script: 'src/main.js',
        args: [],
        env: { NODE_ENV: 'test', MEMORY_STRESS: '1', DEBUG: 'memory' },
        duration: 12000,
        description: 'Teste de estresse de memória',
    },
];

async function runSimpleScenario(scenario) {
    console.log(`\n🧪 Executando: ${scenario.name}`);
    console.log(`   📝 ${scenario.description}`);
    console.log(`   ⏱️  ${scenario.duration}ms`);

    return new Promise(resolve => {
        const child = spawn('node', [scenario.script, ...scenario.args], {
            cwd: ROOT_DIR,
            env: { ...process.env, ...scenario.env },
            stdio: ['pipe', 'pipe', 'pipe'],
        });

        let stdout = '';
        let stderr = '';
        let startTime = Date.now();

        child.stdout.on('data', data => {
            stdout += data.toString();
        });

        child.stderr.on('data', data => {
            stderr += data.toString();
        });

        const timeout = setTimeout(() => {
            console.log(`   ⏰ Timeout - terminando processo`);
            try {
                child.kill('SIGTERM');
            } catch (_e) {
                // Processo já pode ter terminado
            }
        }, scenario.duration);

        child.on('close', (code, signal) => {
            clearTimeout(timeout);
            const duration = Date.now() - startTime;

            const result = {
                scenario: scenario.name,
                exitCode: code,
                signal,
                stdout: stdout.length,
                stderr: stderr.length,
                duration,
                hasErrors: stderr.includes('Error') || stderr.includes('uncaught'),
                hasWarnings: stderr.includes('Warning') || stderr.includes('deprecated'),
                success: code === 0 && !signal,
            };

            console.log(`   ✅ Concluído (exit: ${code}, duração: ${duration}ms)`);
            if (result.hasErrors) {
                console.log(
                    `   🚨 Erros detectados: ${
                        stderr.split('\n').filter(line => line.includes('Error') || line.includes('uncaught')).length
                    }`
                );
            }

            resolve(result);
        });

        child.on('error', error => {
            clearTimeout(timeout);
            console.error(`   ❌ Erro: ${error.message}`);
            resolve({
                scenario: scenario.name,
                error: error.message,
                success: false,
            });
        });
    });
}

/** Função exportada: runSimpleDebug. */
async function main() {
    console.log('🧪 RUNTIME DEBUG - Versão Simplificada');
    console.log('=====================================\n');

    console.log(`🎯 Cenários: ${SIMPLE_SCENARIOS.length}`);
    SIMPLE_SCENARIOS.forEach((s, i) => {
        console.log(`   ${i + 1}. ${s.name}`);
    });
    console.log('');

    const results = [];

    for (const scenario of SIMPLE_SCENARIOS) {
        try {
            const result = await runSimpleScenario(scenario);
            results.push(result);
            // Pequena pausa entre cenários
            await new Promise(resolve => setTimeout(resolve, 1000));
        } catch (error) {
            console.error(`❌ Erro crítico no cenário ${scenario.name}: ${error.message}`);
            results.push({
                scenario: scenario.name,
                error: error.message,
                success: false,
            });
        }
    }

    // Análise dos resultados
    console.log('\n📊 RESULTADOS FINAIS');
    console.log('====================');

    const successful = results.filter(r => r.success).length;
    const failed = results.length - successful;
    const withErrors = results.filter(r => r.hasErrors).length;
    const withWarnings = results.filter(r => r.hasWarnings).length;

    console.log(`✅ Cenários bem-sucedidos: ${successful}`);
    console.log(`❌ Cenários com falha: ${failed}`);
    console.log(`🚨 Cenários com erros: ${withErrors}`);
    console.log(`⚠️  Cenários com warnings: ${withWarnings}`);

    if (withErrors > 0) {
        console.log('\n🔍 CENÁRIOS COM ERROS:');
        results
            .filter(r => r.hasErrors)
            .forEach(result => {
                console.log(`   • ${result.scenario}`);
            });
    }

    // Salvar relatório
    const reportPath = path.join(ROOT_DIR, 'debug-profiles', `simple-debug-${Date.now()}.json`);
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(
        reportPath,
        JSON.stringify(
            {
                timestamp: new Date().toISOString(),
                results,
                summary: { successful, failed, withErrors, withWarnings },
            },
            null,
            2
        )
    );

    console.log(`\n💾 Relatório salvo: ${reportPath}`);

    // Conclusão
    if (failed === 0 && withErrors === 0) {
        console.log('\n🎉 Todos os cenários executaram sem problemas críticos!');
    } else {
        console.log(`\n⚠️  Detectados ${withErrors} cenários com erros - investigar necessário.`);
    }
}

if (import.meta.url === `file://${process.argv[1]}`) {
    main().catch(console.error);
}

export { main as runSimpleDebug };
