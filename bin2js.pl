#!/usr/bin/perl -w

$dir = $ARGV[0];

print "var ${dir}_list = new Array();\n";
opendir(DIR, $dir) || die "can't opendir $dir: $!";
while ($file = readdir(DIR)) {
	next if $file =~ /(^\.|\.js$)/;
	open(JSFILE, ">$dir/$file.js");
	$safe_file = $file;
	$safe_file =~ s/'/\\'/g;
	print JSFILE "${dir}['$safe_file'] = '";
	print "${dir}_list.push('$safe_file');\n";
	open(ROMFILE, "<$dir/$file") || die "can't open $file: $!";
	while (read(ROMFILE, $str, 512)) {
		$str =~ s/([0-9\x00-\x1f\x7f-\xff\\\'\"])/ sprintf("\\%o", ord($1)) /egs;
		#$str =~ s/([^A-Za-z])/ sprintf("\\%o", ord($1)) /egs;
		print JSFILE $str;
	}
	close(ROMFILE);
	print JSFILE "';\n";
	close (JSFILE);
};
#		STDOUT << "\\#{b.to_s(8)}"
closedir(DIR);
