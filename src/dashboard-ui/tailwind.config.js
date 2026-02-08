/** @type {import('tailwindcss').Config} */
import forms from '@tailwindcss/forms';
import typography from '@tailwindcss/typography';

export default {
    content: ['./index.html', './src/**/*.{vue,js,ts,jsx,tsx}'],
    darkMode: 'class',
    theme: {
        extend: {
            colors: {
                // Background layers (Deep Navy Dark Theme)
                background: {
                    DEFAULT: '#0a0e1a',
                    secondary: '#111827',
                    tertiary: '#1e293b',
                },

                foreground: {
                    DEFAULT: '#e2e8f0',
                    muted: '#94a3b8',
                    subtle: '#64748b',
                },

                primary: {
                    DEFAULT: '#3b82f6',
                    hover: '#2563eb',
                    active: '#1d4ed8',
                    muted: '#1e3a8a',
                },

                success: {
                    DEFAULT: '#10b981',
                    muted: '#065f46',
                },
                warning: {
                    DEFAULT: '#f59e0b',
                    muted: '#78350f',
                },
                error: {
                    DEFAULT: '#ef4444',
                    muted: '#7f1d1d',
                },
                info: {
                    DEFAULT: '#06b6d4',
                    muted: '#164e63',
                },

                border: {
                    DEFAULT: '#334155',
                    subtle: '#1e293b',
                },

                chart: {
                    1: '#3b82f6',
                    2: '#10b981',
                    3: '#f59e0b',
                    4: '#ef4444',
                    5: '#8b5cf6',
                    6: '#06b6d4',
                },
            },

            fontFamily: {
                sans: ['Inter', 'system-ui', 'sans-serif'],
                mono: ['Fira Code', 'Courier New', 'monospace'],
            },

            spacing: {
                18: '4.5rem',
                88: '22rem',
                112: '28rem',
            },

            borderRadius: {
                lg: '0.75rem',
                xl: '1rem',
                '2xl': '1.5rem',
            },

            boxShadow: {
                sm: '0 1px 2px 0 rgba(0, 0, 0, 0.5)',
                DEFAULT: '0 1px 3px 0 rgba(0, 0, 0, 0.5), 0 1px 2px -1px rgba(0, 0, 0, 0.5)',
                md: '0 4px 6px -1px rgba(0, 0, 0, 0.5), 0 2px 4px -2px rgba(0, 0, 0, 0.5)',
                lg: '0 10px 15px -3px rgba(0, 0, 0, 0.5), 0 4px 6px -4px rgba(0, 0, 0, 0.5)',
                xl: '0 20px 25px -5px rgba(0, 0, 0, 0.5), 0 8px 10px -6px rgba(0, 0, 0, 0.5)',
                glow: '0 0 20px rgba(59, 130, 246, 0.3)',
            },

            animation: {
                'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
                'bounce-slow': 'bounce 2s infinite',
                'fade-in': 'fadeIn 0.3s ease-in-out',
            },

            keyframes: {
                fadeIn: {
                    '0%': { opacity: '0', transform: 'translateY(-10px)' },
                    '100%': { opacity: '1', transform: 'translateY(0)' },
                },
            },
        },
    },
    plugins: [forms, typography],
};
