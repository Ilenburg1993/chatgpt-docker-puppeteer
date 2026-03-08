// @ts-check
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Utility para combinar classes Tailwind CSS Remove classes duplicadas e resolve conflitos
 *
 * @param {...unknown} inputs - Classes CSS a combinar (strings, arrays, objetos)
 * @returns {string}
 */
export function cn(...inputs) {
    return twMerge(clsx(inputs));
}
