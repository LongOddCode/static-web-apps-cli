import { EventEmitter } from "node:events";
import { deploy } from "./deploy.js";
import { getDeployClientPath, cleanUp } from "../../../core/deploy-client.js";
import { logGitHubIssueMessageAndExit } from "../../../core/utils/logger.js";
import { swaCLIEnv } from "../../../core/env.js";
import { spawn } from "node:child_process";
import fs from "node:fs";
import ora from "ora";

// --- Module mocks (hoisted by vitest, persist across tests) ---
// Note: mockReset:true clears vi.fn() implementations before each test,
// so all required implementations are re-applied in beforeEach.

vi.mock("@azure/identity", () => ({
  DefaultAzureCredential: vi.fn(),
  InteractiveBrowserCredential: vi.fn(),
  DeviceCodeCredential: vi.fn(),
  AzureCliCredential: vi.fn(),
}));

vi.mock("../../../core/utils/logger", () => ({
  logger: { error: vi.fn(), log: vi.fn(), warn: vi.fn(), silly: vi.fn() },
  logGitHubIssueMessageAndExit: vi.fn(),
}));

vi.mock("../../../core/deploy-client", () => ({
  getDeployClientPath: vi.fn(),
  cleanUp: vi.fn(),
}));

vi.mock("../../../core/account", () => ({
  getStaticSiteDeployment: vi.fn(),
  chooseOrCreateProjectDetails: vi.fn(),
}));

vi.mock("../login/login", () => ({
  login: vi.fn(),
}));

vi.mock("../../../core/env", () => ({
  swaCLIEnv: vi.fn(),
}));

vi.mock("ora", () => ({
  default: vi.fn(),
}));

vi.mock("node:fs", () => ({
  default: {
    existsSync: vi.fn(),
    promises: { readdir: vi.fn() },
  },
}));

// Mock child_process — must use vi.mock to intercept named imports
vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return {
    ...actual,
    spawn: vi.fn(),
  };
});

vi.mock("../../../core/utils/user-config", () => ({
  findSWAConfigFile: vi.fn(),
}));

vi.mock("../../../core/utils/workflow-config", () => ({
  readWorkflowFile: vi.fn(),
}));

vi.mock("../../../core/utils/cli-config", () => ({
  getCurrentSwaCliConfigFromFile: vi.fn(),
  updateSwaCliConfigFile: vi.fn(),
}));

vi.mock("../../../core/utils/options", () => ({
  isUserOrConfigOption: vi.fn(),
}));

vi.mock("../../../core/constants", () => ({
  DEFAULT_RUNTIME_LANGUAGE: "node",
}));

vi.mock("../../../core/functions-versions", () => ({
  getDefaultVersion: vi.fn(),
}));

vi.mock("../../../core/utils/json", () => ({
  loadPackageJson: vi.fn(() => ({ version: "0.0.0-test" })),
}));

// --- Test helpers ---

function createMockChildProcess(exitCode: number | null = 0) {
  const child = new EventEmitter() as any;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  process.nextTick(() => {
    child.emit("close", exitCode, exitCode === null ? "SIGTERM" : null);
  });
  return child;
}

const defaultOptions = {
  outputLocation: "./dist",
  dryRun: false,
  env: "production",
} as any;

describe("deploy exit code handling", () => {
  beforeEach(() => {
    // Re-apply implementations cleared by vitest's mockReset: true
    vi.mocked(swaCLIEnv).mockReturnValue({
      SWA_CLI_DEPLOYMENT_TOKEN: "mock-token",
      SWA_CLI_DEBUG: "",
    } as any);
    vi.mocked(getDeployClientPath).mockResolvedValue({
      binary: "mock-binary",
      buildId: "0.0.0",
    });
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.promises.readdir).mockResolvedValue([] as any);
    vi.mocked(ora).mockReturnValue({
      start: vi.fn(),
      stop: vi.fn(),
      succeed: vi.fn(),
      fail: vi.fn(),
      info: vi.fn(),
      text: "",
    } as any);
  });

  it("should reject when the deploy client exits with a non-zero exit code", async () => {
    vi.mocked(spawn).mockReturnValue(createMockChildProcess(1) as any);

    await expect(deploy({ ...defaultOptions })).rejects.toThrow("Deploy client exited with code 1");
  });

  it("should resolve successfully when the deploy client exits with code 0", async () => {
    vi.mocked(spawn).mockReturnValue(createMockChildProcess(0) as any);

    await expect(deploy({ ...defaultOptions })).resolves.toBeUndefined();
  });

  it("should reject when the deploy client is killed by a signal", async () => {
    vi.mocked(spawn).mockReturnValue(createMockChildProcess(null) as any);

    await expect(deploy({ ...defaultOptions })).rejects.toThrow("Deploy client was killed by signal SIGTERM");
  });

  it("should reject when the deploy client emits an error event", async () => {
    const child = new EventEmitter() as any;
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    process.nextTick(() => child.emit("error", new Error("spawn ENOENT")));

    vi.mocked(spawn).mockReturnValue(child as any);

    await expect(deploy({ ...defaultOptions })).rejects.toThrow("spawn ENOENT");
  });

  it("should call cleanUp after failed deployment", async () => {
    vi.mocked(spawn).mockReturnValue(createMockChildProcess(1) as any);

    try {
      await deploy({ ...defaultOptions });
    } catch {
      // expected
    }

    expect(cleanUp).toHaveBeenCalled();
  });

  it("should trigger logGitHubIssueMessageAndExit on non-zero exit", async () => {
    vi.mocked(spawn).mockReturnValue(createMockChildProcess(1) as any);

    try {
      await deploy({ ...defaultOptions });
    } catch {
      // expected
    }

    expect(logGitHubIssueMessageAndExit).toHaveBeenCalled();
  });
});
