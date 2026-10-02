import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import extension from "../index.ts";
import {
  createFooterHarness,
  createGitRepo,
  createTestEnvironment,
  settleAsync,
  toTags,
} from "./harness.ts";

function setEnv(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

describe("footer status behavior", () => {
  it("parses all visibility flag spellings, empty values, and invalid-value defaults", async () => {
    const environment = await createTestEnvironment();
    try {
      const repo = join(environment.root, "visibility-git-repo");
      await createGitRepo(repo, "footer-test");
      process.chdir(repo);

      const cases = [
        { name: "PI_MINIMAL_FOOTER_SHOW_CWD", values: [[undefined, true], ["1", true], ["true", true], ["yes", true], ["ON", true], ["0", false], ["false", false], ["no", false], ["off", false], ["", true], ["invalid", true]] },
        { name: "PI_MINIMAL_FOOTER_SHOW_BRANCH", values: [[undefined, true], ["1", true], ["TRUE", true], ["yes", true], ["on", true], ["0", false], ["false", false], ["NO", false], ["off", false], ["", true], ["invalid", true]] },
        { name: "PI_MINIMAL_FOOTER_SHOW_PROVIDER", values: [[undefined, false], ["1", true], ["true", true], ["YES", true], ["on", true], ["0", false], ["false", false], ["no", false], ["OFF", false], ["", false], ["invalid", false]] },
      ] as const;

      for (const flag of cases) {
        for (const [value, expected] of flag.values) {
          setEnv(flag.name, value);
          const footer = createFooterHarness(extension, {
            provider: "unsupported-test-provider",
            modelId: "org/reasoner",
            cwd: join(environment.home, "work"),
          });
          await footer.start();
          const output = footer.render(200).map(toTags).join("\n");
          if (flag.name === "PI_MINIMAL_FOOTER_SHOW_CWD") {
            expect(output.includes("<accent>~/work</accent>")).toBe(expected);
          } else if (flag.name === "PI_MINIMAL_FOOTER_SHOW_BRANCH") {
            expect(output.includes("<warning>footer-test</warning><warning> *</warning>")).toBe(expected);
          } else {
            expect(output.includes("<muted>unsupported-test-provider/org/reasoner</muted>")).toBe(expected);
          }
          footer.dispose();
        }
      }
    } finally {
      await environment.cleanup();
    }
  });

  it("ignores aborted assistant usage and shows reasoning only when the thinking level is not off", async () => {
    const environment = await createTestEnvironment();
    try {
      const high = createFooterHarness(extension, {
        provider: "unsupported-test-provider",
        modelId: "org/reasoner",
        reasoning: true,
        thinkingLevel: "high",
      });
      await high.start();
      const highOutput = high.render(200).map(toTags).join("\n");
      expect(highOutput).toContain("<muted>reasoner</muted> <dim>></dim> <accent>high</accent>");
      expect(highOutput).toContain("<dim>41% 1.2M/3M</dim>");
      expect(highOutput).not.toContain("18M");
      high.dispose();

      const off = createFooterHarness(extension, {
        provider: "unsupported-test-provider",
        modelId: "org/reasoner",
        reasoning: true,
        thinkingLevel: "off",
      });
      await off.start();
      const offOutput = off.render(200).map(toTags).join("\n");
      expect(offOutput).toContain("<muted>reasoner</muted>");
      expect(offOutput).not.toContain("<accent>off</accent>");
      expect(offOutput).not.toContain("<accent>high</accent>");
      off.dispose();
    } finally {
      await environment.cleanup();
    }
  });

  it("uses context-gauge color thresholds and formats token counts", async () => {
    const environment = await createTestEnvironment();
    try {
      const thresholds = [
        { used: 49, color: "success" },
        { used: 50, color: "accent" },
        { used: 69, color: "accent" },
        { used: 70, color: "warning" },
        { used: 89, color: "warning" },
        { used: 90, color: "error" },
      ];
      for (const { used, color } of thresholds) {
        const footer = createFooterHarness(extension, {
          model: { id: "test-model", contextWindow: 100, reasoning: false },
          contextWindow: 100,
          contextUsage: used,
        });
        await footer.start();
        const output = toTags(footer.render(200)[0] ?? "");
        const gauge = output.slice(output.indexOf("<dim>ctx </dim>"));
        expect(gauge).toContain(`<dim>ctx </dim><${color}>`);
        expect(gauge).toContain(`<dim>${used}% ${used}/100</dim>`);
        footer.dispose();
      }

      const formatted = createFooterHarness(extension, {
        model: { id: "test-model", contextWindow: 65_432, reasoning: false },
        contextWindow: 65_432,
        contextUsage: 12_345,
      });
      await formatted.start();
      expect(toTags(formatted.render(200)[0] ?? "")).toContain("<dim>19% 12k/65k</dim>");
      formatted.dispose();
    } finally {
      await environment.cleanup();
    }
  });

  it("renders no usage for unsupported providers or when the model is absent", async () => {
    const environment = await createTestEnvironment();
    try {
      const unsupported = createFooterHarness(extension, { provider: "unsupported-test-provider" });
      await unsupported.start();
      expect(unsupported.render(200).map(toTags).some((line) => line.includes("<accent>Unknown</accent>"))).toBe(false);
      expect(unsupported.render(200).map(toTags)).toHaveLength(1);
      unsupported.dispose();

      const noModel = createFooterHarness(extension, { model: null });
      await noModel.start();
      expect(noModel.render(200).map(toTags)).toEqual([
        "<accent>~/work</accent> <dim>></dim> <muted>no-model</muted> <dim>></dim> <dim>ctx </dim><success></success><dim>────────────</dim> <dim>0%</dim>",
      ]);
      noModel.dispose();
    } finally {
      await environment.cleanup();
    }
  });

  it("refreshes git state on branch changes and marks the dirty branch", async () => {
    const environment = await createTestEnvironment();
    try {
      const repo = join(environment.root, "branch-git-repo");
      await createGitRepo(repo, "footer-test");
      process.chdir(repo);
      const footer = createFooterHarness(extension, {
        provider: "unsupported-test-provider",
        cwd: join(environment.home, "work"),
      });
      await footer.start();
      const initial = footer.render(200).map(toTags).join("\n");
      expect(initial).toContain("<warning>footer-test</warning><warning> *</warning>");
      expect(footer.tui.requestRender).toHaveBeenCalledTimes(1);
      expect(footer.onBranchChange).toHaveBeenCalledTimes(1);

      execFileSync("git", ["switch", "--quiet", "--create", "branch-change-test"], { cwd: repo });
      footer.triggerBranchChange();
      expect(footer.tui.requestRender).toHaveBeenCalledTimes(2);
      expect(footer.render(200).map(toTags).join("\n")).toContain("<warning>branch-change-test</warning><warning> *</warning>");
      footer.dispose();
      expect(footer.unsubscribe).toHaveBeenCalledTimes(1);
    } finally {
      await environment.cleanup();
    }
  });
});
