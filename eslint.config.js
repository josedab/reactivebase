import tseslint from "typescript-eslint"

export default tseslint.config(
  {
    ignores: ["**/dist/**", "**/node_modules/**", "**/build/**", "website/**"],
  },
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", {
        argsIgnorePattern: "^_",
        varsIgnorePattern: "^_",
        destructuredArrayIgnorePattern: "^_",
        caughtErrorsIgnorePattern: "^_",
      }],
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-empty-function": "off",
      "no-console": ["error", { allow: ["warn", "error", "info", "debug"] }],
      "prefer-const": "error",
    },
  },
  {
    files: ["packages/cli/**/*.ts", "packages/create-reactivebase/**/*.ts"],
    rules: {
      "no-console": "off",
    },
  },
)
