#!/usr/bin/env node
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local'), quiet: true });

import { OllamaClient } from './tools/ollama/client.mjs';

const ollama = new OllamaClient({
    cloudEnabled: true,
    cloudBaseUrl: 'https://ollama.com',
    cloudApiKey: process.env.OLLAMA_CLOUD_API_KEY,
});

console.log('Perguntando ao Ollama Cloud: Quem é Fernando Henrique Cardoso?');
console.log('Modelo: qwen3-next:80b-cloud');
console.log();

const resposta = await ollama.generate('Quem é Fernando Henrique Cardoso?', 'qwen3-next:80b-cloud', {
    temperature: 0.7,
    num_predict: 300,
});

console.log('═'.repeat(80));
console.log('RESPOSTA LITERAL:');
console.log('═'.repeat(80));
console.log(resposta);
console.log('═'.repeat(80));
