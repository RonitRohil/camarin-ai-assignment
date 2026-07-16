const js = require("@eslint/js");
const globals = require("globals");
const { defineConfig, globalIgnores } = require("eslint/config");

module.exports = defineConfig([
    globalIgnores(["node_modules", "generated", ".cache", "uploads", "coverage"]),
    {
        files: ["**/*.js"],
        ignores: ["tests/**/*.js"],
        extends: [js.configs.recommended],
        languageOptions: {
            globals: { ...globals.node },
            sourceType: "commonjs",
        },
        rules: {
            "no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
        },
    },
    {
        // vitest v4's own API only loads via ESM import, even in this otherwise
        // fully-CommonJS project (confirmed - require("vitest") throws outright)
        files: ["tests/**/*.js"],
        extends: [js.configs.recommended],
        languageOptions: {
            globals: { ...globals.node },
            sourceType: "module",
        },
        rules: {
            "no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
        },
    },
]);
