import Mappers from "./mappers/index.js";
import Tile from "./tile.js";

class ROM {
  // Mirroring types (instance properties so they're accessible via
  // this.nes.rom.HORIZONTAL_MIRRORING etc. in PPU and mappers):
  VERTICAL_MIRRORING = 0;
  HORIZONTAL_MIRRORING = 1;
  FOURSCREEN_MIRRORING = 2;
  SINGLESCREEN_MIRRORING = 3;
  SINGLESCREEN_MIRRORING2 = 4;
  SINGLESCREEN_MIRRORING3 = 5;
  SINGLESCREEN_MIRRORING4 = 6;
  CHRROM_MIRRORING = 7;

  constructor(nes) {
    this.nes = nes;
    this.valid = false;
  }

  load(data) {
    let i, j, v;

    // Accept Uint8Array, ArrayBuffer, Buffer, or binary string.
    if (data instanceof ArrayBuffer) {
      data = new Uint8Array(data);
    }
    const isTypedArray = ArrayBuffer.isView(data);

    if (isTypedArray) {
      if (
        data.length < 4 ||
        data[0] !== 0x4e ||
        data[1] !== 0x45 ||
        data[2] !== 0x53 ||
        data[3] !== 0x1a
      ) {
        throw new Error("Not a valid NES ROM.");
      }
    } else {
      if (!data.startsWith("NES\x1a")) {
        throw new Error("Not a valid NES ROM.");
      }
    }

    this.header = new Uint8Array(16);
    for (i = 0; i < 16; i++) {
      this.header[i] = isTypedArray ? data[i] : data.charCodeAt(i) & 0xff;
    }
    this.romCount = this.header[4];
    this.vromCount = this.header[5] * 2; // Get the number of 4kB banks, not 8kB
    this.mirroring = (this.header[6] & 1) !== 0 ? 1 : 0;
    this.batteryRam = (this.header[6] & 2) !== 0;
    this.trainer = (this.header[6] & 4) !== 0;
    this.fourScreen = (this.header[6] & 8) !== 0;
    this.mapperType = (this.header[6] >> 4) | (this.header[7] & 0xf0);
    /* TODO
        if (this.batteryRam)
            this.loadBatteryRam();*/
    // Check whether byte 8-15 are zero's:
    let foundError = false;
    for (i = 8; i < 16; i++) {
      if (this.header[i] !== 0) {
        foundError = true;
        break;
      }
    }
    if (foundError) {
      this.mapperType &= 0xf; // Ignore byte 7
    }
    // Load PRG-ROM banks:
    this.rom = new Array(this.romCount);
    // Skip past the 16-byte header, plus 512-byte trainer if present.
    // See https://www.nesdev.org/wiki/INES#Trainer
    let offset = 16 + (this.trainer ? 512 : 0);
    for (i = 0; i < this.romCount; i++) {
      this.rom[i] = new Uint8Array(16384);
      for (j = 0; j < 16384; j++) {
        if (offset + j >= data.length) {
          break;
        }
        this.rom[i][j] = isTypedArray
          ? data[offset + j]
          : data.charCodeAt(offset + j) & 0xff;
      }
      offset += 16384;
    }
    // Load CHR-ROM banks:
    this.vrom = new Array(this.vromCount);
    for (i = 0; i < this.vromCount; i++) {
      this.vrom[i] = new Uint8Array(4096);
      for (j = 0; j < 4096; j++) {
        if (offset + j >= data.length) {
          break;
        }
        this.vrom[i][j] = isTypedArray
          ? data[offset + j]
          : data.charCodeAt(offset + j) & 0xff;
      }
      offset += 4096;
    }

    // Create VROM tiles:
    this.vromTile = new Array(this.vromCount);
    for (i = 0; i < this.vromCount; i++) {
      this.vromTile[i] = new Array(256);
      for (j = 0; j < 256; j++) {
        this.vromTile[i][j] = new Tile();
      }
    }

    // Convert CHR-ROM banks to tiles:
    let tileIndex;
    let leftOver;
    for (v = 0; v < this.vromCount; v++) {
      for (i = 0; i < 4096; i++) {
        tileIndex = i >> 4;
        leftOver = i % 16;
        if (leftOver < 8) {
          this.vromTile[v][tileIndex].setScanline(
            leftOver,
            this.vrom[v][i],
            this.vrom[v][i + 8],
          );
        } else {
          this.vromTile[v][tileIndex].setScanline(
            leftOver - 8,
            this.vrom[v][i - 8],
            this.vrom[v][i],
          );
        }
      }
    }

    this.valid = true;
  }

  getMirroringType() {
    if (this.fourScreen) {
      return this.FOURSCREEN_MIRRORING;
    }
    if (this.mirroring === 0) {
      return this.HORIZONTAL_MIRRORING;
    }
    return this.VERTICAL_MIRRORING;
  }

  mapperSupported() {
    return typeof Mappers[this.mapperType] !== "undefined";
  }

  createMapper() {
    if (this.mapperSupported()) {
      return new Mappers[this.mapperType](this.nes);
    } else {
      throw new Error(`Unsupported mapper: ${this.mapperType}`);
    }
  }
}

export default ROM;
