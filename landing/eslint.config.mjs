import { FlatCompat } from '@eslint/eslintrc';

const compat = new FlatCompat({
  baseDirectory: import.meta.dirname,
});

const eslintConfig = [
  ...compat.extends('next/core-web-vitals', 'next/typescript'),
  {
    rules: {
      // Banned-classes are enforced via scripts/check-banned-classes.sh,
      // not ESLint — ESLint only sees logical patterns, the shell script
      // greps strings post-build.
    },
  },
];

export default eslintConfig;
