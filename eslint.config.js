import js from '@eslint/js'
import globals from 'globals'
import react from 'eslint-plugin-react'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'

export default [
  { ignores: ['dist', 'node_modules'] },
  {
    files: ['**/*.{js,jsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.browser, ...globals.node },
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    plugins: {
      react,
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...js.configs.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      // Помечает JSX-компоненты как использованные (иначе no-unused-vars
      // ложно ругается на импорты, встречающиеся только в разметке).
      'react/jsx-uses-vars': 'error',
      'react/jsx-uses-react': 'error',
      'react-refresh/only-export-components': [
        'warn',
        { allowConstantExport: true },
      ],
      // Прагматичные послабления для текущей кодовой базы:
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-empty': ['warn', { allowEmptyCatch: true }],
      // setState в эффекте встречается в существующих компонентах — пока warning,
      // отдельной задачей: пересмотреть эти эффекты (см. Дорожную карту, Фаза 0).
      'react-hooks/set-state-in-effect': 'warn',
      // react-hooks/purity (v6+) ругается на Date.now/Math.random в
      // рендере/useMemo. У нас пара мест: расчёт длительности смены и
      // «сколько прошло с логина». Обёртывать в useState+useEffect ради
      // pure — избыточно (пересчёт не критичен), поэтому downgrade до
      // warn. Reminder: заменить эти места на useState + setInterval,
      // когда будет отдельная итерация по гигиене эффектов.
      'react-hooks/purity': 'warn',
    },
  },
  {
    // В тестах доступны глобали Vitest, если используются без импорта
    files: ['**/*.{test,spec}.{js,jsx}'],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
]
