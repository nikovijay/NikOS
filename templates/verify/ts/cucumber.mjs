// Created by `nikos verify setup`. Runs the stories in intent/ and maps/ as tests.
export default {
  paths: ["intent/features/**/*.feature", "maps/*/features/**/*.feature"],
  import: ["test/steps/**/*.steps.ts"],
  format: ["progress"],
};
