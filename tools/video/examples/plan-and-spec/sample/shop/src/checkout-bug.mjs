// The first try at paying by card, kept so the example can show a scenario failing: it leaves out delivery.
export function payByCard(b, card) {
  return { status: "paid", charged: b.total, order: "A-1040" };
}
