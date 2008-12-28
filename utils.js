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

// http://www.sitepoint.com/blogs/2006/01/17/javascript-inheritance/
function copyPrototype(descendant, parent) {
    var sConstructor = parent.toString();
    var aMatch = sConstructor.match( /\s*function (.*)\(/ );
    if ( aMatch != null ) { descendant.prototype[aMatch[1]] = parent; }
    for (var m in parent.prototype) {
        descendant.prototype[m] = parent.prototype[m];
    }
};