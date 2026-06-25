/**
 * pi-lint — Pi-native Extension Linter
 *
 * Checks for pi-specific API anti-patterns that cause runtime bugs.
 * Deterministic, no LLM calls, catches issues before npm publish.
 *
 * Tools:
 *   1. lint_extension — Scan extension source for anti-patterns
 *   2. lint_report    — Generate formatted markdown report
 *   3. lint_fix       — Auto-fix simple patterns
 *
 * Rules (8):
 *   no-union-enum (error)         — Type.Union/Type.Literal instead of StringEnum
 *   kebab-tool-name (error)       — Tool names in kebab-case instead of snake_case
 *   missing-hasui-guard (error)   — Missing ctx.hasUI guard before UI ops
 *   missing-default-export (error) — Missing export default function
 *   return-not-throw (warning)    — Returning error objects instead of throwing
 *   unhandled-partial (warning)   — Not handling isPartial/expanded
 *   unconditional-block (warning) — block: true set unconditionally
 *   missing-output-truncation (warning) — Tool output not truncated
 */

import {
	existsSync,
	readdirSync,
	readFileSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { join, relative } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

// ── Types ──────────────────────────────────────────────────────────

type Severity = "error" | "warning";

interface Finding {
	file: string;
	line: number;
	column: number;
	rule: string;
	severity: Severity;
	message: string;
	fix?: string;
}

interface LintOptions {
	/** Rules to enable (default: all) */
	rules?: string[];
	/** Severity filter (default: all) */
	severity?: Severity;
	/** File glob patterns to exclude */
	exclude?: string[];
}

interface LintReport {
	findings: Finding[];
	summary: {
		total: number;
		errors: number;
		warnings: number;
		filesScanned: number;
		rulesTriggered: Record<string, number>;
	};
}

interface FixResult {
	file: string;
	rule: string;
	fixed: boolean;
	description: string;
}

// ── Rule Registry ──────────────────────────────────────────────────

type RuleChecker = (content: string, filePath: string) => Finding[];

const RULES: Record<string, { severity: Severity; check: RuleChecker }> = {};

function registerRule(
	id: string,
	severity: Severity,
	check: RuleChecker,
): void {
	RULES[id] = { severity, check };
}

// ── Helpers ────────────────────────────────────────────────────────

function makeFinding(
	file: string,
	line: number,
	column: number,
	rule: string,
	severity: Severity,
	message: string,
	fix?: string,
): Finding {
	return { file, line, column, rule, severity, message, fix };
}

function getLineCol(
	content: string,
	index: number,
): { line: number; col: number } {
	const before = content.slice(0, index);
	const lines = before.split("\n");
	return {
		line: lines.length,
		col: (lines[lines.length - 1]?.length ?? 0) + 1,
	};
}

function findTsFiles(dir: string, exclude: string[] = []): string[] {
	const files: string[] = [];
	if (!existsSync(dir)) return files;

	const entries = readdirSync(dir, { withFileTypes: true });
	for (const entry of entries) {
		const fullPath = join(dir, entry.name);
		const relPath = relative(dir, fullPath);

		if (exclude.some((p) => relPath.includes(p))) continue;

		if (
			entry.isDirectory() &&
			entry.name !== "node_modules" &&
			entry.name !== "dist"
		) {
			files.push(...findTsFiles(fullPath, exclude));
		} else if (
			entry.isFile() &&
			(entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) &&
			!entry.name.endsWith(".d.ts") &&
			!entry.name.endsWith(".test.ts")
		) {
			files.push(fullPath);
		}
	}
	return files;
}

// ── Rule: no-union-enum ────────────────────────────────────────────

registerRule("no-union-enum", "error", (content, filePath) => {
	const findings: Finding[] = [];

	// Detect Type.Union([...Type.Literal(...)]) patterns
	const unionLiteralRe = /Type\.Union\s*\(\s*\[/g;
	let match = unionLiteralRe.exec(content);
	while (match !== null) {
		const { line, col } = getLineCol(content, match.index);
		// Check if the union contains Literal types (enum pattern)
		const afterMatch = content.slice(match.index, match.index + 500);
		if (/Type\.Literal\s*\(/.test(afterMatch)) {
			findings.push(
				makeFinding(
					filePath,
					line,
					col,
					"no-union-enum",
					"error",
					"Use StringEnum instead of Type.Union([Type.Literal(...)]) for enum values. StringEnum handles Google API enum serialization correctly.",
					"Replace with: import { StringEnum } from '@earendil-works/pi-coding-agent'; then use StringEnum(['val1', 'val2'])",
				),
			);
		}
		match = unionLiteralRe.exec(content);
	}

	// Also detect Type.Union with Type.Literal children on separate lines
	const unionRe = /Type\.Union\s*\(/g;
	match = unionRe.exec(content);
	while (match !== null) {
		const { line, col } = getLineCol(content, match.index);
		// Look ahead for Literal types within ~1000 chars
		const block = content.slice(match.index, match.index + 1000);
		const literalCount = (block.match(/Type\.Literal\s*\(/g) ?? []).length;
		if (literalCount >= 2) {
			// Check we haven't already reported this
			const alreadyFound = findings.some(
				(f) => f.line === line && f.rule === "no-union-enum",
			);
			if (!alreadyFound) {
				findings.push(
					makeFinding(
						filePath,
						line,
						col,
						"no-union-enum",
						"error",
						`Type.Union with ${literalCount} Literal types detected. Use StringEnum for enum values.`,
						"Replace with StringEnum(['val1', 'val2', ...])",
					),
				);
			}
		}
		match = unionRe.exec(content);
	}

	return findings;
});

// ── Rule: kebab-tool-name ──────────────────────────────────────────

registerRule("kebab-tool-name", "error", (content, filePath) => {
	const findings: Finding[] = [];

	// Match name: "some-tool-name" inside registerTool calls
	const toolNameRe =
		/registerTool\s*\(\s*\{[^}]*?name:\s*["']([a-z]+(?:-[a-z]+)+)["']/g;
	let match = toolNameRe.exec(content);
	while (match !== null) {
		const kebabName = match[1];
		const snakeName = kebabName?.replace(/-/g, "_");
		const { line, col } = getLineCol(content, match.index);
		findings.push(
			makeFinding(
				filePath,
				line,
				col,
				"kebab-tool-name",
				"error",
				`Tool name "${kebabName}" uses kebab-case. pi.dev requires snake_case.`,
				`Rename to "${snakeName}"`,
			),
		);
		match = toolNameRe.exec(content);
	}

	// Also match standalone name: "kebab-name" patterns in tool registrations
	const namePropRe = /name:\s*["']([a-z]+(?:-[a-z]+)+)["']/g;
	match = namePropRe.exec(content);
	while (match !== null) {
		const kebabName = match[1];
		const snakeName = kebabName?.replace(/-/g, "_");
		const { line, col } = getLineCol(content, match.index);
		// Avoid duplicates from the more specific regex above
		const alreadyFound = findings.some(
			(f) => f.line === line && f.rule === "kebab-tool-name",
		);
		if (!alreadyFound) {
			findings.push(
				makeFinding(
					filePath,
					line,
					col,
					"kebab-tool-name",
					"error",
					`Tool name "${kebabName}" uses kebab-case. pi.dev requires snake_case.`,
					`Rename to "${snakeName}"`,
				),
			);
		}
		match = namePropRe.exec(content);
	}

	return findings;
});

// ── Rule: missing-hasui-guard ──────────────────────────────────────

registerRule("missing-hasui-guard", "error", (content, filePath) => {
	const findings: Finding[] = [];

	// Find execute functions that reference UI operations without hasUI guard
	const executeRe = /async\s+execute\s*\([^)]*\)\s*\{/g;
	let match = executeRe.exec(content);
	while (match !== null) {
		const { line: execLine } = getLineCol(content, match.index);

		// Find the end of the execute function (rough brace matching)
		let depth = 1;
		let pos = match.index + match[0].length;
		while (pos < content.length && depth > 0) {
			if (content[pos] === "{") depth++;
			if (content[pos] === "}") depth--;
			pos++;
		}
		const funcBody = content.slice(match.index, pos);

		// Check for UI operations (renderResult, ctx.ui, ctx.render)
		const hasUIOp =
			/renderResult\s*\(/.test(funcBody) ||
			/ctx\.ui\b/.test(funcBody) ||
			/ctx\.render\b/.test(funcBody);

		if (hasUIOp) {
			// Check for hasUI guard
			const hasGuard =
				/ctx\.hasUI/.test(funcBody) || /hasUI\s*[!=]==?\s*true/.test(funcBody);

			if (!hasGuard) {
				findings.push(
					makeFinding(
						filePath,
						execLine,
						1,
						"missing-hasui-guard",
						"error",
						"Execute function uses UI operations but lacks a ctx.hasUI guard. UI operations will fail in headless environments.",
						"Add: if (!ctx.hasUI) { throw new Error('This tool requires a UI context'); }",
					),
				);
			}
		}

		match = executeRe.exec(content);
	}

	return findings;
});

// ── Rule: missing-default-export ───────────────────────────────────

registerRule("missing-default-export", "error", (content, filePath) => {
	const findings: Finding[] = [];

	// Only check extension.ts files
	const fileName = filePath.split(/[/\\]/).pop() ?? "";
	if (fileName !== "index.ts" && fileName !== "extension.ts") return findings;

	// Check for export default function
	const hasDefaultExport =
		/export\s+default\s+function/.test(content) ||
		/export\s+default\s+\(/.test(content) ||
		/export\s+default\s+\w/.test(content);

	if (!hasDefaultExport) {
		findings.push(
			makeFinding(
				filePath,
				1,
				1,
				"missing-default-export",
				"error",
				"Extension entry file missing 'export default function'. pi.dev requires a default export that registers the extension.",
				"Add: export default function(pi: ExtensionAPI) { ... }",
			),
		);
	}

	return findings;
});

// ── Rule: return-not-throw ─────────────────────────────────────────

registerRule("return-not-throw", "warning", (content, filePath) => {
	const findings: Finding[] = [];

	// Find execute functions
	const executeRe = /async\s+execute\s*\([^)]*\)\s*\{/g;
	let match = executeRe.exec(content);
	while (match !== null) {
		let depth = 1;
		let pos = match.index + match[0].length;
		while (pos < content.length && depth > 0) {
			if (content[pos] === "{") depth++;
			if (content[pos] === "}") depth--;
			pos++;
		}
		const funcBody = content.slice(match.index, pos);
		const funcStart = match.index;

		// Look for patterns like: return { content: [...], details: { error: ... } }
		// This is the "return error objects instead of throwing" pattern
		const returnErrorRe = /return\s*\{[^}]*?error\s*:/g;
		let returnMatch = returnErrorRe.exec(funcBody);
		while (returnMatch !== null) {
			const absIndex = funcStart + returnMatch.index;
			const { line, col } = getLineCol(content, absIndex);
			findings.push(
				makeFinding(
					filePath,
					line,
					col,
					"return-not-throw",
					"warning",
					"Returning error objects in execute function. pi.dev convention is to throw errors so the framework handles them.",
					"Replace with: throw new Error('message')",
				),
			);
			returnMatch = returnErrorRe.exec(funcBody);
		}

		// Also check for: return { content: [{ type: "text", text: "Error: ...
		const returnErrorMsgRe =
			/return\s*\{[^}]*?text:\s*["'`]❌|return\s*\{[^}]*?text:\s*["'`]?Error/g;
		returnMatch = returnErrorMsgRe.exec(funcBody);
		while (returnMatch !== null) {
			const absIndex = funcStart + returnMatch.index;
			const { line, col } = getLineCol(content, absIndex);
			const alreadyFound = findings.some(
				(f) => f.line === line && f.rule === "return-not-throw",
			);
			if (!alreadyFound) {
				findings.push(
					makeFinding(
						filePath,
						line,
						col,
						"return-not-throw",
						"warning",
						"Returning error text in execute function. Consider throwing an Error instead.",
						"Replace with: throw new Error('message')",
					),
				);
			}
			returnMatch = returnErrorMsgRe.exec(funcBody);
		}

		match = executeRe.exec(content);
	}

	return findings;
});

// ── Rule: unhandled-partial ────────────────────────────────────────

registerRule("unhandled-partial", "warning", (content, filePath) => {
	const findings: Finding[] = [];

	// Find renderResult calls that don't handle isPartial/expanded
	const renderRe = /renderResult\s*\(/g;
	let match = renderRe.exec(content);
	while (match !== null) {
		const { line, col } = getLineCol(content, match.index);

		// Check surrounding context (±500 chars) for isPartial/expanded handling
		const contextStart = Math.max(0, match.index - 200);
		const contextEnd = Math.min(content.length, match.index + 500);
		const context = content.slice(contextStart, contextEnd);

		const handlesPartial =
			/isPartial/.test(context) || /expanded/.test(context);

		if (!handlesPartial) {
			findings.push(
				makeFinding(
					filePath,
					line,
					col,
					"unhandled-partial",
					"warning",
					"renderResult call does not handle isPartial or expanded. Partial results may display incorrectly.",
					"Add handling: if (result.isPartial) { /* show loading state */ }",
				),
			);
		}

		match = renderRe.exec(content);
	}

	return findings;
});

// ── Rule: unconditional-block ──────────────────────────────────────

registerRule("unconditional-block", "warning", (content, filePath) => {
	const findings: Finding[] = [];

	// Find block: true that's set unconditionally (not inside an if/condition)
	const blockRe = /block:\s*true/g;
	let match = blockRe.exec(content);
	while (match !== null) {
		const { line, col } = getLineCol(content, match.index);

		// Check if this is inside a conditional (if/ternary) or a variable
		const beforeMatch = content.slice(
			Math.max(0, match.index - 300),
			match.index,
		);

		// Heuristic: if there's an 'if' statement within the last 200 chars, it might be conditional
		const lastIf = beforeMatch.lastIndexOf("if (");
		const lastIf2 = beforeMatch.lastIndexOf("if(");
		const lastConst = beforeMatch.lastIndexOf("const ");
		const lastLet = beforeMatch.lastIndexOf("let ");

		// If the nearest control flow before block:true is a variable assignment, it's likely unconditional
		const isLikelyUnconditional =
			lastIf === -1 && lastIf2 === -1 && (lastConst !== -1 || lastLet !== -1);

		// Also check if it's directly inside registerTool options (unconditional)
		const inRegisterTool = /registerTool\s*\(\s*\{/.test(
			beforeMatch.slice(-200),
		);

		if (isLikelyUnconditional || inRegisterTool) {
			findings.push(
				makeFinding(
					filePath,
					line,
					col,
					"unconditional-block",
					"warning",
					"'block: true' set unconditionally. Blocking should be conditional on context to avoid blocking in non-interactive environments.",
					"Make conditional: block: ctx.hasUI && shouldBlock",
				),
			);
		}

		match = blockRe.exec(content);
	}

	return findings;
});

// ── Rule: missing-output-truncation ────────────────────────────────

registerRule("missing-output-truncation", "warning", (content, filePath) => {
	const findings: Finding[] = [];

	// Find execute functions
	const executeRe = /async\s+execute\s*\([^)]*\)\s*\{/g;
	let match = executeRe.exec(content);
	while (match !== null) {
		let depth = 1;
		let pos = match.index + match[0].length;
		while (pos < content.length && depth > 0) {
			if (content[pos] === "{") depth++;
			if (content[pos] === "}") depth--;
			pos++;
		}
		const funcBody = content.slice(match.index, pos);
		const funcStart = match.index;

		// Check if the function builds large strings (join, concat, JSON.stringify)
		// without any truncation (.slice, .substring, .slice(0, max), truncate)
		const buildsLargeOutput =
			/\.join\s*\(\s*["'`]/.test(funcBody) ||
			/JSON\.stringify/.test(funcBody) ||
			/\.concat\s*\(/.test(funcBody);

		if (buildsLargeOutput) {
			const hasTruncation =
				/\.slice\s*\(\s*0\s*,/.test(funcBody) ||
				/\.substring\s*\(\s*0\s*,/.test(funcBody) ||
				/truncate/i.test(funcBody) ||
				/MAX_|LIMIT|MAXLEN/i.test(funcBody) ||
				/\.slice\(.*length.*\)/.test(funcBody);

			if (!hasTruncation) {
				const { line, col } = getLineCol(content, funcStart);
				findings.push(
					makeFinding(
						filePath,
						line,
						col,
						"missing-output-truncation",
						"warning",
						"Execute function builds potentially large output without truncation. Large outputs cause UI rendering issues.",
						"Add truncation: output.slice(0, MAX_OUTPUT_LENGTH)",
					),
				);
			}
		}

		match = executeRe.exec(content);
	}

	return findings;
});

// ── Lint Engine ────────────────────────────────────────────────────

function lintDirectory(dir: string, options: LintOptions = {}): LintReport {
	const enabledRules = options.rules ?? Object.keys(RULES);
	const files = findTsFiles(dir, options.exclude);
	const allFindings: Finding[] = [];

	for (const file of files) {
		try {
			const content = readFileSync(file, "utf-8");
			for (const ruleId of enabledRules) {
				const rule = RULES[ruleId];
				if (!rule) continue;

				// Filter by severity
				if (options.severity && rule.severity !== options.severity) continue;

				const findings = rule.check(content, file);
				allFindings.push(...findings);
			}
		} catch {
			// Skip files that can't be read
		}
	}

	// Sort by file, then line
	allFindings.sort((a, b) => {
		if (a.file !== b.file) return a.file.localeCompare(b.file);
		return a.line - b.line;
	});

	// Build summary
	const rulesTriggered: Record<string, number> = {};
	for (const f of allFindings) {
		rulesTriggered[f.rule] = (rulesTriggered[f.rule] ?? 0) + 1;
	}

	return {
		findings: allFindings,
		summary: {
			total: allFindings.length,
			errors: allFindings.filter((f) => f.severity === "error").length,
			warnings: allFindings.filter((f) => f.severity === "warning").length,
			filesScanned: files.length,
			rulesTriggered,
		},
	};
}

// ── Report Generator ───────────────────────────────────────────────

function generateReport(report: LintReport): string {
	const lines: string[] = [];
	const bar = "═".repeat(60);

	lines.push(`╔${bar}╗`);
	lines.push("║  🔍 PI-LINT REPORT");
	lines.push(`║  ${report.summary.filesScanned} files scanned`);
	lines.push(
		`║  ❌ ${report.summary.errors} errors | ⚠️  ${report.summary.warnings} warnings`,
	);
	lines.push(`╚${bar}╝`);
	lines.push("");

	if (report.findings.length === 0) {
		lines.push("✅ No anti-patterns found! Your extension looks clean.");
		return lines.join("\n");
	}

	// Group by file
	const byFile = new Map<string, Finding[]>();
	for (const f of report.findings) {
		const existing = byFile.get(f.file) ?? [];
		existing.push(f);
		byFile.set(f.file, existing);
	}

	for (const [file, findings] of byFile) {
		lines.push(`📄 ${file}`);
		lines.push("─".repeat(50));

		for (const f of findings) {
			const icon = f.severity === "error" ? "❌" : "⚠️";
			lines.push(`  ${icon} L${f.line}:${f.column} [${f.rule}] ${f.message}`);
			if (f.fix) {
				lines.push(`     💡 Fix: ${f.fix}`);
			}
		}
		lines.push("");
	}

	// Summary by rule
	lines.push("─".repeat(50));
	lines.push("📊 Rules triggered:");
	for (const [rule, count] of Object.entries(report.summary.rulesTriggered)) {
		const ruleDef = RULES[rule];
		const icon = ruleDef?.severity === "error" ? "❌" : "⚠️";
		lines.push(`  ${icon} ${rule}: ${count} occurrence(s)`);
	}

	lines.push("");
	if (report.summary.errors > 0) {
		lines.push(
			`❌ ${report.summary.errors} error(s) must be fixed before publishing.`,
		);
	} else {
		lines.push("✅ No errors. Warnings are advisory.");
	}

	return lines.join("\n");
}

// ── Auto-Fixer ─────────────────────────────────────────────────────

function autoFix(dir: string, options: LintOptions = {}): FixResult[] {
	const report = lintDirectory(dir, options);
	const results: FixResult[] = [];

	// Group findings by file for efficient fixing
	const byFile = new Map<string, Finding[]>();
	for (const f of report.findings) {
		const existing = byFile.get(f.file) ?? [];
		existing.push(f);
		byFile.set(f.file, existing);
	}

	for (const [file, findings] of byFile) {
		let content = readFileSync(file, "utf-8");
		let modified = false;

		for (const f of findings) {
			if (f.rule === "kebab-tool-name") {
				// Auto-fix: convert kebab-case tool names to snake_case
				const nameMatch = /name:\s*["']([a-z]+(?:-[a-z]+)+)["']/.exec(content);
				if (nameMatch?.[1]) {
					const kebab = nameMatch[1];
					const snake = kebab.replace(/-/g, "_");
					content = content.replace(`name: "${kebab}"`, `name: "${snake}"`);
					content = content.replace(`name: '${kebab}'`, `name: '${snake}'`);
					modified = true;
					results.push({
						file,
						rule: "kebab-tool-name",
						fixed: true,
						description: `Renamed "${kebab}" to "${snake}"`,
					});
				}
			} else if (f.rule === "no-union-enum") {
				// Auto-fix: add StringEnum import if missing
				if (!/import.*StringEnum/.test(content)) {
					// Add import after the last import statement
					const lastImportIdx = content.lastIndexOf("import ");
					const lastImportEnd = content.indexOf("\n", lastImportIdx);
					if (lastImportEnd !== -1) {
						content =
							content.slice(0, lastImportEnd + 1) +
							`import { StringEnum } from "@earendil-works/pi-coding-agent";\n` +
							content.slice(lastImportEnd + 1);
						modified = true;
						results.push({
							file,
							rule: "no-union-enum",
							fixed: true,
							description:
								"Added StringEnum import. Manual replacement of Type.Union patterns still needed.",
						});
					}
				}
			} else {
				results.push({
					file,
					rule: f.rule,
					fixed: false,
					description: `Manual fix required: ${f.fix ?? f.message}`,
				});
			}
		}

		if (modified) {
			// Write back the fixed content

			writeFileSync(file, content, "utf-8");
		}
	}

	return results;
}

// ── Extension Registration ─────────────────────────────────────────

export default function (pi: ExtensionAPI) {
	// ── Tool: lint_extension ─────────────────────────────────────
	pi.registerTool({
		name: "lint_extension",
		label: "Lint Extension",
		description:
			"Scan a pi.dev extension source directory for API anti-patterns. Returns structured findings with file, line, rule, severity, and fix suggestions. 8 rules covering enum handling, tool naming, UI guards, exports, error handling, partial results, blocking, and output truncation.",
		parameters: Type.Object({
			path: Type.String({
				description:
					"Path to the extension source directory (e.g., './extensions')",
			}),
			rules: Type.Optional(
				Type.Array(Type.String(), {
					description:
						"Specific rules to check (default: all). Available: no-union-enum, kebab-tool-name, missing-hasui-guard, missing-default-export, return-not-throw, unhandled-partial, unconditional-block, missing-output-truncation",
				}),
			),
			severity: Type.Optional(
				Type.String({
					description: "Filter by severity: 'error' or 'warning'",
					enum: ["error", "warning"],
				}),
			),
			exclude: Type.Optional(
				Type.Array(Type.String(), {
					description: "File path patterns to exclude from scanning",
				}),
			),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
			const dir = params.path;
			if (!existsSync(dir)) {
				throw new Error(`Directory not found: ${dir}`);
			}

			const options: LintOptions = {};
			if (params.rules) options.rules = params.rules;
			if (params.severity) options.severity = params.severity as Severity;
			if (params.exclude) options.exclude = params.exclude;

			const report = lintDirectory(dir, options);
			const formatted = generateReport(report);

			return {
				content: [{ type: "text", text: formatted }],
				details: {
					findings: report.findings,
					summary: report.summary,
				},
			};
		},
	});

	// ── Tool: lint_report ────────────────────────────────────────
	pi.registerTool({
		name: "lint_report",
		label: "Lint Report",
		description:
			"Generate a formatted markdown lint report from lint results. Groups findings by file, includes summary stats, rule breakdown, and fix suggestions.",
		parameters: Type.Object({
			path: Type.String({
				description: "Path to the extension source directory",
			}),
			rules: Type.Optional(
				Type.Array(Type.String(), {
					description: "Specific rules to check (default: all)",
				}),
			),
			format: Type.Optional(
				Type.String({
					description: "Output format: 'text' (default) or 'markdown'",
					enum: ["text", "markdown"],
				}),
			),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
			const dir = params.path;
			if (!existsSync(dir)) {
				throw new Error(`Directory not found: ${dir}`);
			}

			const options: LintOptions = {};
			if (params.rules) options.rules = params.rules;

			const report = lintDirectory(dir, options);
			const fmt = params.format ?? "text";

			let output: string;
			if (fmt === "markdown") {
				output = generateMarkdownReport(report);
			} else {
				output = generateReport(report);
			}

			return {
				content: [{ type: "text", text: output }],
				details: {
					findings: report.findings,
					summary: report.summary,
					format: fmt,
				},
			};
		},
	});

	// ── Tool: lint_fix ───────────────────────────────────────────
	pi.registerTool({
		name: "lint_fix",
		label: "Lint Auto-Fix",
		description:
			"Automatically fix simple anti-patterns in a pi.dev extension. Currently auto-fixes: kebab-to-snake tool names, adding StringEnum import. Returns list of fixes applied and manual fixes needed.",
		parameters: Type.Object({
			path: Type.String({
				description: "Path to the extension source directory",
			}),
			rules: Type.Optional(
				Type.Array(Type.String(), {
					description:
						"Rules to auto-fix (default: all fixable). Fixable: kebab-tool-name, no-union-enum",
				}),
			),
			dryRun: Type.Optional(
				Type.Boolean({
					description:
						"If true, show what would be fixed without making changes (default: false)",
				}),
			),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
			const dir = params.path;
			if (!existsSync(dir)) {
				throw new Error(`Directory not found: ${dir}`);
			}

			if (params.dryRun) {
				// Dry run: just report what would be fixed
				const report = lintDirectory(dir, {
					rules: params.rules ?? ["kebab-tool-name", "no-union-enum"],
				});
				const fixable = report.findings.filter(
					(f) => f.rule === "kebab-tool-name" || f.rule === "no-union-enum",
				);
				const text = [
					`🔍 Dry run: ${fixable.length} fixable issue(s) found`,
					"",
					...fixable.map(
						(f) => `  ${f.file}:${f.line} [${f.rule}] ${f.fix ?? f.message}`,
					),
					fixable.length === 0 ? "  No auto-fixable issues found." : "",
				]
					.filter(Boolean)
					.join("\n");

				return {
					content: [{ type: "text", text }],
					details: { fixable: fixable.length, dryRun: true },
				};
			}

			const results = autoFix(dir, {
				rules: params.rules ?? ["kebab-tool-name", "no-union-enum"],
			});

			const fixed = results.filter((r) => r.fixed);
			const manual = results.filter((r) => !r.fixed);

			const text = [
				`🔧 Auto-fix complete: ${fixed.length} fixed, ${manual.length} need manual attention`,
				"",
				...(fixed.length > 0
					? [
							"✅ Fixed:",
							...fixed.map((r) => `  ${r.file} [${r.rule}] ${r.description}`),
						]
					: []),
				...(manual.length > 0
					? [
							"",
							"⚠️ Manual fixes needed:",
							...manual.map((r) => `  ${r.file} [${r.rule}] ${r.description}`),
						]
					: []),
			].join("\n");

			return {
				content: [{ type: "text", text }],
				details: { fixed: fixed.length, manual: manual.length, results },
			};
		},
	});
}

// ── Markdown Report Generator ──────────────────────────────────────

function generateMarkdownReport(report: LintReport): string {
	const lines: string[] = [];

	lines.push("# 🔍 PI-LINT REPORT\n");
	lines.push(`**Files scanned:** ${report.summary.filesScanned}`);
	lines.push(
		`**Findings:** ${report.summary.total} (${report.summary.errors} errors, ${report.summary.warnings} warnings)\n`,
	);

	if (report.findings.length === 0) {
		lines.push("> ✅ No anti-patterns found! Your extension looks clean.");
		return lines.join("\n");
	}

	lines.push("## Findings\n");

	// Group by file
	const byFile = new Map<string, Finding[]>();
	for (const f of report.findings) {
		const existing = byFile.get(f.file) ?? [];
		existing.push(f);
		byFile.set(f.file, existing);
	}

	for (const [file, findings] of byFile) {
		lines.push(`### 📄 \`${file}\`\n`);
		lines.push("| Line | Rule | Severity | Message | Fix |");
		lines.push("|------|------|----------|---------|-----|");
		for (const f of findings) {
			const icon = f.severity === "error" ? "❌" : "⚠️";
			lines.push(
				`| ${f.line} | \`${f.rule}\` | ${icon} ${f.severity} | ${f.message} | ${f.fix ?? "—"} |`,
			);
		}
		lines.push("");
	}

	lines.push("## Rule Summary\n");
	lines.push("| Rule | Count | Severity |");
	lines.push("|------|-------|----------|");
	for (const [rule, count] of Object.entries(report.summary.rulesTriggered)) {
		const ruleDef = RULES[rule];
		const icon = ruleDef?.severity === "error" ? "❌" : "⚠️";
		lines.push(
			`| \`${rule}\` | ${count} | ${icon} ${ruleDef?.severity ?? "unknown"} |`,
		);
	}

	return lines.join("\n");
}

// ── Exports for Testing ────────────────────────────────────────────

export type { Finding, FixResult, LintOptions, LintReport, Severity };
export {
	autoFix,
	generateMarkdownReport,
	generateReport,
	lintDirectory,
	RULES,
};
