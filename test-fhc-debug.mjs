#!/usr/bin/env node
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local'), quiet: true });

const apiKey = process.env.OLLAMA_CLOUD_API_KEY;

console.log('Testing Ollama Cloud API directly...');
console.log('API Key configured:', apiKey ? 'Yes' : 'No');
console.log();

// Test with qwen3-coder-next first (we know this works)
console.log('Test 1: qwen3-coder-next (working model)');
console.log('Prompt: Quem é Fernando Henrique Cardoso?');
console.log();

try {
    const response = await fetch('https://ollama.com/api/generate', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
            model: 'qwen3-coder-next',
            prompt: 'Quem é Fernando Henrique Cardoso? Responda em português.',
            stream: false,
            options: {
                temperature: 0.7,
                num_predict: 300,
            },
        }),
    });

    console.log('Status:', response.status);
    const data = await response.json();
    console.log('Response data:', JSON.stringify(data, null, 2));

    if (data.response) {
        console.log();
        console.log('═'.repeat(80));
        console.log('RESPOSTA LITERAL (qwen3-coder-next):');
        console.log('═'.repeat(80));
        console.log(data.response);
        console.log('═'.repeat(80));
    }
} catch (error) {
    console.error('Error:', error.message);
}

console.log();
console.log('─'.repeat(80));
console.log();

// Test with qwen3-next:80b-cloud
console.log('Test 2: qwen3-next:80b-cloud');
console.log('Prompt: Quem é Fernando Henrique Cardoso?');
console.log();

try {
    const response = await fetch('https://ollama.com/api/generate', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
            model: 'qwen3-next:80b-cloud',
            prompt: 'Quem é Fernando Henrique Cardoso? Responda em português.',
            stream: false,
            options: {
                temperature: 0.7,
                num_predict: 300,
            },
        }),
    });

    console.log('Status:', response.status);
    const data = await response.json();
    console.log('Response data:', JSON.stringify(data, null, 2));

    if (data.response) {
        console.log();
        console.log('═'.repeat(80));
        console.log('RESPOSTA LITERAL (qwen3-next:80b-cloud):');
        console.log('═'.repeat(80));
        console.log(data.response);
        console.log('═'.repeat(80));
    }
} catch (error) {
    console.error('Error:', error.message);
}
