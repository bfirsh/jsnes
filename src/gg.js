
var GG = function(nes) {
  this.nes = nes;
  this.patches = [];
  this.enabled = true;
};

var LETTER_VALUES = 'APZLGITYEOXUKSVN';

function toDigit(letter) {
  return LETTER_VALUES.indexOf(letter);
}

function toLetter(digit) {
  return LETTER_VALUES.substr(digit, 1);
}

GG.prototype = {
  setEnabled: function(enabled) {
    this.enabled = enabled;
  },

  addCode: function(code) {
    this.patches.push(this.decode(code));
  },

  addPatch: function(addr, value, key) {
    this.patches.push({addr: addr, value: value, key: key});
  },

  applyCodes: function(addr, value) {
    if (!this.enabled) return value;

    for (var i = 0; i < this.patches.length; ++i) { // TODO: optimize data structure?
      if (this.patches[i].addr === (addr & 0x7fff)) {
        if (this.patches[i].key === undefined || this.patches[i].key === value) {
          return this.patches[i].value;
        }
      }
    }
    return value;
  },

  decode: function(code) {
    var digits = code.split('').map(toDigit);

    var value = ((digits[0] & 8) << 4) + ((digits[1] & 7) << 4) + (digits[0] & 7);
    var addr = ((digits[3] & 7) << 12) + ((digits[4] & 8) << 8) + ((digits[5] & 7) << 8) +
        ((digits[1] & 8) << 4) + ((digits[2] & 7) << 4) + (digits[3] & 8) + (digits[4] & 7);
    var key;

    if (digits.length == 8) {
      value += (digits[7] & 8);
      key = ((digits[6] & 8) << 4) + ((digits[7] & 7) << 4) + (digits[5] & 8) + (digits[6] & 7);
    } else {
      value += (digits[5] & 8);
    }

    var wantskey = !!(digits[2] >> 3);

    return { value: value, addr: addr, wantskey: wantskey, key: key };
  },

  encode: function(addr, value, key, wantskey) {
    var digits = Array(6);

    digits[0] = (value & 7) + ((value >> 4) & 8);
    digits[1] = ((value >> 4) & 7) + ((addr >> 4) & 8);
    digits[2] = ((addr >> 4) & 7);
    digits[3] = (addr >> 12) + (addr & 8);
    digits[4] = (addr & 7) + ((addr >> 8) & 8);
    digits[5] = ((addr >> 8) & 7);

    if (key === undefined) {
      digits[5] += value & 8;
      if (wantskey) digits[2] += 8;
    } else {
      digits[2] += 8;
      digits[5] += key & 8;
      digits[6] = (key & 7) + ((key >> 4) & 8);
      digits[7] = ((key >> 4) & 7) + (value & 8);
    }

    var code = digits.map(toLetter).join('');

    return code;
  },
};

module.exports = GG;
