#!/usr/bin/env node
import { promises as fs } from 'node:fs';
// @ts-nocheck
import path from 'node:path';
import { log } from '#core/logger';

const ROOT = path.join(import.meta.dirname, '..');
const PROFILE_DIR = path.join(ROOT, 'profile');
const BACKUP_DIR = path.join(ROOT, 'profile_backups');
const MAX_BACKUPS_DAYS = 30; // Mantém backups por 30 dias

/**
 * Rotaciona o profile persistente atual para backup
  * @returns {Promise<any>}
 */
async function rotateProfile() {
    try {
        log('INFO', '[ROTATE] Iniciando rotação de profile...');

        // 1. Verifica se profile existe
        try {
            await fs.access(PROFILE_DIR);
        } catch (_err) {
            log('INFO', '[ROTATE] Nenhum profile para rotacionar (diretório não existe)');
            return { rotated: false, reason: 'NO_PROFILE' };
        }

        // 2. Cria diretório de backups se não existir
        try {
            await fs.mkdir(BACKUP_DIR, { recursive: true });
        } catch (error) {
            log('ERROR', `[ROTATE] Erro ao criar diretório de backups: ${error.message}`);
            throw error;
        }

        // 3. Gera nome do backup com timestamp
        const timestamp = new Date().toISOString().replace(/:/g, '-').replace(/\..+/, ''); // Remove milissegundos
        const backupPath = path.join(BACKUP_DIR, `profile_${timestamp}`);

        // 4. Move profile atual para backup
        log('INFO', `[ROTATE] Movendo profile para: ${backupPath}`);
        await fs.rename(PROFILE_DIR, backupPath);

        // 5. Cria novo profile vazio
        await fs.mkdir(PROFILE_DIR, { recursive: true });

        // 6. Calcula tamanho do backup
        const backupSize = await getDirectorySize(backupPath);
        const backupSizeMB = (backupSize / 1024 / 1024).toFixed(2);

        log('INFO', `[ROTATE] Profile rotacionado com sucesso (${backupSizeMB} MB)`);

        return {
            rotated: true,
            backupPath,
            backupSizeMB: parseFloat(backupSizeMB),
            timestamp,
        };
    } catch (error) {
        log('ERROR', `[ROTATE] Erro ao rotacionar profile: ${error.message}`);
        throw error;
    }
}

/**
 * Remove backups antigos (>30 dias)
  * @returns {Promise<any>}
 */
async function cleanOldBackups() {
    try {
        log('INFO', '[ROTATE] Verificando backups antigos...');

        // Verifica se diretório de backups existe
        try {
            await fs.access(BACKUP_DIR);
        } catch {
            log('INFO', '[ROTATE] Nenhum backup para limpar');
            return { cleaned: 0, totalSize: 0 };
        }

        const entries = await fs.readdir(BACKUP_DIR, { withFileTypes: true });
        const backups = entries.filter(e => e.isDirectory() && e.name.startsWith('profile_'));

        const now = Date.now();
        const maxAge = MAX_BACKUPS_DAYS * 24 * 60 * 60 * 1000;

        let cleaned = 0;
        let totalSize = 0;

        for (const backup of backups) {
            const backupPath = path.join(BACKUP_DIR, backup.name);
            const stats = await fs.stat(backupPath);
            const age = now - stats.mtimeMs;

            if (age > maxAge) {
                const size = await getDirectorySize(backupPath);
                totalSize += size;

                log(
                    'INFO',
                    `[ROTATE] Removendo backup antigo: ${backup.name} (${(age / 1000 / 60 / 60 / 24).toFixed(1)} dias)`
                );
                await fs.rm(backupPath, { recursive: true, force: true });
                cleaned++;
            }
        }

        const totalSizeMB = (totalSize / 1024 / 1024).toFixed(2);

        if (cleaned > 0) {
            log('INFO', `[ROTATE] Removidos ${cleaned} backups antigos (${totalSizeMB} MB liberados)`);
        } else {
            log('INFO', '[ROTATE] Nenhum backup antigo para remover');
        }

        return { cleaned, totalSizeMB: parseFloat(totalSizeMB) };
    } catch (error) {
        log('ERROR', `[ROTATE] Erro ao limpar backups: ${error.message}`);
        throw error;
    }
}

/**
 * Calcula tamanho total de um diretório (recursivo)
  * @returns {Promise<any>}
 */
async function getDirectorySize(dirPath) {
    let totalSize = 0;

    try {
        const entries = await fs.readdir(dirPath, { withFileTypes: true });

        for (const entry of entries) {
            const entryPath = path.join(dirPath, entry.name);

            if (entry.isDirectory()) {
                totalSize += await getDirectorySize(entryPath);
            } else if (entry.isFile()) {
                const stats = await fs.stat(entryPath);
                totalSize += stats.size;
            }
        }
    } catch (_error) {
        // Ignora erros de permissão ou arquivos bloqueados
    }

    return totalSize;
}

/**
 * Retorna estatísticas dos backups atuais
  * @returns {Promise<any>}
 */
async function getBackupStats() {
    try {
        await fs.access(BACKUP_DIR);
    } catch {
        return { count: 0, totalSizeMB: 0, backups: [] };
    }

    const entries = await fs.readdir(BACKUP_DIR, { withFileTypes: true });
    const backups = entries.filter(e => e.isDirectory() && e.name.startsWith('profile_'));

    let totalSize = 0;
    const backupDetails = [];

    for (const backup of backups) {
        const backupPath = path.join(BACKUP_DIR, backup.name);
        const stats = await fs.stat(backupPath);
        const size = await getDirectorySize(backupPath);
        totalSize += size;

        backupDetails.push({
            name: backup.name,
            sizeMB: parseFloat((size / 1024 / 1024).toFixed(2)),
            created: stats.birthtime,
            ageDays: parseFloat(((Date.now() - stats.mtimeMs) / 1000 / 60 / 60 / 24).toFixed(1)),
        });
    }

    // Ordena por data (mais recente primeiro)
    backupDetails.sort((a, b) => b.created - a.created);

    return {
        count: backups.length,
        totalSizeMB: parseFloat((totalSize / 1024 / 1024).toFixed(2)),
        backups: backupDetails,
    };
}

/**
 * Main function
 */
async function main() {
    try {
        console.log('🔄 Profile Rotation Job\n');

        // 1. Rotaciona profile atual
        const rotation = await rotateProfile();

        if (!rotation.rotated) {
            console.log('ℹ️  Nenhum profile para rotacionar\n');
            return;
        }

        console.log(`✅ Profile rotacionado: ${rotation.backupSizeMB} MB`);
        console.log(`📁 Backup: ${rotation.backupPath}\n`);

        // 2. Limpa backups antigos
        const cleanup = await cleanOldBackups();

        if (cleanup.cleaned > 0) {
            console.log(`🗑️  Backups removidos: ${cleanup.cleaned} (${cleanup.totalSizeMB} MB liberados)\n`);
        }

        // 3. Mostra estatísticas finais
        const stats = await getBackupStats();
        console.log(`📊 Estatísticas de Backups:`);
        console.log(`   Total: ${stats.count} backups`);
        console.log(`   Tamanho: ${stats.totalSizeMB} MB`);

        if (stats.backups.length > 0) {
            console.log(`\n📦 Backups disponíveis:`);
            stats.backups.forEach(b => {
                console.log(`   - ${b.name}: ${b.sizeMB} MB (${b.ageDays} dias)`);
            });
        }

        console.log('\n✅ Rotação concluída com sucesso!');
    } catch (error) {
        console.error(`\n❌ Erro na rotação: ${error.message}`);
        process.exit(1);
    }
}

// Executar se chamado diretamente
if (import.meta.filename === process.argv[1]) {
    main();
}

export { rotateProfile, cleanOldBackups, getBackupStats, getDirectorySize };
