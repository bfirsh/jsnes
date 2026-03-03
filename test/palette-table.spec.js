import assert from "node:assert/strict";
import { describe, it } from "node:test";
import PaletteTable from "../src/ppu/palette-table.js";

describe("PaletteTable emphasis bits", () => {
  it("maps emphasis bits to the correct color channels", () => {
    const palette = new PaletteTable();
    const base = palette.getRgb(200, 100, 50);

    palette.curTable.fill(0);
    palette.curTable[0] = base;
    palette.makeTables();

    palette.setEmphasis(1); // emphasize red => darken green + blue
    assert.equal(palette.getEntry(0), palette.getRgb(200, 75, 37));

    palette.setEmphasis(2); // emphasize green => darken red + blue
    assert.equal(palette.getEntry(0), palette.getRgb(150, 100, 37));

    palette.setEmphasis(4); // emphasize blue => darken red + green
    assert.equal(palette.getEntry(0), palette.getRgb(150, 75, 50));
  });
});
