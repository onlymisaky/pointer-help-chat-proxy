import antfu from '@antfu/eslint-config'

export default antfu(
  {
    gitignore: true,
    ignores: [
      'dist',
    ],
    lessOpinionated: true,
    stylistic: true,
    typescript: true,
  },
  {
    rules: {
      'no-console': 'off',
    },
  },
)
