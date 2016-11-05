JSNES.PPU.NameTable = function(width, height, name) {
    if (!(this instanceof JSNES.PPU.NameTable)) return new JSNES.PPU.NameTable(width, height, name)
    this.width = width;
    this.height = height;
    this.name = name;

    this.tile = new Array(width*height);
    this.attrib = new Array(width*height);
};

JSNES.PPU.NameTable.prototype = {
    getTileIndex: function(x, y){
        return this.tile[y*this.width+x];
    },

    getAttrib: function(x, y){
        return this.attrib[y*this.width+x];
    },

    writeAttrib: function(index, value){
        var basex = (index % 8) * 4;
        var basey = Math.floor(index / 8) * 4;
        var add;
        var tx, ty;
        var attindex;

        for (var sqy=0;sqy<2;sqy++) {
            for (var sqx=0;sqx<2;sqx++) {
                add = (value>>(2*(sqy*2+sqx)))&3;
                for (var y=0;y<2;y++) {
                    for (var x=0;x<2;x++) {
                        tx = basex+sqx*2+x;
                        ty = basey+sqy*2+y;
                        attindex = ty*this.width+tx;
                        this.attrib[ty*this.width+tx] = (add<<2)&12;
                    }
                }
            }
        }
    },

    toJSON: function() {
        return {
            'tile': this.tile,
            'attrib': this.attrib
        };
    },

    fromJSON: function(s) {
        this.tile = s.tile;
        this.attrib = s.attrib;
    }
};
