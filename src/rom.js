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

    // Flags from byte 6 (shared between iNES 1.0 and NES 2.0)
    this.mirroring = (this.header[6] & 1) !== 0 ? 1 : 0;
    this.batteryRam = (this.header[6] & 2) !== 0;
    this.trainer = (this.header[6] & 4) !== 0;
    this.fourScreen = (this.header[6] & 8) !== 0;

    // Detect NES 2.0: byte 7 bits 3..2 == 0b10
    // https://www.nesdev.org/wiki/NES_2.0
    this.isNES2 = (this.header[7] & 0x0c) === 0x08;

    if (this.isNES2) {
      this._loadNES2Header();
    } else {
      this._loadINES1Header();
    }

    /* TODO
        if (this.batteryRam)
            this.loadBatteryRam();*/

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

  // Parse iNES 1.0 header fields (bytes 4-15).
  _loadINES1Header() {
    this.romCount = this.header[4];
    this.vromCount = this.header[5] * 2; // Get the number of 4kB banks, not 8kB
    this.mapperType = (this.header[6] >> 4) | (this.header[7] & 0xf0);

    // Check whether bytes 8-15 are zero. Non-zero values in this region
    // typically indicate garbage (e.g. "DiskDude!" in old ROM dumps), so
    // we discard the upper mapper nibble from byte 7 to be safe.
    let foundError = false;
    for (let i = 8; i < 16; i++) {
      if (this.header[i] !== 0) {
        foundError = true;
        break;
      }
    }
    if (foundError) {
      this.mapperType &= 0xf; // Ignore byte 7
    }

    // Default NES 2.0 fields to zero for iNES 1.0 ROMs so consumers
    // don't need to check isNES2 before accessing them.
    this.subMapper = 0;
    this.prgRamSize = 0;
    this.prgNvRamSize = 0;
    this.chrRamSize = 0;
    this.chrNvRamSize = 0;
    this.timingMode = 0;
    this.consoleType = 0;
  }

  // Parse NES 2.0 header fields (bytes 4-15).
  // https://www.nesdev.org/wiki/NES_2.0
  _loadNES2Header() {
    // Mapper number: 12 bits from bytes 6, 7, and 8.
    //   Byte 6 D7..D4: mapper D3..D0
    //   Byte 7 D7..D4: mapper D7..D4
    //   Byte 8 D3..D0: mapper D11..D8
    this.mapperType =
      (this.header[6] >> 4) |
      (this.header[7] & 0xf0) |
      ((this.header[8] & 0x0f) << 8);

    // Submapper: byte 8 D7..D4
    this.subMapper = (this.header[8] >> 4) & 0x0f;

    // PRG-ROM size: byte 9 D3..D0 (MSB) combined with byte 4 (LSB).
    // When MSB nibble is 0xF, an exponent-multiplier encoding is used:
    //   size = 2^E * (M*2 + 1) bytes, where E = bits 7..2, M = bits 1..0.
    const prgMsb = this.header[9] & 0x0f;
    if (prgMsb === 0x0f) {
      const e = (this.header[4] >> 2) & 0x3f;
      const m = this.header[4] & 0x03;
      this.romCount = Math.ceil((Math.pow(2, e) * (m * 2 + 1)) / 16384);
    } else {
      this.romCount = (prgMsb << 8) | this.header[4];
    }

    // CHR-ROM size: byte 9 D7..D4 (MSB) combined with byte 5 (LSB).
    // Same exponent-multiplier encoding when MSB nibble is 0xF.
    // Internally we store as 4KB bank count (vromCount = 8KB units * 2).
    const chrMsb = (this.header[9] >> 4) & 0x0f;
    if (chrMsb === 0x0f) {
      const e = (this.header[5] >> 2) & 0x3f;
      const m = this.header[5] & 0x03;
      this.vromCount = Math.ceil((Math.pow(2, e) * (m * 2 + 1)) / 4096);
    } else {
      // 12-bit value is in 8KB units; double it for 4KB bank count.
      this.vromCount = ((chrMsb << 8) | this.header[5]) * 2;
    }

    // PRG-RAM sizes (byte 10).
    // Lower nibble: volatile PRG-RAM; upper nibble: non-volatile PRG-NVRAM.
    // Encoding: 0 = none, otherwise 64 << value bytes.
    this.prgRamSize = ROM._decodeRamSize(this.header[10] & 0x0f);
    this.prgNvRamSize = ROM._decodeRamSize((this.header[10] >> 4) & 0x0f);

    // CHR-RAM sizes (byte 11).
    // Lower nibble: volatile CHR-RAM; upper nibble: non-volatile CHR-NVRAM.
    // Note: with NES 2.0, do not assume 8KB CHR-RAM when CHR-ROM is 0;
    // CHR-RAM must be explicitly specified here.
    this.chrRamSize = ROM._decodeRamSize(this.header[11] & 0x0f);
    this.chrNvRamSize = ROM._decodeRamSize((this.header[11] >> 4) & 0x0f);

    // CPU/PPU timing mode (byte 12, low 2 bits).
    // 0 = NTSC (RP2C02), 1 = PAL (RP2C07), 2 = Multi-region, 3 = Dendy (UA6538)
    this.timingMode = this.header[12] & 0x03;

    // Console type (byte 7, bits 1..0).
    // 0 = NES/Famicom, 1 = Vs. System, 2 = Playchoice 10, 3 = Extended
    this.consoleType = this.header[7] & 0x03;
  }

  // Decode NES 2.0 RAM shift-count encoding.
  // Value 0 means no RAM; otherwise size = 64 << value (in bytes).
  // https://www.nesdev.org/wiki/NES_2.0#PRG-(NV)RAM/EEPROM
  static _decodeRamSize(value) {
    if (value === 0) return 0;
    return 64 << value;
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
