import { defineConfig } from 'vite';
import obfuscatorPlugin from 'rollup-plugin-obfuscator';

export default defineConfig({
    // No usamos framework — es vanilla multi-page
    root: './',
    publicDir: false,

    build: {
        outDir: 'dist',
        emptyOutDir: true,

        // ❌ Sin sourcemaps en producción — nadie podrá ver el código original
        sourcemap: false,

        // Configurar Rollup para multi-page
        rollupOptions: {
            input: {
                main: './index.html',
                dashboard: './dashboard.html',
                social: './social.html',
                profile: './profile.html',
                duel: './duel.html',
                player: './player.html',
            },
            plugins: [
                obfuscatorPlugin({
                    options: {
                        // Nivel de ofuscación alto
                        compact: true,
                        controlFlowFlattening: true,
                        controlFlowFlatteningThreshold: 0.75,
                        deadCodeInjection: true,
                        deadCodeInjectionThreshold: 0.4,
                        debugProtection: false, // true bloquea la consola totalmente
                        disableConsoleOutput: true, // Desactiva console.log en producción
                        identifierNamesGenerator: 'hexadecimal',
                        log: false,
                        numbersToExpressions: true,
                        renameGlobals: false,
                        selfDefending: true,
                        simplify: true,
                        splitStrings: true,
                        splitStringsChunkLength: 5,
                        stringArray: true,
                        stringArrayCallsTransform: true,
                        stringArrayCallsTransformThreshold: 0.75,
                        stringArrayEncoding: ['base64'],
                        stringArrayIndexShift: true,
                        stringArrayRotate: true,
                        stringArrayShuffle: true,
                        stringArrayWrappersCount: 2,
                        stringArrayWrappersChainedCalls: true,
                        stringArrayWrappersParametersMaxCount: 4,
                        stringArrayWrappersType: 'function',
                        stringArrayThreshold: 0.75,
                        transformObjectKeys: true,
                        unicodeEscapeSequence: false,
                    },
                }),
            ],
        },

        // Minificación con Terser
        minify: 'terser',
        terserOptions: {
            compress: {
                drop_console: true,      // Elimina todos los console.log
                drop_debugger: true,     // Elimina debugger statements
                passes: 2,
            },
            mangle: {
                toplevel: true,          // Renombra variables top-level
                properties: false,       // No renombrar propiedades (rompe APIs externas)
            },
            format: {
                comments: false,         // Elimina todos los comentarios
            },
        },
    },

    server: {
        // Configuración para desarrollo local
        port: 3000,
        open: true,
    },
});
