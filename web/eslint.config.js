// web/eslint.config.js
// 目标：抓真 bug（未定义、未使用、可疑逻辑），不做风格审美（无 prettier，格式维持现状）。
import js from '@eslint/js';
import vue from 'eslint-plugin-vue';
import tseslint from 'typescript-eslint';
import globals from 'globals';

export default tseslint.config(
  { ignores: ['dist/', 'node_modules/'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...vue.configs['flat/recommended'],
  {
    files: ['**/*.vue'],
    languageOptions: { parserOptions: { parser: tseslint.parser } },
  },
  {
    languageOptions: { globals: { ...globals.browser } },
    rules: {
      // 代码里大量刻意的 any（渐进收紧是另一个项目），先不作为门槛
      '@typescript-eslint/no-explicit-any': 'off',
      // catch (_) {} / 形参占位是仓库既有习惯
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrors: 'none' }],
      'no-empty': ['error', { allowEmptyCatch: true }],
      // `cond ? sideEffectA() : sideEffectB()` 当语句用是仓库既有写法（如 Home.vue refresh()），非 bug
      '@typescript-eslint/no-unused-expressions': ['error', { allowTernary: true }],
      // 真 bug 类：flat/recommended 里只给 warn，升 error 当门槛
      'vue/no-template-shadow': 'error',
      'vue/this-in-template': 'error',
      'vue/require-explicit-emits': 'error',
      'vue/no-v-html': 'error',
      'vue/no-lone-template': 'error',
      'vue/no-multiple-slot-args': 'error',
      'vue/no-required-prop-with-default': 'error',
      // 风格类规则全关（无 prettier，保持现有手写格式）。
      // flat/recommended 的 warn 级规则已逐条核对：除上面七条升 error 外，其余全部显式 off。
      'vue/html-quotes': 'off',
      'vue/multi-word-component-names': 'off',
      'vue/max-attributes-per-line': 'off',
      'vue/singleline-html-element-content-newline': 'off',
      'vue/multiline-html-element-content-newline': 'off',
      'vue/html-self-closing': 'off',
      'vue/attributes-order': 'off',
      'vue/html-indent': 'off',
      'vue/first-attribute-linebreak': 'off',
      'vue/html-closing-bracket-newline': 'off',
      'vue/html-closing-bracket-spacing': 'off',
      'vue/attribute-hyphenation': 'off',
      'vue/block-order': 'off',
      'vue/component-definition-name-casing': 'off',
      'vue/html-end-tags': 'off',
      'vue/mustache-interpolation-spacing': 'off',
      'vue/no-multi-spaces': 'off',
      'vue/no-spaces-around-equal-signs-in-attribute': 'off',
      'vue/order-in-components': 'off',
      'vue/prop-name-casing': 'off',
      'vue/v-bind-style': 'off',
      'vue/v-on-event-hyphenation': 'off',
      'vue/v-on-style': 'off',
      'vue/v-slot-style': 'off',
      // 最佳实践类（recommended 给 warn，非「真 bug」）：本阶段不作门槛，显式关；要升级另议
      'vue/one-component-per-file': 'off',
      'vue/require-default-prop': 'off',
      'vue/require-prop-types': 'off',
    },
  },
);
