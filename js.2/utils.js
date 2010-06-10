
JSNES.Utils = {
    arraycopy: function(src, srcPos, dest, destPos, length) {
        for (var i=0; i<length; ++i) {
            dest[destPos+i] = src[srcPos+i];
        }
    },
    
    // http://www.sitepoint.com/blogs/2006/01/17/javascript-inheritance/
    copyPrototype: function(descendant, parent) {
        var sConstructor = parent.toString();
        var aMatch = sConstructor.match( /\s*function (.*)\(/ );
        if ( aMatch != null ) { descendant.prototype[aMatch[1]] = parent; }
        for (var m in parent.prototype) {
            if (typeof descendant.prototype[m] == 'undefined') {
                descendant.prototype[m] = parent.prototype[m];
            }
        }
    }
}
