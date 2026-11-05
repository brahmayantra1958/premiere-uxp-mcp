import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["**/dist/**", "**/node_modules/**", "artifacts/**", "_archive/**", "coverage/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // Preserve the ESLint 9 rule baseline while upgrading the toolchain for
    // security fixes. Adopting these new v10 recommendations is a separate
    // source migration, especially for errors created inside the UXP host.
    rules: { "no-useless-assignment": "off", "preserve-caught-error": "off" }
  },
  {
    files: ["tests/live-premiere/**/*.mjs"],
    languageOptions: {
      // The live harnesses run on the repository's Node >=20 runtime, where
      // structuredClone is a built-in. Declaring only this runtime global keeps
      // browser/UXP files from accidentally inheriting the Node environment.
      globals: { structuredClone: "readonly" }
    }
  },
  {
    files: ["**/*.ts"],
    rules: {
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/no-explicit-any": "off"
    }
  }
);
