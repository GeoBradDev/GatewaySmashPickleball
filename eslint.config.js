import js from '@eslint/js';

// Two environments in one repo, so they get two configs rather than one
// permissive union that would stop catching anything in either.
export default [
  {
    ignores: ['dist/**', 'node_modules/**'],
  },

  // js/app.js: browser only, no bundler globals. It is deliberately written as
  // an IIFE using var, because it is the only script on the page.
  {
    files: ['js/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        document: 'readonly',
        window: 'readonly',
        requestAnimationFrame: 'readonly',
        console: 'readonly',
      },
    },
    rules: {
      ...js.configs.recommended.rules,
      // The bug this repo actually shipped was a DOM call against a null
      // element, so anything hiding a missing or typo'd binding is an error.
      'no-undef': 'error',
      'no-unused-vars': 'error',
      eqeqeq: ['error', 'always'],
      'no-implicit-globals': 'error',
    },
  },

  // scripts/ and the Vite config: Node, ESM.
  {
    files: ['scripts/**/*.js', '*.config.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      // Listed explicitly rather than pulled from a globals package, so that
      // adding a dependency is not the price of linting four files. Node 20 is
      // the floor, which is where fetch and AbortController became stable.
      globals: {
        console: 'readonly',
        process: 'readonly',
        fetch: 'readonly',
        AbortController: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        URL: 'readonly',
        Buffer: 'readonly',
      },
    },
    rules: {
      ...js.configs.recommended.rules,
      eqeqeq: ['error', 'always'],
    },
  },
];
