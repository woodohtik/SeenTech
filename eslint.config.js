// seen-cto-sprint4-design-quality-task.md item 2 (CTO review section
// 6/9): the project's "lint" script was `tsc --noEmit` only -- no ESLint
// existed anywhere, so nothing caught stale closures, missing hook deps,
// or unused imports before they shipped. Flat config (ESLint 9) rather
// than .eslintrc, matching this project's ESM-only setup ("type":
// "module" in package.json).
import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'dist-customer/**',
      'android/**',
      'capacitor-customer/**',
      'graphify-out/**',
      'src/graphify-out/**',
      'blog-rebuild-output/**',
      'public/**',
      '.superpowers/**',
      'scripts/legacy-oneoff/**',
    ],
  },
  {
    files: ['**/*.{ts,tsx}'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      globals: { ...globals.browser, ...globals.node },
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // Off: checked by actually enabling it (not assumed) -- every real
      // finding (contexts/*.tsx, OnboardingTour.tsx, AuthContext.tsx, ~20
      // total) is the standard React Context pattern of exporting a
      // Provider component and its matching useX() hook from the same
      // file, which this codebase uses throughout contexts/ deliberately.
      // Flagging that isn't catching a bug, it's fighting an idiom.
      'react-refresh/only-export-components': 'off',
      // TypeScript's own noUnusedLocals (tsconfig) already covers this
      // more precisely (ignores destructured-but-unused, etc.); avoid a
      // second, noisier opinion on the same thing.
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      // This codebase deliberately handles untyped Supabase RPC/webhook
      // payloads and third-party SDK callbacks as `any` in many places
      // (confirmed widespread, not a few spots) -- banning it outright
      // here would be hundreds of false-positive findings on day one,
      // not a real bug class. Left as a future tightening step once the
      // codebase has budget to type those boundaries properly.
      '@typescript-eslint/no-explicit-any': 'off',
      // Confirmed by reading every flagged site (not assumed): every one
      // is a deliberate best-effort fallback (JSON.parse of a legacy
      // encoding, Date parsing, localStorage access that can throw in
      // private browsing) -- the established pattern throughout this
      // codebase, not an accidentally-swallowed real error.
      'no-empty': ['error', { allowEmptyCatch: true }],
      // Default ('any') flags `let { data, error } = ...` whenever ANY one
      // of the destructured names is never reassigned, even when another
      // one genuinely is (PinLogin.tsx:211 -- staffRow is reassigned a few
      // lines down, staffErr isn't) -- splitting into two statements just
      // to satisfy this is churn, not a clearer bug. 'all' only flags a
      // destructuring when every bound name could be const.
      'prefer-const': ['error', { destructuring: 'all' }],
      // Same: every flagged site is `cond ? sideEffectA() : sideEffectB();`
      // used as a terse if/else for a function call, both arms real
      // side effects -- not a forgotten expression. typescript-eslint's
      // recommended config swaps in its own version of this rule for
      // .ts/.tsx files, so the base-ESLint override above alone doesn't
      // reach it -- both need the same option.
      'no-unused-expressions': 'off',
      '@typescript-eslint/no-unused-expressions': ['error', { allowTernary: true }],
    },
  },
);
