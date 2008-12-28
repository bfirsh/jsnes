function NameTable(width, height, name) {
	
	this.name = name;
	
	this.tile = new Array(width*height);
	this.attrib = new Array(width*height);
	
	this.width = width;
	this.height = height;
	
	
	this.getTileIndex = function(x, y){
		return this.tile[y*this.width+x];
	}
	
	this.getAttrib = function(x, y){
		return this.attrib[y*this.width+x];
	}
	
	this.writeAttrib = function(index, value){
		
		var basex,basey;
		var add;
		var tx,ty;
		var attindex;
		basex = index%8;
		basey = parseInt(index/8);
		basex *= 4;
		basey *= 4;
		
		for(var sqy=0;sqy<2;sqy++){
			for(var sqx=0;sqx<2;sqx++){
				add = (value>>(2*(sqy*2+sqx)))&3;
				for(var y=0;y<2;y++){
					for(var x=0;x<2;x++){
						tx = basex+sqx*2+x;
						ty = basey+sqy*2+y;
						attindex = ty*width+tx;
						this.attrib[ty*width+tx] = (add<<2)&12;
						////System.out.println("x="+tx+" y="+ty+" value="+attrib[ty*width+tx]+" index="+attindex);
					}
				}
			}
		}
		
	}
	
	
}