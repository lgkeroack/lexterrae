# Lex Terrae — Code Quality Standards

## Linting & Formatting

### ESLint Configuration

```jsonc
// .eslintrc.json — project root
{
  "root": true,
  "parser": "@typescript-eslint/parser",
  "parserOptions": {
    "project": ["./tsconfig.json"],
    "ecmaVersion": 2024,
    "sourceType": "module",
  },
  "plugins": ["@typescript-eslint", "import", "security", "sonarjs"],
  "extends": [
    "eslint:recommended",
    "plugin:@typescript-eslint/strict-type-checked",
    "plugin:@typescript-eslint/stylistic-type-checked",
    "plugin:import/typescript",
    "plugin:security/recommended-legacy",
    "plugin:sonarjs/recommended",
    "prettier",
  ],
  "rules": {
    // Prevent implicit any and unsafe operations
    "@typescript-eslint/no-explicit-any": "error",
    "@typescript-eslint/no-unsafe-assignment": "error",
    "@typescript-eslint/no-unsafe-call": "error",
    "@typescript-eslint/no-unsafe-member-access": "error",
    "@typescript-eslint/no-unsafe-return": "error",

    // Enforce exhaustive checks
    "@typescript-eslint/switch-exhaustiveness-check": "error",

    // Import ordering
    "import/order": [
      "error",
      {
        "groups": ["builtin", "external", "internal", "parent", "sibling", "index"],
        "newlines-between": "always",
        "alphabetize": { "order": "asc" },
      },
    ],
    "import/no-cycle": "error",
    "import/no-duplicates": "error",

    // Code complexity guards
    "sonarjs/cognitive-complexity": ["error", 15],
    "max-depth": ["error", 4],
    "max-lines-per-function": ["warn", { "max": 80, "skipBlankLines": true, "skipComments": true }],

    // Security
    "security/detect-object-injection": "warn",
    "security/detect-non-literal-regexp": "warn",
    "security/detect-unsafe-regex": "error",

    // General
    "no-console": ["warn", { "allow": ["warn", "error"] }],
    "no-debugger": "error",
    "prefer-const": "error",
    "no-var": "error",
  },
}
```

### Prettier Configuration

```jsonc
// .prettierrc
{
  "semi": true,
  "singleQuote": true,
  "trailingComma": "all",
  "printWidth": 100,
  "tabWidth": 2,
  "arrowParens": "always",
  "endOfLine": "lf",
}
```

### TypeScript Strict Mode

```jsonc
// tsconfig.json — base config
{
  "compilerOptions": {
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "noPropertyAccessFromIndexSignature": true,
    "exactOptionalPropertyTypes": true,
    "forceConsistentCasingInFileNames": true,
    "verbatimModuleSyntax": true,
  },
}
```

---

## Code Review Checklist

Every pull request must be reviewed against these criteria before merging.

### Correctness

- [ ] Does the code do what the ticket/task describes?
- [ ] Are edge cases handled (null, undefined, empty arrays, boundary values)?
- [ ] Are error paths tested, not just happy paths?
- [ ] Do database queries use parameterized statements (no string concatenation)?
- [ ] Are file operations wrapped in try/catch with cleanup on failure?

### Type Safety

- [ ] No use of `any` type (use `unknown` + type narrowing instead)
- [ ] No type assertions (`as`) unless justified with a comment explaining why
- [ ] Zod schemas validate all external input (API requests, file metadata, query params)
- [ ] Return types explicitly declared on all exported functions
- [ ] Discriminated unions used for state that can be in multiple shapes

### Naming & Readability

- [ ] Variables and functions named for what they represent, not abbreviations
- [ ] Boolean variables prefixed with `is`, `has`, `can`, `should`
- [ ] Constants in UPPER_SNAKE_CASE
- [ ] Types/interfaces in PascalCase
- [ ] Files named in kebab-case matching their primary export
- [ ] No single-letter variables except `i`/`j` in short loops or `e` for event handlers

### Architecture

- [ ] Business logic separated from HTTP layer (controllers call services)
- [ ] No direct database access from route handlers or React components
- [ ] Shared types defined in `packages/shared`, not duplicated
- [ ] Side effects (file I/O, network, DB) isolated in service functions
- [ ] Dependencies injected, not imported directly in business logic

### Testing

- [ ] New code has corresponding unit tests
- [ ] Tests cover: valid input, invalid input, edge cases, error conditions
- [ ] No test interdependence (each test can run in isolation)
- [ ] Mocks used for external services (R2, database) in unit tests
- [ ] Integration tests exist for critical paths (upload flow, jurisdiction assignment)

---

## Automated Quality Gates

### Pre-Commit (Husky + lint-staged)

```jsonc
// .lintstagedrc
{
  "*.{ts,tsx}": ["eslint --fix", "prettier --write"],
  "*.{json,md,yml}": ["prettier --write"],
}
```

### Pre-Push

```bash
pnpm typecheck && pnpm test --run
```

### CI Pipeline (GitHub Actions)

```yaml
# .github/workflows/ci.yml
name: CI
on: [push, pull_request]
jobs:
  quality:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: pnpm install --frozen-lockfile
      - run: pnpm lint
      - run: pnpm typecheck
      - run: pnpm test --coverage
      - run: pnpm build
      # Coverage threshold enforcement
      - name: Check coverage
        run: |
          COVERAGE=$(cat coverage/coverage-summary.json | jq '.total.lines.pct')
          if (( $(echo "$COVERAGE < 80" | bc -l) )); then
            echo "Coverage $COVERAGE% is below 80% threshold"
            exit 1
          fi
```

### Quality Thresholds

| Metric                                     | Minimum | Target |
| ------------------------------------------ | ------- | ------ |
| Line coverage                              | 80%     | 90%    |
| Branch coverage                            | 75%     | 85%    |
| Cognitive complexity per function          | ≤ 15    | ≤ 10   |
| Lines per function                         | ≤ 80    | ≤ 50   |
| Cyclomatic complexity per function         | ≤ 10    | ≤ 7    |
| TypeScript strict errors                   | 0       | 0      |
| ESLint errors                              | 0       | 0      |
| Dependency vulnerabilities (critical/high) | 0       | 0      |

---

## Dependency Management

- Run `pnpm audit` weekly; critical/high vulnerabilities must be resolved within 48 hours
- Pin exact dependency versions in `pnpm-lock.yaml`
- Use Renovate or Dependabot for automated update PRs
- No dependencies with fewer than 100 weekly downloads or unmaintained (> 2 years since last publish) without explicit justification documented in an ADR
- Prefer well-maintained, audited libraries for security-sensitive operations (bcryptjs, jose, hono/secure-headers, etc.)

---

## Commit Convention

Follow Conventional Commits:

```
<type>(<scope>): <short description>

[optional body]

[optional footer]
```

Types: `feat`, `fix`, `docs`, `style`, `refactor`, `test`, `chore`, `perf`, `security`

Scopes: `api`, `web`, `map`, `upload`, `auth`, `db`, `ci`, `deps`

Examples:

```
feat(map): add province drill-down with municipality selection
fix(upload): prevent double-submit when upload is in progress
security(api): add rate limiting to authentication endpoints
test(map): add E2E tests for multi-province selection flow
```
