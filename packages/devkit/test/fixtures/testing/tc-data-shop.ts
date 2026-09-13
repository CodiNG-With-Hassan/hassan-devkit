import { tc, type Area, type KnownIssue, type Readme } from '@coding-with-hassan/devkit/test-cases';
import { TAB, type Flag } from './helpers';

const enabled: Flag = 'yes';

export const SHOP_AREAS: Area[] = [
  {
    key: 'CART',
    name: { en: 'Cart', nl: 'Winkelwagen' },
    tab: TAB,
    cases: [
      tc('CART-01', 'H', 'Add to cart', 'Toevoegen aan winkelwagen', 'A product exists.', 'Er bestaat een product.', '1. Open a product.\n2. Click Add.', '1. Open een product.\n2. Klik op Toevoegen.', `The cart badge shows 1 (${enabled}).`, 'De badge toont 1.'),
      tc('CART-02', 'M', 'Remove from cart', 'Verwijderen uit winkelwagen', 'Cart has one item.', 'Winkelwagen bevat één artikel.', '1. Open the cart.\n2. Remove the item.', '1. Open de winkelwagen.\n2. Verwijder het artikel.', 'The cart is empty.', 'De winkelwagen is leeg.'),
    ],
  },
];

export const SHOP_KNOWN_ISSUES: KnownIssue[] = [{ id: 'KI-1', desc: { en: 'Slow badge', nl: 'Trage badge' }, impact: { en: 'Wait a second', nl: 'Wacht even' } }];

export const SHOP_README: Readme = {
  en: [['How to test', ['Set the Status per case.']]],
  nl: [['Hoe te testen', ['Zet per test de Status.']]],
};
