.PHONY: all
all: roms.js

roms.js: bin2js.pl roms/*
	perl bin2js.pl roms > roms.js

.PHONY: clean
clean:
	rm -f roms.js
