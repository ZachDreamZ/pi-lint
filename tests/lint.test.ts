import {
	existsSync,
	mkdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Finding } from "../extensions/index";
import {
	autoFix,
	generateMarkdownReport,
	generateReport,
	lintDirectory,
	RULES,
} from "../extensions/index";

// ── Test Helpers ───────────────────────────────────────────────────

// Use process.cwd() which is the project root in vitest
const TEST_DIR = join(process.cwd(), "tests", "__test_fixtures__");

function setupFixture(files: Record<string, string>): void {
	if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
	mkdirSync(TEST_DIR, { recursive: true });
	for (const [name, content] of Object.entries(files)) {
		const filePath = join(TEST_DIR, name);
		const dir = filePath.substring(
			0,
			Math.max(filePath.lastIndexOf("/"), filePath.lastIndexOf("\\")),
		);
		if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
		writeFileSync(filePath, content, "utf-8");
	}
}

function cleanup(): void {
	if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
}

function findRule(findings: Finding[], rule: string): Finding[] {
	return findings.filter((f) => f.rule === rule);
}

// ── Tests ──────────────────────────────────────────────────────────

describe("pi-lint", () => {
	beforeEach(() => cleanup());
	afterEach(() => cleanup());

	describe("Rule registry", () => {
		it("should have all 8 rules registered", () => {
			expect(Object.keys(RULES)).toHaveLength(8);
			expect(RULES["no-union-enum"]).toBeDefined();
			expect(RULES["kebab-tool-name"]).toBeDefined();
			expect(RULES["missing-hasui-guard"]).toBeDefined();
			expect(RULES["missing-default-export"]).toBeDefined();
			expect(RULES["return-not-throw"]).toBeDefined();
			expect(RULES["unhandled-partial"]).toBeDefined();
			expect(RULES["unconditional-block"]).toBeDefined();
			expect(RULES["missing-output-truncation"]).toBeDefined();
		});

		it("should have correct severities", () => {
			expect(RULES["no-union-enum"]?.severity).toBe("error");
			expect(RULES["kebab-tool-name"]?.severity).toBe("error");
			expect(RULES["missing-hasui-guard"]?.severity).toBe("error");
			expect(RULES["missing-default-export"]?.severity).toBe("error");
			expect(RULES["return-not-throw"]?.severity).toBe("warning");
			expect(RULES["unhandled-partial"]?.severity).toBe("warning");
			expect(RULES["unconditional-block"]?.severity).toBe("warning");
			expect(RULES["missing-output-truncation"]?.severity).toBe("warning");
		});
	});

	describe("no-union-enum", () => {
		it("should detect Type.Union with Type.Literal", () => {
			setupFixture({
				"index.ts": `
import { Type } from "typebox";
const Status = Type.Union([
  Type.Literal("active"),
  Type.Literal("inactive"),
]);
`,
			});
			const report = lintDirectory(TEST_DIR);
			const findings = findRule(report.findings, "no-union-enum");
			expect(findings.length).toBeGreaterThan(0);
			expect(findings[0]?.severity).toBe("error");
			expect(findings[0]?.fix).toContain("StringEnum");
		});

		it("should not flag StringEnum usage", () => {
			setupFixture({
				"index.ts": `
import { StringEnum } from "@earendil-works/pi-coding-agent";
const Status = StringEnum(["active", "inactive"]);
`,
			});
			const report = lintDirectory(TEST_DIR);
			const findings = findRule(report.findings, "no-union-enum");
			expect(findings.length).toBe(0);
		});
	});

	describe("kebab-tool-name", () => {
		it("should detect kebab-case tool names", () => {
			setupFixture({
				"index.ts": `
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
export default function(pi: ExtensionAPI) {
  pi.registerTool({
    name: "my-tool",
    description: "test",
    parameters: {},
    async execute() { return { content: [] }; }
  });
}
`,
			});
			const report = lintDirectory(TEST_DIR);
			const findings = findRule(report.findings, "kebab-tool-name");
			expect(findings.length).toBeGreaterThan(0);
			expect(findings[0]?.fix).toContain("my_tool");
		});

		it("should not flag snake_case tool names", () => {
			setupFixture({
				"index.ts": `
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
export default function(pi: ExtensionAPI) {
  pi.registerTool({
    name: "my_tool",
    description: "test",
    parameters: {},
    async execute() { return { content: [] }; }
  });
}
`,
			});
			const report = lintDirectory(TEST_DIR);
			const findings = findRule(report.findings, "kebab-tool-name");
			expect(findings.length).toBe(0);
		});
	});

	describe("missing-hasui-guard", () => {
		it("should detect missing hasUI guard with UI operations", () => {
			setupFixture({
				"index.ts": `
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
export default function(pi: ExtensionAPI) {
  pi.registerTool({
    name: "test_tool",
    description: "test",
    parameters: {},
    async execute(_id, _params, _signal, _onUpdate, ctx) {
      ctx.ui.render("hello");
      return { content: [] };
    }
  });
}
`,
			});
			const report = lintDirectory(TEST_DIR);
			const findings = findRule(report.findings, "missing-hasui-guard");
			expect(findings.length).toBeGreaterThan(0);
			expect(findings[0]?.severity).toBe("error");
		});

		it("should not flag when hasUI guard is present", () => {
			setupFixture({
				"index.ts": `
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
export default function(pi: ExtensionAPI) {
  pi.registerTool({
    name: "test_tool",
    description: "test",
    parameters: {},
    async execute(_id, _params, _signal, _onUpdate, ctx) {
      if (!ctx.hasUI) throw new Error("No UI");
      ctx.ui.render("hello");
      return { content: [] };
    }
  });
}
`,
			});
			const report = lintDirectory(TEST_DIR);
			const findings = findRule(report.findings, "missing-hasui-guard");
			expect(findings.length).toBe(0);
		});
	});

	describe("missing-default-export", () => {
		it("should detect missing default export in index.ts", () => {
			setupFixture({
				"index.ts": `
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
function register(pi: ExtensionAPI) {
  pi.registerTool({ name: "test", description: "test", parameters: {}, async execute() { return { content: [] }; } });
}
`,
			});
			const report = lintDirectory(TEST_DIR);
			const findings = findRule(report.findings, "missing-default-export");
			expect(findings.length).toBeGreaterThan(0);
		});

		it("should not flag when default export exists", () => {
			setupFixture({
				"index.ts": `
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
export default function(pi: ExtensionAPI) {
  pi.registerTool({ name: "test", description: "test", parameters: {}, async execute() { return { content: [] }; } });
}
`,
			});
			const report = lintDirectory(TEST_DIR);
			const findings = findRule(report.findings, "missing-default-export");
			expect(findings.length).toBe(0);
		});

		it("should only check index.ts and extension.ts files", () => {
			setupFixture({
				"helpers.ts": `
export function helper() { return 42; }
`,
			});
			const report = lintDirectory(TEST_DIR);
			const findings = findRule(report.findings, "missing-default-export");
			expect(findings.length).toBe(0);
		});
	});

	describe("return-not-throw", () => {
		it("should detect returning error objects in execute", () => {
			setupFixture({
				"index.ts": `
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
export default function(pi: ExtensionAPI) {
  pi.registerTool({
    name: "test_tool",
    description: "test",
    parameters: {},
    async execute() {
      try {
        return { content: [{ type: "text", text: "ok" }] };
      } catch (err) {
        return { content: [{ type: "text", text: "Error: failed" }], details: { error: "failed" } };
      }
    }
  });
}
`,
			});
			const report = lintDirectory(TEST_DIR);
			const findings = findRule(report.findings, "return-not-throw");
			expect(findings.length).toBeGreaterThan(0);
			expect(findings[0]?.severity).toBe("warning");
		});
	});

	describe("unconditional-block", () => {
		it("should detect unconditional block: true in registerTool", () => {
			setupFixture({
				"index.ts": `
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
export default function(pi: ExtensionAPI) {
  pi.registerTool({
    name: "test_tool",
    description: "test",
    block: true,
    parameters: {},
    async execute() { return { content: [] }; }
  });
}
`,
			});
			const report = lintDirectory(TEST_DIR);
			const findings = findRule(report.findings, "unconditional-block");
			expect(findings.length).toBeGreaterThan(0);
			expect(findings[0]?.severity).toBe("warning");
		});
	});

	describe("Lint directory scanning", () => {
		it("should scan multiple files", () => {
			setupFixture({
				"index.ts": `
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
export default function(pi: ExtensionAPI) {}
`,
				"utils.ts": `
const Status = Type.Union([Type.Literal("a"), Type.Literal("b")]);
`,
			});
			const report = lintDirectory(TEST_DIR);
			expect(report.summary.filesScanned).toBe(2);
		});

		it("should skip node_modules and dist", () => {
			setupFixture({
				"index.ts": `
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
export default function(pi: ExtensionAPI) {}
`,
				"node_modules/foo.ts": `const x = Type.Union([Type.Literal("a")]);`,
				"dist/bar.ts": `const x = Type.Union([Type.Literal("a")]);`,
			});
			const report = lintDirectory(TEST_DIR);
			expect(report.summary.filesScanned).toBe(1);
		});

		it("should handle non-existent directory", () => {
			const report = lintDirectory("/nonexistent/path");
			expect(report.summary.filesScanned).toBe(0);
			expect(report.findings.length).toBe(0);
		});

		it("should filter by severity", () => {
			setupFixture({
				"index.ts": `
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
export default function(pi: ExtensionAPI) {
  pi.registerTool({
    name: "my-tool",
    description: "test",
    parameters: {},
    async execute() { return { content: [] }; }
  });
}
`,
			});
			const report = lintDirectory(TEST_DIR, { severity: "error" });
			for (const f of report.findings) {
				expect(f.severity).toBe("error");
			}
		});

		it("should filter by specific rules", () => {
			setupFixture({
				"index.ts": `
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
export default function(pi: ExtensionAPI) {
  pi.registerTool({
    name: "my-tool",
    description: "test",
    parameters: {},
    async execute() { return { content: [] }; }
  });
}
`,
			});
			const report = lintDirectory(TEST_DIR, {
				rules: ["kebab-tool-name"],
			});
			expect(report.findings.length).toBeGreaterThan(0);
			for (const f of report.findings) {
				expect(f.rule).toBe("kebab-tool-name");
			}
		});
	});

	describe("Report generation", () => {
		it("should generate text report with summary", () => {
			setupFixture({
				"index.ts": `
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
export default function(pi: ExtensionAPI) {
  pi.registerTool({
    name: "my-tool",
    description: "test",
    parameters: {},
    async execute() { return { content: [] }; }
  });
}
`,
			});
			const report = lintDirectory(TEST_DIR);
			const text = generateReport(report);
			expect(text).toContain("PI-LINT REPORT");
			expect(text).toContain("files scanned");
		});

		it("should generate markdown report with tables", () => {
			setupFixture({
				"index.ts": `
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
export default function(pi: ExtensionAPI) {
  pi.registerTool({
    name: "my-tool",
    description: "test",
    parameters: {},
    async execute() { return { content: [] }; }
  });
}
`,
			});
			const report = lintDirectory(TEST_DIR);
			const md = generateMarkdownReport(report);
			expect(md).toContain("# 🔍 PI-LINT REPORT");
			expect(md).toContain("| Line | Rule |");
		});

		it("should show clean message when no findings", () => {
			setupFixture({
				"index.ts": `
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
export default function(pi: ExtensionAPI) {
  pi.registerTool({
    name: "test_tool",
    description: "test",
    parameters: {},
    async execute() { return { content: [] }; }
  });
}
`,
			});
			const report = lintDirectory(TEST_DIR);
			const text = generateReport(report);
			expect(text).toContain("No anti-patterns found");
		});
	});

	describe("Auto-fix", () => {
		it("should auto-fix kebab-case tool names", () => {
			setupFixture({
				"index.ts": `
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
export default function(pi: ExtensionAPI) {
  pi.registerTool({
    name: "my-tool",
    description: "test",
    parameters: {},
    async execute() { return { content: [] }; }
  });
}
`,
			});
			const results = autoFix(TEST_DIR);
			const fixed = results.filter((r) => r.fixed);
			expect(fixed.length).toBeGreaterThan(0);

			// Verify the file was actually fixed
			const content = readFileSync(join(TEST_DIR, "index.ts"), "utf-8");
			expect(content).toContain('name: "my_tool"');
			expect(content).not.toContain('name: "my-tool"');
		});

		it("should add StringEnum import when no-union-enum is found", () => {
			setupFixture({
				"index.ts": `
import { Type } from "typebox";
const Status = Type.Union([Type.Literal("a"), Type.Literal("b")]);
`,
			});
			const results = autoFix(TEST_DIR);
			const stringEnumFix = results.find(
				(r) => r.rule === "no-union-enum" && r.fixed,
			);
			expect(stringEnumFix).toBeDefined();

			const content = readFileSync(join(TEST_DIR, "index.ts"), "utf-8");
			expect(content).toContain("StringEnum");
		});
	});

	describe("Summary statistics", () => {
		it("should count errors and warnings correctly", () => {
			setupFixture({
				"index.ts": `
import { Type } from "typebox";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
export default function(pi: ExtensionAPI) {
  pi.registerTool({
    name: "my-tool",
    block: true,
    description: "test",
    parameters: {
      status: Type.Union([Type.Literal("a"), Type.Literal("b")])
    },
    async execute() {
      return { content: [{ type: "text", text: "Error: failed" }], details: { error: "x" } };
    }
  });
}
`,
			});
			const report = lintDirectory(TEST_DIR);
			expect(report.summary.errors).toBeGreaterThan(0);
			expect(report.summary.warnings).toBeGreaterThan(0);
			expect(report.summary.total).toBe(
				report.summary.errors + report.summary.warnings,
			);
		});

		it("should track rules triggered", () => {
			setupFixture({
				"index.ts": `
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
export default function(pi: ExtensionAPI) {
  pi.registerTool({
    name: "my-tool",
    description: "test",
    parameters: {},
    async execute() { return { content: [] }; }
  });
}
`,
			});
			const report = lintDirectory(TEST_DIR);
			expect(report.summary.rulesTriggered["kebab-tool-name"]).toBeGreaterThan(
				0,
			);
		});
	});
});
