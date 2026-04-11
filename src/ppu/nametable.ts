// @ts-nocheck
class NameTable {
  constructor(width, height, name) {
    this.width = width;
    this.height = height;
    this.name = name;

    this.tile = new Uint8Array(width * height);
    this.attrib = new Uint8Array(width * height);
  }

  getTileIndex(x, y) {
    return this.tile[y * this.width + x];
  }

  getAttrib(x, y) {
    return this.attrib[y * this.width + x];
  }

  writeAttrib(index, value) {
    let basex = (index % 8) * 4;
    let basey = Math.floor(index / 8) * 4;
    let add;
    let tx, ty;
    let attindex;

    for (let sqy = 0; sqy < 2; sqy++) {
      for (let sqx = 0; sqx < 2; sqx++) {
        add = (value >> (2 * (sqy * 2 + sqx))) & 3;
        for (let y = 0; y < 2; y++) {
          for (let x = 0; x < 2; x++) {
            tx = basex + sqx * 2 + x;
            ty = basey + sqy * 2 + y;
            attindex = ty * this.width + tx;
            this.attrib[attindex] = (add << 2) & 12;
          }
        }
      }
    }
  }

  toJSON() {
    return {
      tile: Array.from(this.tile),
      attrib: Array.from(this.attrib),
    };
  }

  fromJSON(s) {
    this.tile.set(s.tile);
    this.attrib.set(s.attrib);
  }
}

export default NameTable;
