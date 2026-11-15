// The example shop's one-page checkout: just enough real code for the story map's scenarios to run.
export const DELIVERY = 4;

export function basket(lines) {
  const total = lines.reduce((sum, l) => sum + l.price * l.quantity, 0);
  return { lines, total };
}

export function changeQuantity(b, name, quantity) {
  return basket(b.lines.map((l) => (l.name === name ? { ...l, quantity } : l)));
}

const ADDRESSES = { "N1 9GU": ["1 Pentonville Road, London", "3 Pentonville Road, London"] };
export const lookUp = (postcode) => ADDRESSES[postcode] ?? [];

export const slots = () => ["Tomorrow 8–10am", "Tomorrow 6–8pm"];

let next = 1041;
export function payByCard(b, card) {
  const charged = b.total + DELIVERY;
  return { status: "paid", charged, order: `A-${next++}` };
}
