import js from '@eslint/js'
import globals from 'globals'
import react from 'eslint-plugin-react'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{js,jsx}'],
    plugins: { react },
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
      parserOptions: {
        ecmaVersion: 'latest',
        ecmaFeatures: { jsx: true },
        sourceType: 'module',
      },
    },
    rules: {
      // ⚠️ Sans cette règle, ESLint ne voit pas que `<motion.div>` utilise la variable
      // `motion` : il la déclare « jamais utilisée » et on supprime un import
      // indispensable. C'est arrivé — quatre écrans en page blanche.
      'react/jsx-uses-vars': 'error',
      'react/jsx-uses-react': 'error',
      // `_` en préfixe = « je sais que je l'ignore » (convention JS courante).
      // Les blocs catch, eux, ne sont pas exemptés : une erreur avalée sans trace
      // doit rester visible — c'est ce qui avait caché le 401 de /settings/tax.
      'no-unused-vars': ['error', { varsIgnorePattern: '^[A-Z_]', argsIgnorePattern: '^_' }],
    },
  },
])
