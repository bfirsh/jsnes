module.exports = {
  copyArrayElements: function (src, srcPos, dest, destPos, length) {
    for (var i = 0; i < length; ++i) {
      dest[destPos + i] = src[srcPos + i];
    }
  },

  copyArray: function (src) {
    return src.slice(0);
  },

  fromJSON: function (obj, state) {
    for (var i = 0; i < obj.JSON_PROPERTIES.length; i++) {
      obj[obj.JSON_PROPERTIES[i]] = state[obj.JSON_PROPERTIES[i]];
    }
  },

  toJSON: function (obj) {
    var state = {};
    for (var i = 0; i < obj.JSON_PROPERTIES.length; i++) {
      state[obj.JSON_PROPERTIES[i]] = obj[obj.JSON_PROPERTIES[i]];
    }
    return state;
  },
};
