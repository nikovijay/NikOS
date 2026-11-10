// Created by `nikos verify setup`. Runs the stories in each map's features folder as tests.
export default {
  paths: ["maps/*/features/**/*.feature"],
  import: ["test/steps/**/*.steps.mjs"],
  format: ["progress"],
};
