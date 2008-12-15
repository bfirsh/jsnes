function Memory(nes, byteCount) {
    this.nes = nes;
    this.mem = new Array(byteCount);
    this.memLength = byteCount;
    
    this.reset = function() {
        for(var i=0;i<this.mem.length;i++) this.mem[i] = 0;
    }
    
    this.write = function(address, value, length) {
        if (typeof length == 'undefined') {
            this.mem[address] = value;
        }
        else {
            if (address+length > this.mem.length) return;
            arraycopy(value, 0, this.mem, address, length);
        }
    }   
    
    this.load = function(address) {
        return this.mem[address];
    }
    
    
}