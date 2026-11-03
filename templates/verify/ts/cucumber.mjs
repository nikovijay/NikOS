// Created by `nikos verify setup`. Runs the stories in intent/ as tests.
export default {
  paths: ["intent/features/**/*.feature"],
  import: ["test/steps/**/*.steps.ts"],
  format: ["progress"],
};
