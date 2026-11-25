// @ts-check
const eslint = require('@eslint/js');
const { defineConfig } = require('eslint/config');
const tseslint = require('typescript-eslint');
const angular = require('angular-eslint');

module.exports = defineConfig([
  { ignores: ['dist/**', 'coverage/**', '.angular/**', 'out-tsc/**'] },
  {
    files: ['**/*.ts'],
    extends: [
      eslint.configs.recommended,
      tseslint.configs.strict,
      tseslint.configs.stylistic,
      angular.configs.tsRecommended,
    ],
    processor: angular.processInlineTemplates,
    rules: {
      '@angular-eslint/directive-selector': ['error', { type: 'attribute', prefix: 'app', style: 'camelCase' }],
      '@angular-eslint/component-selector': ['error', { type: 'element', prefix: 'app', style: 'kebab-case' }],
      '@angular-eslint/prefer-on-push-component-change-detection': 'error',
      '@angular-eslint/prefer-signals': 'error',
      '@angular-eslint/no-input-rename': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
      // Angular idioms: decorated classes may be empty and `output<void>()` is the canonical event type.
      '@typescript-eslint/no-extraneous-class': ['error', { allowWithDecorator: true }],
      '@typescript-eslint/no-invalid-void-type': 'off',
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/consistent-type-assertions': [
        'error',
        { assertionStyle: 'as', objectLiteralTypeAssertions: 'never' },
      ],
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
      // Web A05: forbid raw HTML sinks and Angular sanitizer bypasses anywhere in TypeScript.
      'no-restricted-syntax': [
        'error',
        {
          selector: 'MemberExpression[property.name=/^(innerHTML|outerHTML)$/]',
          message: 'Raw HTML sinks are forbidden (Web A05). Use Angular bindings.',
        },
        {
          selector: 'CallExpression[callee.property.name=/^bypassSecurityTrust/]',
          message: 'Sanitizer bypasses are forbidden (Web A05).',
        },
        {
          selector:
            "CallExpression[callee.object.name='localStorage'][callee.property.name='setItem'] Literal[value=/token|secret|password/i]",
          message: 'Never persist credentials in localStorage (Web A04).',
        },
      ],
    },
  },
  {
    files: ['**/*.spec.ts'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },
  {
    files: ['**/*.html'],
    extends: [angular.configs.templateRecommended, angular.configs.templateAccessibility],
    rules: {
      '@angular-eslint/template/prefer-control-flow': 'error',
      '@angular-eslint/template/no-any': 'error',
      '@angular-eslint/template/button-has-type': 'error',
      '@angular-eslint/template/no-inline-styles': ['error', { allowNgStyle: false, allowBindToStyle: true }],
    },
  },
]);
