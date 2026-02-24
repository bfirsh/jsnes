class Tile {
  constructor() {
    // Tile data: color indices 0–3
    this.pix = new Uint8Array(64);

    this.initialized = false;
    this.opaque = new Uint8Array(8);
  }

  setBuffer(scanline) {
    for (let y = 0; y < 8; y++) {
      this.setScanline(y, scanline[y], scanline[y + 8]);
    }
  }

  setScanline(sline, b1, b2) {
    this.initialized = true;
    let tIndex = sline << 3;
    for (let x = 0; x < 8; x++) {
      this.pix[tIndex + x] =
        ((b1 >> (7 - x)) & 1) + (((b2 >> (7 - x)) & 1) << 1);
      if (this.pix[tIndex + x] === 0) {
        this.opaque[sline] = false;
      }
    }
  }

  render(
    buffer,
    srcx1,
    srcy1,
    srcx2,
    srcy2,
    dx,
    dy,
    palAdd,
    palette,
    flipHorizontal,
    flipVertical,
    pri,
    priTable,
  ) {
    if (dx < -7 || dx >= 256 || dy < -7 || dy >= 240) {
      return;
    }

    if (dx < 0) {
      srcx1 -= dx;
    }
    if (dx + srcx2 >= 256) {
      srcx2 = 256 - dx;
    }

    if (dy < 0) {
      srcy1 -= dy;
    }
    if (dy + srcy2 >= 240) {
      srcy2 = 240 - dy;
    }

    let palIndex, tpri;
    let pix = this.pix;

    // Pre-compute row/col ranges to eliminate per-pixel bounds checks.
    // The outer loop iterates only over visible rows (srcy1..srcy2-1),
    // the inner loop only over visible columns (srcx1..srcx2-1).
    let fbBase = ((dy + srcy1) << 8) + dx + srcx1;
    let xSpan = srcx2 - srcx1;

    if (!flipHorizontal && !flipVertical) {
      let tBase = (srcy1 << 3) + srcx1;
      for (let y = srcy1; y < srcy2; y++) {
        let fbIndex = fbBase;
        let tIndex = tBase;
        for (let x = 0; x < xSpan; x++) {
          palIndex = pix[tIndex];
          tpri = priTable[fbIndex];
          if (palIndex !== 0 && pri <= (tpri & 0xff)) {
            buffer[fbIndex] = palette[palIndex + palAdd];
            priTable[fbIndex] = (tpri & 0xf00) | pri;
          }
          fbIndex++;
          tIndex++;
        }
        fbBase += 256;
        tBase += 8;
      }
    } else if (flipHorizontal && !flipVertical) {
      let tBase = (srcy1 << 3) + (7 - srcx1);
      for (let y = srcy1; y < srcy2; y++) {
        let fbIndex = fbBase;
        let tIndex = tBase;
        for (let x = 0; x < xSpan; x++) {
          palIndex = pix[tIndex];
          tpri = priTable[fbIndex];
          if (palIndex !== 0 && pri <= (tpri & 0xff)) {
            buffer[fbIndex] = palette[palIndex + palAdd];
            priTable[fbIndex] = (tpri & 0xf00) | pri;
          }
          fbIndex++;
          tIndex--;
        }
        fbBase += 256;
        tBase += 8;
      }
    } else if (flipVertical && !flipHorizontal) {
      let tBase = ((7 - srcy1) << 3) + srcx1;
      for (let y = srcy1; y < srcy2; y++) {
        let fbIndex = fbBase;
        let tIndex = tBase;
        for (let x = 0; x < xSpan; x++) {
          palIndex = pix[tIndex];
          tpri = priTable[fbIndex];
          if (palIndex !== 0 && pri <= (tpri & 0xff)) {
            buffer[fbIndex] = palette[palIndex + palAdd];
            priTable[fbIndex] = (tpri & 0xf00) | pri;
          }
          fbIndex++;
          tIndex++;
        }
        fbBase += 256;
        tBase -= 8;
      }
    } else {
      let tBase = ((7 - srcy1) << 3) + (7 - srcx1);
      for (let y = srcy1; y < srcy2; y++) {
        let fbIndex = fbBase;
        let tIndex = tBase;
        for (let x = 0; x < xSpan; x++) {
          palIndex = pix[tIndex];
          tpri = priTable[fbIndex];
          if (palIndex !== 0 && pri <= (tpri & 0xff)) {
            buffer[fbIndex] = palette[palIndex + palAdd];
            priTable[fbIndex] = (tpri & 0xf00) | pri;
          }
          fbIndex++;
          tIndex--;
        }
        fbBase += 256;
        tBase -= 8;
      }
    }
  }

  isTransparent(x, y) {
    return this.pix[(y << 3) + x] === 0;
  }

  toJSON() {
    return {
      opaque: Array.from(this.opaque),
      pix: Array.from(this.pix),
    };
  }

  fromJSON(s) {
    this.opaque.set(s.opaque);
    this.pix.set(s.pix);
  }
}

export default Tile;
