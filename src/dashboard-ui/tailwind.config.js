// @ts-check
/** @type {import('tailwindcss').Config} */
import forms from '@tailwindcss/forms';
import typography from '@tailwindcss/typography';

/** Reexport público: default. */
export default {
    content: ['./index.html', './src/**/*.{vue,js,ts,jsx,tsx}'],
    darkMode: 'class',
    theme: {
        extend: {
            colors: {
                // Background layers (Deep Space Dark Theme v3.0)
                background: {
                    DEFAULT: '#060a14',
                    secondary: '#0c1220',
                    tertiary: '#141c2e',
                    surface: '#1a2332',
                    elevated: '#1e293b',
                },

                foreground: {
                    DEFAULT: '#f0f4f8',
                    muted: '#8899aa',
                    subtle: '#5a6b7d',
                },

                primary: {
                    DEFAULT: '#3b82f6',
                    hover: '#2563eb',
                    active: '#1d4ed8',
                    muted: '#1e3a8a',
                    glow: 'rgba(59, 130, 246, 0.15)',
                },

                success: {
                    DEFAULT: '#10b981',
                    muted: '#065f46',
                    glow: 'rgba(16, 185, 129, 0.15)',
                },
                warning: {
                    DEFAULT: '#f59e0b',
                    muted: '#78350f',
                    glow: 'rgba(245, 158, 11, 0.15)',
                },
                error: {
                    DEFAULT: '#ef4444',
                    muted: '#7f1d1d',
                    glow: 'rgba(239, 68, 68, 0.15)',
                },
                info: {
                    DEFAULT: '#06b6d4',
                    muted: '#164e63',
                    glow: 'rgba(6, 182, 212, 0.15)',
                },

                border: {
                    DEFAULT: '#2a3a50',
                    subtle: '#1a2636',
                    glow: 'rgba(59, 130, 246, 0.2)',
                },

                chart: {
                    1: '#3b82f6',
                    2: '#10b981',
                    3: '#f59e0b',
                    4: '#ef4444',
                    5: '#8b5cf6',
                    6: '#06b6d4',
                },

                // NERV-specific accent
                nerv: {
                    DEFAULT: '#06b6d4',
                    muted: '#0e7490',
                    glow: 'rgba(6, 182, 212, 0.2)',
                },
            },

            fontFamily: {
                sans: ['Inter', 'system-ui', 'sans-serif'],
                mono: ['JetBrains Mono', 'Fira Code', 'Courier New', 'monospace'],
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
                'glow-sm': '0 0 10px rgba(59, 130, 246, 0.2)',
                'glow-cyan': '0 0 20px rgba(6, 182, 212, 0.3)',
                'glow-success': '0 0 20px rgba(16, 185, 129, 0.3)',
                'glow-error': '0 0 20px rgba(239, 68, 68, 0.3)',
                'inner-glow': 'inset 0 1px 0 rgba(255, 255, 255, 0.05)',
            },

            animation: {
                'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
                'pulse-live': 'pulseLive 2s ease-in-out infinite',
                'bounce-slow': 'bounce 2s infinite',
                'fade-in': 'fadeIn 0.3s ease-in-out',
                'slide-up': 'slideUp 0.3s ease-out',
                'glow-pulse': 'glowPulse 3s ease-in-out infinite',
            },

            keyframes: {
                fadeIn: {
                    '0%': { opacity: '0', transform: 'translateY(-10px)' },
                    '100%': { opacity: '1', transform: 'translateY(0)' },
                },
                slideUp: {
                    '0%': { opacity: '0', transform: 'translateY(20px)' },
                    '100%': { opacity: '1', transform: 'translateY(0)' },
                },
                pulseLive: {
                    '0%, 100%': { opacity: '1' },
                    '50%': { opacity: '0.5' },
                },
                glowPulse: {
                    '0%, 100%': { boxShadow: '0 0 15px rgba(59, 130, 246, 0.1)' },
                    '50%': { boxShadow: '0 0 25px rgba(59, 130, 246, 0.25)' },
                },
            },
        },
    },
    plugins: [forms, typography],
};
