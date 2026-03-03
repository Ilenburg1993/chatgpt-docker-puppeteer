// @ts-check
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Utility para combinar classes Tailwind CSS
 * Remove classes duplicadas e resolve conflitos
  * @returns {object}
 */
export function cn(...inputs) {
    return twMerge(clsx(inputs));
}
