---
name: pi-lint
description: "Pi-native extension linter — scan for API anti-patterns before publish"
version: 1.0.0
author: realvendex
tags: [lint, anti-patterns, extension, validation]
---

# pi-lint

Scan pi.dev extension source code for anti-patterns that cause runtime bugs.

## Tools

- `lint_extension` — Scan directory for anti-patterns (8 rules)
- `lint_report` — Generate formatted markdown report
- `lint_fix` — Auto-fix kebab tool names, add StringEnum import

## Rules

| Rule | Severity |
|------|----------|
| no-union-enum | error |
| kebab-tool-name | error |
| missing-hasui-guard | error |
| missing-default-export | error |
| return-not-throw | warning |
| unhandled-partial | warning |
| unconditional-block | warning |
| missing-output-truncation | warning |
