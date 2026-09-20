import tseslint from 'typescript-eslint';
export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'packages/contracts/src/generated/**'] },
  ...tseslint.configs.recommended,
  { files: ['**/*.mjs'], rules: { '@typescript-eslint/no-unused-vars': 'error' } },
  { files: ['**/*.ts'], rules: { '@typescript-eslint/consistent-type-imports': 'error' } },
  { files: ['tests/**/*.ts'], rules: { '@typescript-eslint/no-explicit-any': 'off' } },
);
