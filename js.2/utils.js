
JSNES.Utils = {
    arraycopy: function(src, srcPos, dest, destPos, length) {
        for (var i=0; i<length; ++i) {
            dest[destPos+i] = src[srcPos+i];
        }
    }
}
