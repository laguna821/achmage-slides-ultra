import tsParser from "@typescript-eslint/parser";
import { defineConfig } from "eslint/config";
import obsidianmd from "eslint-plugin-obsidianmd";

export default defineConfig([
  {
    ignores: ["build/**", "main.js", "node_modules/**"],
  },
  ...obsidianmd.configs.recommended,
  {
    files: ["src/**/*.ts"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        project: "./tsconfig.json",
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "obsidianmd/prefer-active-doc": "error",
      // Keep official findings visible without making intentional diagnostic
      // logging a release blocker.
      "obsidianmd/rule-custom-message": "warn",
    },
  },
  {
    files: ["src/tests/**/*.ts"],
    rules: {
      // Browser/CDP and Node harnesses intentionally use their own globals and
      // console output; these are not Obsidian plugin runtime paths.
      "no-restricted-globals": "off",
      "obsidianmd/no-global-this": "off",
      "obsidianmd/prefer-active-doc": "off",
      "obsidianmd/prefer-create-el": "off",
      "obsidianmd/prefer-window-timers": "off",
      "obsidianmd/rule-custom-message": "off",
    },
  },
]);
