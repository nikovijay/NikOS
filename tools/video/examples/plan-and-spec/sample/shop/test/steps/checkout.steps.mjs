// Step definitions for the checkout map's stories. Each one checks the real code in src/.
import assert from "node:assert/strict";
import { Given, When, Then } from "@cucumber/cucumber";
import { basket, changeQuantity, lookUp, slots } from "../../src/checkout.mjs";
import { payByCard } from "../../src/pay.mjs";

Given("a basket with {int} mugs at £{int} and {int} plate at £{int}", function (m, mp, p, pp) {
  this.basket = basket([{ name: "mug", price: mp, quantity: m }, { name: "plate", price: pp, quantity: p }]);
});
When("I open the checkout", function () {
  this.page = this.basket;
});
Then("I see {int} lines and a total of £{int}", function (n, total) {
  assert.equal(this.page.lines.length, n);
  assert.equal(this.page.total, total);
});
When("I change the mugs to {int}", function (q) {
  this.basket = changeQuantity(this.basket, "mug", q);
});
Then("the total is £{int} without leaving the page", function (total) {
  assert.equal(this.basket.total, total);
});
When("I enter the postcode {string}", function (pc) {
  this.found = lookUp(pc);
});
Then("I can pick from {int} addresses", function (n) {
  assert.equal(this.found.length, n);
});
When("I choose delivery", function () {
  this.slots = slots();
});
Then("I see {int} slots to pick from", function (n) {
  assert.equal(this.slots.length, n);
});
When("I pay by card", function () {
  this.paid = payByCard(this.basket, { number: "4242 4242 4242 4242" });
});
Then("I am charged £{int}, with delivery", function (amount) {
  assert.equal(this.paid.charged, amount);
});
Then("I see an order number", function () {
  assert.match(this.paid.order, /^A-\d+$/);
});
