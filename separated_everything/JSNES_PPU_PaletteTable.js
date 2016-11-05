JSNES.PPU.PaletteTable = function() {
    if (!(this instanceof JSNES.PPU.PaletteTable)) return new JSNES.PPU.PaletteTable()
    this.curTable = new Array(64);
    this.emphTable = new Array(8);
    this.currentEmph = -1;
};

JSNES.PPU.PaletteTable.prototype = {
    reset: function() {
        this.setEmphasis(0);
    },

    loadNTSCPalette: function() {
        this.curTable = [0x525252, 0xB40000, 0xA00000, 0xB1003D, 0x740069, 0x00005B, 0x00005F, 0x001840, 0x002F10, 0x084A08, 0x006700, 0x124200, 0x6D2800, 0x000000, 0x000000, 0x000000, 0xC4D5E7, 0xFF4000, 0xDC0E22, 0xFF476B, 0xD7009F, 0x680AD7, 0x0019BC, 0x0054B1, 0x006A5B, 0x008C03, 0x00AB00, 0x2C8800, 0xA47200, 0x000000, 0x000000, 0x000000, 0xF8F8F8, 0xFFAB3C, 0xFF7981, 0xFF5BC5, 0xFF48F2, 0xDF49FF, 0x476DFF, 0x00B4F7, 0x00E0FF, 0x00E375, 0x03F42B, 0x78B82E, 0xE5E218, 0x787878, 0x000000, 0x000000, 0xFFFFFF, 0xFFF2BE, 0xF8B8B8, 0xF8B8D8, 0xFFB6FF, 0xFFC3FF, 0xC7D1FF, 0x9ADAFF, 0x88EDF8, 0x83FFDD, 0xB8F8B8, 0xF5F8AC, 0xFFFFB0, 0xF8D8F8, 0x000000, 0x000000];
        this.makeTables();
        this.setEmphasis(0);
    },

    loadPALPalette: function() {
        this.curTable = [0x525252, 0xB40000, 0xA00000, 0xB1003D, 0x740069, 0x00005B, 0x00005F, 0x001840, 0x002F10, 0x084A08, 0x006700, 0x124200, 0x6D2800, 0x000000, 0x000000, 0x000000, 0xC4D5E7, 0xFF4000, 0xDC0E22, 0xFF476B, 0xD7009F, 0x680AD7, 0x0019BC, 0x0054B1, 0x006A5B, 0x008C03, 0x00AB00, 0x2C8800, 0xA47200, 0x000000, 0x000000, 0x000000, 0xF8F8F8, 0xFFAB3C, 0xFF7981, 0xFF5BC5, 0xFF48F2, 0xDF49FF, 0x476DFF, 0x00B4F7, 0x00E0FF, 0x00E375, 0x03F42B, 0x78B82E, 0xE5E218, 0x787878, 0x000000, 0x000000, 0xFFFFFF, 0xFFF2BE, 0xF8B8B8, 0xF8B8D8, 0xFFB6FF, 0xFFC3FF, 0xC7D1FF, 0x9ADAFF, 0x88EDF8, 0x83FFDD, 0xB8F8B8, 0xF5F8AC, 0xFFFFB0, 0xF8D8F8, 0x000000, 0x000000];
        this.makeTables();
        this.setEmphasis(0);
    },

    makeTables: function(){
        var r, g, b, col, i, rFactor, gFactor, bFactor;

        // Calculate a table for each possible emphasis setting:
        for (var emph = 0; emph < 8; emph++) {

            // Determine color component factors:
            rFactor = 1.0;
            gFactor = 1.0;
            bFactor = 1.0;

            if ((emph & 1) !== 0) {
                rFactor = 0.75;
                bFactor = 0.75;
            }
            if ((emph & 2) !== 0) {
                rFactor = 0.75;
                gFactor = 0.75;
            }
            if ((emph & 4) !== 0) {
                gFactor = 0.75;
                bFactor = 0.75;
            }

            this.emphTable[emph] = new Array(64);

            // Calculate table:
            for (i = 0; i < 64; i++) {
                col = this.curTable[i];
                r = Math.floor(this.getRed(col) * rFactor);
                g = Math.floor(this.getGreen(col) * gFactor);
                b = Math.floor(this.getBlue(col) * bFactor);
                this.emphTable[emph][i] = this.getRgb(r, g, b);
            }
        }
    },

    setEmphasis: function(emph){
        if (emph != this.currentEmph) {
            this.currentEmph = emph;
            for (var i = 0; i < 64; i++) {
                this.curTable[i] = this.emphTable[emph][i];
            }
        }
    },

    getEntry: function(yiq){
        return this.curTable[yiq];
    },

    getRed: function(rgb){
        return (rgb>>16)&0xFF;
    },

    getGreen: function(rgb){
        return (rgb>>8)&0xFF;
    },

    getBlue: function(rgb){
        return rgb&0xFF;
    },

    getRgb: function(r, g, b){
        return ((r<<16)|(g<<8)|(b));
    },

    loadDefaultPalette: function(){
        this.curTable[ 0] = this.getRgb(117,117,117);
        this.curTable[ 1] = this.getRgb( 39, 27,143);
        this.curTable[ 2] = this.getRgb(  0,  0,171);
        this.curTable[ 3] = this.getRgb( 71,  0,159);
        this.curTable[ 4] = this.getRgb(143,  0,119);
        this.curTable[ 5] = this.getRgb(171,  0, 19);
        this.curTable[ 6] = this.getRgb(167,  0,  0);
        this.curTable[ 7] = this.getRgb(127, 11,  0);
        this.curTable[ 8] = this.getRgb( 67, 47,  0);
        this.curTable[ 9] = this.getRgb(  0, 71,  0);
        this.curTable[10] = this.getRgb(  0, 81,  0);
        this.curTable[11] = this.getRgb(  0, 63, 23);
        this.curTable[12] = this.getRgb( 27, 63, 95);
        this.curTable[13] = this.getRgb(  0,  0,  0);
        this.curTable[14] = this.getRgb(  0,  0,  0);
        this.curTable[15] = this.getRgb(  0,  0,  0);
        this.curTable[16] = this.getRgb(188,188,188);
        this.curTable[17] = this.getRgb(  0,115,239);
        this.curTable[18] = this.getRgb( 35, 59,239);
        this.curTable[19] = this.getRgb(131,  0,243);
        this.curTable[20] = this.getRgb(191,  0,191);
        this.curTable[21] = this.getRgb(231,  0, 91);
        this.curTable[22] = this.getRgb(219, 43,  0);
        this.curTable[23] = this.getRgb(203, 79, 15);
        this.curTable[24] = this.getRgb(139,115,  0);
        this.curTable[25] = this.getRgb(  0,151,  0);
        this.curTable[26] = this.getRgb(  0,171,  0);
        this.curTable[27] = this.getRgb(  0,147, 59);
        this.curTable[28] = this.getRgb(  0,131,139);
        this.curTable[29] = this.getRgb(  0,  0,  0);
        this.curTable[30] = this.getRgb(  0,  0,  0);
        this.curTable[31] = this.getRgb(  0,  0,  0);
        this.curTable[32] = this.getRgb(255,255,255);
        this.curTable[33] = this.getRgb( 63,191,255);
        this.curTable[34] = this.getRgb( 95,151,255);
        this.curTable[35] = this.getRgb(167,139,253);
        this.curTable[36] = this.getRgb(247,123,255);
        this.curTable[37] = this.getRgb(255,119,183);
        this.curTable[38] = this.getRgb(255,119, 99);
        this.curTable[39] = this.getRgb(255,155, 59);
        this.curTable[40] = this.getRgb(243,191, 63);
        this.curTable[41] = this.getRgb(131,211, 19);
        this.curTable[42] = this.getRgb( 79,223, 75);
        this.curTable[43] = this.getRgb( 88,248,152);
        this.curTable[44] = this.getRgb(  0,235,219);
        this.curTable[45] = this.getRgb(  0,  0,  0);
        this.curTable[46] = this.getRgb(  0,  0,  0);
        this.curTable[47] = this.getRgb(  0,  0,  0);
        this.curTable[48] = this.getRgb(255,255,255);
        this.curTable[49] = this.getRgb(171,231,255);
        this.curTable[50] = this.getRgb(199,215,255);
        this.curTable[51] = this.getRgb(215,203,255);
        this.curTable[52] = this.getRgb(255,199,255);
        this.curTable[53] = this.getRgb(255,199,219);
        this.curTable[54] = this.getRgb(255,191,179);
        this.curTable[55] = this.getRgb(255,219,171);
        this.curTable[56] = this.getRgb(255,231,163);
        this.curTable[57] = this.getRgb(227,255,163);
        this.curTable[58] = this.getRgb(171,243,191);
        this.curTable[59] = this.getRgb(179,255,207);
        this.curTable[60] = this.getRgb(159,255,243);
        this.curTable[61] = this.getRgb(  0,  0,  0);
        this.curTable[62] = this.getRgb(  0,  0,  0);
        this.curTable[63] = this.getRgb(  0,  0,  0);

        this.makeTables();
        this.setEmphasis(0);
    }
};
