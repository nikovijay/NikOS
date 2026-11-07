import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Agent worktrees and leftover video renders hold copies of the tests and binary files.
    exclude: [...configDefaults.exclude, ".claude/**", "tools/video/examples/*/node_modules/**"],
    // Tests don't ask the nikos on this machine's PATH for its version.
    env: { NIKOS_NO_VERSION_CHECK: "1" },
  },
});
