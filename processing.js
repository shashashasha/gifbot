var gm = require('gm')
  , fs = require('fs')
  , path = require('path')
  , http = require('http')
  , request = require('request')
  , cheerio = require('cheerio')
  , util = require('util')
  , exec = require('child_process').exec
  , nano = require('nano')('http://db.gifpop.io/')
  , db = nano.db.use('gifpop')
  , Q = require('q');

var updateDesignDoc = function() {
	var deferred = Q.defer();

	db.get('_design/pipeline', null, function(err, body) {

		// update object
		var doc = {
			"_rev": body._rev,
			"views": {
				"status": {
					"map": "function(doc) { if (doc.status) emit(doc.status) }"
				}
			}
		};

		db.insert(doc, '_design/pipeline', function(error, response) {
			if (err) {
				deferred.reject(new Error(err));
			}
		    else {
				deferred.resolve();
			}
		});
	});

	return deferred.promise;
};

var getSelectedGifs = function() {
	var deferred = Q.defer();
	db.view('pipeline', 'status', { key: "selected" }, function(err, body) {
		if (err) {
			deferred.reject(new Error(err));
		}
	    else {
			deferred.resolve(body);
		}
	});

	return deferred.promise;
};

var processResults = function(results) {
	var deferred = Q.defer();

	console.log('results: ', results.rows.length);
	var resultsToProcess = [];
	for (var i = 0; i < results.rows.length; i++) {
		var row = results.rows[i];
		resultsToProcess.push(processRow(row));
	}

	Q.all(resultsToProcess)
		.then(function(results) {
			deferred.resolve(results);
		});
	return deferred.promise;
};

var processRow = function(row) {
	var deferred = Q.defer();

	db.get(row.id, function(err, body) {
		downloadGif(body)
			.then(chopGif)
			.then(exportFrames)
			.then(function(result) {
				// finally finished
				deferred.resolve(result);
			});
	});

	return deferred.promise;
};

var downloadGif = function(doc) {
	var deferred = Q.defer();

	var tempimages = 'processing/images/',
		filename = tempimages + doc._id + '.gif',
		file = fs.createWriteStream(filename);

	console.log('downloading', doc._id, doc.url);
	request(doc.url).pipe(file);
	file.on('finish', function(){
		deferred.resolve(doc);
	});

	return deferred.promise;
};

/*
	the image processing part, where we get the selected frames
	and then use gifsicle to chop them out into a new gif
*/
var chopGif = function(doc) {
	var deferred = Q.defer();

	var tempimages = 'processing/images/',
		tempchoppt = 'processing/choppt/',
		filename = tempimages + doc._id + '.gif';

    var selection = doc.frames.split(','),
        start = +selection[0],
        end = +selection[selection.length-1],
        frames = "'#" + start + "-" + end + "'";

    var output = tempchoppt + doc._id + ".gif",
    	cmd = "gifsicle -U {input} {frames} -o {output}";

    var cmd_exec = cmd.replace("{input}", filename)
    					.replace("{frames}", frames)
    					.replace("{output}", output);

    console.log('chopping', doc._id, frames);
    exec(cmd_exec, function(err, stdout, stderr) {
		deferred.resolve(doc);
    });

	return deferred.promise;
};

/*
	here we use imagemagick to coalesce and export the frames
	and then zip them up for upload to the manufacturer
	we can set image quality here
*/
var exportFrames = function(doc) {
	var deferred = Q.defer();

	var tempchoppt = 'processing/choppt/',
		tempframes = 'processing/frames/',
		tempzipped = 'processing/zipped/',
		filename = tempchoppt + doc._id + '.gif';

	var output = tempframes + doc._id + '-%03d.png',
		cmd = "convert {input} -coalesce {output}",
		cmd_exec = cmd.replace("{input}", filename)
						.replace("{output}", output);

	console.log('exporting', doc._id);
	exec(cmd_exec, function(err, stdout, stderr) {
		var zip = "zip {output} {input}",
			zip_exec = zip.replace("{output}", tempzipped + doc._id + '.zip')
							.replace("{input}", tempframes + doc._id + "*");

		console.log('zipping', doc._id);
		exec(zip_exec, function(err, stdout, stderr) {
			deferred.resolve(doc);
		});
	});
	return deferred.promise;
};

updateDesignDoc()
	.then(getSelectedGifs)
	.then(processResults)
	.then(function(result) {
		console.log('finished batch processing:', result);
		console.log('--------------------------------');
		console.log('-----FINALLY FINISHED JOB!------');
		console.log('--------------------------------');
	});