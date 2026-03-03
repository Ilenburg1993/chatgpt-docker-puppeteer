/**
 * Helper utilities for scripts
 */

import { execa } from 'execa';
import fs from 'node:fs/promises';

/**
 * Logs a message with timestamp
 * @param {string} message
  * @returns {void}
 */
export function log(message) {
    console.log(`[${new Date().toISOString()}] ${message}`);
}

/**
 * Logs an error message
 * @param {string} message
  * @returns {void}
 */
export function error(message) {
    console.error(`[${new Date().toISOString()}] ERROR: ${message}`);
}

/**
 * Checks if a file exists
 * @param {string} filePath
 * @returns {Promise<boolean>}
 */
export async function fileExists(filePath) {
    try {
        await fs.access(filePath);
        return true;
    } catch {
        return false;
    }
}

/**
 * Reads a JSON file
 * @param {string} filePath
 * @returns {Promise<any>}
 */
export async function readJson(filePath) {
    const content = await fs.readFile(filePath, 'utf8');
    return JSON.parse(content);
}

/**
 * Writes a JSON file
 * @param {string} filePath
 * @param {any} data
  * @returns {Promise<void>}
 */
export async function writeJson(filePath, data) {
    await fs.writeFile(filePath, JSON.stringify(data, null, 2));
}

/**
 * Runs a command and returns the result
 * @param {string} command
 * @param {string[]} args
 * @returns {Promise<{stdout: string, stderr: string}>}
 */
export async function runCommand(command, args = []) {
    const result = await execa(command, args);
    return { stdout: result.stdout, stderr: result.stderr };
}

/**
 * Validates that required environment variables are set
 * @param {string[]} vars
 * @throws {Error} if any var is missing
  * @returns {void}
 */
export function validateEnv(vars) {
    const missing = vars.filter(v => !process.env[v]);
    if (missing.length > 0) {
        throw new Error(`Missing environment variables: ${missing.join(', ')}`);
    }
}

/**
 * Sleeps for the specified milliseconds
 * @param {number} ms
 * @returns {Promise<void>}
 */
export function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
