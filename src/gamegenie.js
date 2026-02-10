var LETTER_VALUES = "APZLGITYEOXUKSVN";

function toDigit(letter) {
  return LETTER_VALUES.indexOf(letter);
}

function toLetter(digit) {
  return LETTER_VALUES.substr(digit, 1);
}

function toHex(n, width) {
  var s = n.toString(16);
  return "0000".substring(0, width - s.length) + s;
}

var GameGenie = function () {
  this.patches = [];
  this.enabled = true;
};

GameGenie.prototype = {
  setEnabled: function (enabled) {
    this.enabled = enabled;
  },

  addCode: function (code) {
    this.patches.push(this.decode(code));
  },

  addPatch: function (addr, value, key) {
    this.patches.push({ addr: addr, value: value, key: key });
  },

  removeAllCodes: function () {
    this.patches = [];
  },

  // Apply Game Genie patches to a value being read from the given address.
  // Game Genie works by intercepting ROM reads and substituting values.
  // The address is masked to 15 bits because Game Genie ignores the
  // highest bit (ROM is mirrored in $8000-$FFFF).
  applyCodes: function (addr, value) {
    if (!this.enabled) return value;

    for (var i = 0; i < this.patches.length; ++i) {
      if (this.patches[i].addr === (addr & 0x7fff)) {
        if (
          this.patches[i].key === undefined ||
          this.patches[i].key === value
        ) {
          return this.patches[i].value;
        }
      }
    }
    return value;
  },

  decode: function (code) {
    if (code.indexOf(":") !== -1) return this.decodeHex(code);

    var digits = code.toUpperCase().split("").map(toDigit);

    var value =
      ((digits[0] & 8) << 4) + ((digits[1] & 7) << 4) + (digits[0] & 7);
    var addr =
      ((digits[3] & 7) << 12) +
      ((digits[4] & 8) << 8) +
      ((digits[5] & 7) << 8) +
      ((digits[1] & 8) << 4) +
      ((digits[2] & 7) << 4) +
      (digits[3] & 8) +
      (digits[4] & 7);
    var key;

    if (digits.length === 8) {
      value += digits[7] & 8;
      key =
        ((digits[6] & 8) << 4) +
        ((digits[7] & 7) << 4) +
        (digits[5] & 8) +
        (digits[6] & 7);
    } else {
      value += digits[5] & 8;
    }

    var wantskey = !!(digits[2] >> 3);

    return { value: value, addr: addr, wantskey: wantskey, key: key };
  },

  encodeHex: function (addr, value, key, wantskey) {
    var s = toHex(addr, 4) + ":" + toHex(value, 2);

    if (key !== undefined || wantskey) {
      s += "?";
    }

    if (key !== undefined) {
      s += toHex(key, 2);
    }

    return s;
  },

  decodeHex: function (s) {
    var match = s.match(/([0-9a-fA-F]+):([0-9a-fA-F]+)(\?[0-9a-fA-F]*)?/);
    if (!match) return null;

    var addr = parseInt(match[1], 16);
    var value = parseInt(match[2], 16);
    var wantskey = match[3] !== undefined;
    var key =
      match[3] !== undefined && match[3].length > 1
        ? parseInt(match[3].substring(1), 16)
        : undefined;

    return { value: value, addr: addr, wantskey: wantskey, key: key };
  },

  encode: function (addr, value, key, wantskey) {
    var digits = Array(6);

    digits[0] = (value & 7) + ((value >> 4) & 8);
    digits[1] = ((value >> 4) & 7) + ((addr >> 4) & 8);
    digits[2] = (addr >> 4) & 7;
    digits[3] = (addr >> 12) + (addr & 8);
    digits[4] = (addr & 7) + ((addr >> 8) & 8);
    digits[5] = (addr >> 8) & 7;

    if (key === undefined) {
      digits[5] += value & 8;
      if (wantskey) digits[2] += 8;
    } else {
      digits[2] += 8;
      digits[5] += key & 8;
      digits[6] = (key & 7) + ((key >> 4) & 8);
      digits[7] = ((key >> 4) & 7) + (value & 8);
    }

    var code = digits.map(toLetter).join("");

    return code;
  },
};

module.exports = GameGenie;
