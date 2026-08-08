/**
 * Unit master and HSN codes — the two global lookups everything else measures
 * and taxes itself by.
 *
 * Captured from the database this was first built in. The seeder beside this
 * file is additive and keyed on CODE: it creates what is missing and never
 * writes over a row that is already there.
 *
 * A unit may derive from another (`baseUnitCode` + `conversionFactor`), so
 * base units are seeded before the units that convert to them.
 */

export interface SeedUnit {
  code: string;
  name: string;
  symbol: string | null;
  type: string;
  baseUnitCode: string | null;
  conversionFactor: number | null;
  decimalPlaces: number;
  isActive: boolean;
}

/** GST is statutory and identical in every company, so the rates ship here. */
export interface SeedHsn {
  code: string;
  description: string;
  cgst: number;
  sgst: number;
  igst: number;
  cess: number;
  isActive: boolean;
}

export const UNITS: SeedUnit[] = [
  { code: "BATCH", name: "Batch", symbol: "Batch", type: "SIMPLE", baseUnitCode: null, conversionFactor: null, decimalPlaces: 0, isActive: true },
  { code: "BOX", name: "Box", symbol: "Box", type: "SIMPLE", baseUnitCode: null, conversionFactor: null, decimalPlaces: 0, isActive: true },
  { code: "CAKE", name: "Cake", symbol: "Cake", type: "SIMPLE", baseUnitCode: null, conversionFactor: null, decimalPlaces: 0, isActive: true },
  { code: "CUT", name: "Cuts", symbol: "Cut", type: "SIMPLE", baseUnitCode: null, conversionFactor: null, decimalPlaces: 0, isActive: true },
  { code: "DOZ", name: "Dozen", symbol: "Dz", type: "COMPOUND", baseUnitCode: "NOS", conversionFactor: 12, decimalPlaces: 0, isActive: true },
  { code: "GM", name: "Gram", symbol: "gm", type: "SIMPLE", baseUnitCode: null, conversionFactor: null, decimalPlaces: 3, isActive: true },
  { code: "HOLE", name: "Hole", symbol: "Hole", type: "SIMPLE", baseUnitCode: null, conversionFactor: null, decimalPlaces: 0, isActive: true },
  { code: "HR", name: "Hour", symbol: "hr", type: "COMPOUND", baseUnitCode: "MIN", conversionFactor: 60, decimalPlaces: 2, isActive: true },
  { code: "KG", name: "Kilogram", symbol: "Kg", type: "COMPOUND", baseUnitCode: "GM", conversionFactor: 1000, decimalPlaces: 3, isActive: true },
  { code: "LOF", name: "Loaf", symbol: "Lof", type: "SIMPLE", baseUnitCode: null, conversionFactor: null, decimalPlaces: 0, isActive: true },
  { code: "LTR", name: "Litre", symbol: "L", type: "COMPOUND", baseUnitCode: "ML", conversionFactor: 1000, decimalPlaces: 3, isActive: true },
  { code: "MIN", name: "Minute", symbol: "min", type: "SIMPLE", baseUnitCode: null, conversionFactor: null, decimalPlaces: 0, isActive: true },
  { code: "ML", name: "Millilitre", symbol: "ml", type: "SIMPLE", baseUnitCode: null, conversionFactor: null, decimalPlaces: 2, isActive: true },
  { code: "MTR", name: "Metre", symbol: "M", type: "SIMPLE", baseUnitCode: null, conversionFactor: null, decimalPlaces: 2, isActive: true },
  { code: "NOS", name: "Numbers", symbol: "Nos", type: "SIMPLE", baseUnitCode: null, conversionFactor: null, decimalPlaces: 0, isActive: true },
  { code: "PCS", name: "Pieces", symbol: "Pcs", type: "SIMPLE", baseUnitCode: null, conversionFactor: null, decimalPlaces: 0, isActive: true },
  { code: "PKT", name: "Packet", symbol: "Pkt", type: "SIMPLE", baseUnitCode: null, conversionFactor: null, decimalPlaces: 0, isActive: true },
  { code: "TON", name: "Tonne", symbol: "t", type: "COMPOUND", baseUnitCode: "GM", conversionFactor: 1000000, decimalPlaces: 3, isActive: true },
];

export const HSN_CODES: SeedHsn[] = [
  { code: "0401", description: "Fresh & UHT milk", cgst: 0, sgst: 0, igst: 0, cess: 0, isActive: true },
  { code: "0402", description: "Milk powder & condensed milk", cgst: 2.5, sgst: 2.5, igst: 5, cess: 0, isActive: true },
  { code: "0405", description: "Butter & ghee (dairy fats)", cgst: 2.5, sgst: 2.5, igst: 5, cess: 0, isActive: true },
  { code: "0406", description: "Cheese & paneer", cgst: 2.5, sgst: 2.5, igst: 5, cess: 0, isActive: true },
  { code: "0407", description: "Eggs (in shell)", cgst: 0, sgst: 0, igst: 0, cess: 0, isActive: true },
  { code: "0409", description: "Natural honey", cgst: 2.5, sgst: 2.5, igst: 5, cess: 0, isActive: true },
  { code: "0801", description: "Cashew nuts", cgst: 2.5, sgst: 2.5, igst: 5, cess: 0, isActive: true },
  { code: "0802", description: "Almonds, walnuts, pistachios & other nuts", cgst: 2.5, sgst: 2.5, igst: 5, cess: 0, isActive: true },
  { code: "0806", description: "Raisins (dried grapes)", cgst: 2.5, sgst: 2.5, igst: 5, cess: 0, isActive: true },
  { code: "0813", description: "Mixed dried fruits", cgst: 2.5, sgst: 2.5, igst: 5, cess: 0, isActive: true },
  { code: "0905", description: "Vanilla", cgst: 2.5, sgst: 2.5, igst: 5, cess: 0, isActive: true },
  { code: "0908", description: "Cardamom, nutmeg & similar spices", cgst: 2.5, sgst: 2.5, igst: 5, cess: 0, isActive: true },
  { code: "1101", description: "Wheat flour, Maida & Atta", cgst: 0, sgst: 0, igst: 0, cess: 0, isActive: true },
  { code: "1108", description: "Starches (corn / maize starch)", cgst: 2.5, sgst: 2.5, igst: 5, cess: 0, isActive: true },
  { code: "1512", description: "Edible vegetable oil (sunflower / refined)", cgst: 2.5, sgst: 2.5, igst: 5, cess: 0, isActive: true },
  { code: "1517", description: "Margarine, bakery shortening & edible fat mixtures", cgst: 2.5, sgst: 2.5, igst: 5, cess: 0, isActive: true },
  { code: "1701", description: "Sugar (refined / granulated)", cgst: 2.5, sgst: 2.5, igst: 5, cess: 0, isActive: true },
  { code: "1702", description: "Glucose, invert sugar & sugar syrups", cgst: 2.5, sgst: 2.5, igst: 5, cess: 0, isActive: true },
  { code: "1704", description: "Sugar confectionery (candy, toffee) without cocoa", cgst: 9, sgst: 9, igst: 18, cess: 0, isActive: true },
  { code: "1805", description: "Cocoa powder", cgst: 2.5, sgst: 2.5, igst: 5, cess: 0, isActive: true },
  { code: "1806", description: "Chocolate & other cocoa preparations", cgst: 2.5, sgst: 2.5, igst: 5, cess: 0, isActive: true },
  { code: "1901", description: "Malt extract & flour-based food preparations", cgst: 2.5, sgst: 2.5, igst: 5, cess: 0, isActive: true },
  { code: "1905", description: "Bread (branded & unbranded)", cgst: 0, sgst: 0, igst: 0, cess: 0, isActive: true },
  { code: "190520", description: "Rusk, toasted bread & similar toasted products", cgst: 2.5, sgst: 2.5, igst: 5, cess: 0, isActive: true },
  { code: "190590", description: "Pastry, cakes, biscuits & other bakers’ wares", cgst: 9, sgst: 9, igst: 18, cess: 0, isActive: true },
  { code: "2007", description: "Jam, fruit jelly & marmalade", cgst: 2.5, sgst: 2.5, igst: 5, cess: 0, isActive: true },
  { code: "2102", description: "Yeast & prepared baking powders", cgst: 2.5, sgst: 2.5, igst: 5, cess: 0, isActive: true },
  { code: "2105", description: "Ice cream & other edible ice", cgst: 2.5, sgst: 2.5, igst: 5, cess: 0, isActive: true },
  { code: "2106", description: "Food preparations n.e.s. (baking premixes, custard powder, improvers)", cgst: 6, sgst: 6, igst: 12, cess: 0, isActive: true },
  { code: "2501", description: "Salt", cgst: 0, sgst: 0, igst: 0, cess: 0, isActive: true },
];
