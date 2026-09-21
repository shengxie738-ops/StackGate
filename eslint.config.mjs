import tseslint from 'typescript-eslint';
export default tseslint.config(
  // pnpm's temporary third-party patch copy is retained after cleanup was denied.
  // The reproducible declaration patch is tracked under patches/; product source stays linted.
  { ignores: ['dist/**', 'node_modules/**', '.stackgate-saxes-patch/**', 'packages/contracts/src/generated/**'] },
  ...tseslint.configs.recommended,
  { files: ['**/*.mjs'], rules: { '@typescript-eslint/no-unused-vars': 'error' } },
  { files: ['**/*.ts'], rules: { '@typescript-eslint/consistent-type-imports': 'error' } },
  { files: ['tests/**/*.ts'], rules: { '@typescript-eslint/no-explicit-any': 'off' } },
);
