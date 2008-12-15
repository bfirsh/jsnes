function arraycopy(src, srcPos, dest, destPos, length) {
    // we're assuming they're different arrays, and everything is within bounds
    for (var i=0; i<length; ++i) {
        dest[destPos+i] = src[srcPos+i];
    }
}

Array.prototype.has = function(value) {
    var i;
    for (var i = 0, loopCnt = this.length; i < loopCnt; i++) {
        if (this[i] === value) {
            return true;
        }
    }
    return false;
};
