// Created by `nikos verify setup`. Runs the stories in intent/, maps/ and the team's assigned copies as tests.
export default {
  paths: ["intent/features/**/*.feature", "maps/*/features/**/*.feature", ".nikos/assigned/**/features/**/*.feature"],
  import: ["test/steps/**/*.steps.ts"],
  format: ["progress"],
};
