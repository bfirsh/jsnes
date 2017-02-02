JSNES.Utils = function(){
    if (!(this instanceof JSNES.Utils)) return new JSNES.Utils()
};

JSNES.Utils.prototype = {
    copyArrayElements: function(src, srcPos, dest, destPos, length) {
        for (var i = 0; i < length; ++i) {
            dest[destPos + i] = src[srcPos + i];
        }
    },

    copyArray: function(src) {
        var dest = new Array(src.length);
        for (var i = 0; i < src.length; i++) {
            dest[i] = src[i];
        }
        return dest;
    },

    fromJSON: function(obj, state) {
        for (var i = 0; i < obj.JSON_PROPERTIES.length; i++) {
            obj[obj.JSON_PROPERTIES[i]] = state[obj.JSON_PROPERTIES[i]];
        }
    },

    toJSON: function(obj) {
        var state = {};
        for (var i = 0; i < obj.JSON_PROPERTIES.length; i++) {
            state[obj.JSON_PROPERTIES[i]] = obj[obj.JSON_PROPERTIES[i]];
        }
        return state;
    },

    isIE: function() {
        return (/msie/i.test(navigator.userAgent) && !/opera/i.test(navigator.userAgent));
    }
};
