# pi-lint

> Pi-native extension linter that checks for pi-specific API anti-patterns — deterministic, no LLM calls, catches runtime bugs before npm publish.

## Installation

```bash
pi install npm:@realvendex/pi-lint
```

## What It Does

pi-lint scans your pi.dev extension source code for common anti-patterns that cause runtime bugs. Unlike general code quality tools, pi-lint understands pi.dev-specific APIs and conventions.

**Key features:**
- 8 rules covering enum handling, tool naming, UI guards, exports, error handling, partial results, blocking, and output truncation
- Deterministic pattern matching — no LLM calls, instant results
- Auto-fix for simple patterns (kebab-to-snake names, StringEnum imports)
- Structured output with file, line, column, rule, severity, and fix suggestions
- Text and markdown report formats

## Tools

### `lint_extension`

Scan a pi.dev extension source directory for API anti-patterns.

**Parameters:**
- `path` (string, required) — Path to the extension source directory
- `rules` (string[], optional) — Specific rules to check (default: all)
- `severity` (string, optional) — Filter by severity: "error" or "warning"
- `exclude` (string[], optional) — File path patterns to exclude

**Example:**
```
Use the lint_extension tool with path="./extensions"
```

### `lint_report`

Generate a formatted markdown lint report from scan results.

**Parameters:**
- `path` (string, required) — Path to the extension source directory
- `rules` (string[], optional) — Specific rules to check
- `format` (string, optional) — Output format: "text" or "markdown"

**Example:**
```
Use the lint_report tool with path="./extensions" format="markdown"
```

### `lint_fix`

Auto-fix simple anti-patterns. Currently supports:
- Converting kebab-case tool names to snake_case
- Adding StringEnum import when Union/Literal enum pattern detected

**Parameters:**
- `path` (string, required) — Path to the extension source directory
- `rules` (string[], optional) — Rules to auto-fix
- `dryRun` (boolean, optional) — Show what would be fixed without making changes

**Example:**
```
Use the lint_fix tool with path="./extensions" dryRun=true
```

## Rules

| Rule | Severity | Description |
|------|----------|-------------|
| `no-union-enum` | error | Type.Union/Type.Literal instead of StringEnum (breaks Google API enum handling) |
| `kebab-tool-name` | error | Tool names in kebab-case instead of snake_case (pi.dev requires snake_case) |
| `missing-hasui-guard` | error | Missing `ctx.hasUI` guard before UI operations in tool execute |
| `missing-default-export` | error | Missing `export default function` in extension.ts |
| `return-not-throw` | warning | Returning error objects instead of throwing Error (pi.dev convention: throw) |
| `unhandled-partial` | warning | Not handling `isPartial`/`expanded` in renderResult |
| `unconditional-block` | warning | `block: true` set unconditionally (should be conditional on context) |
| `missing-output-truncation` | warning | Tool output not truncated (large outputs cause UI issues) |

## Resources

- [npm](https://www.npmjs.com/package/pi-lint)
- [GitHub](https://github.com/ZachDreamZ/pi-lint)
- [pi.dev](https://pi.dev/packages/pi-lint)

## License

MIT
