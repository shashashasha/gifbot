var gm = require('gm')
  , fs = require('fs')
  , config = JSON.parse(fs.readFileSync('./settings.json'))
  , artist_info = JSON.parse(fs.readFileSync('./artists.json'))

  // , process = require('process')
  , path = require('path')
  , http = require('http')
  , https = require('https')
  , request = require('request')
  , cheerio = require('cheerio')
  , util = require('util')
  , exec = require('child_process').exec
  , nano = require('nano')(config.DATABASE)
  , db = nano.db.use('gifpop-uploads')
  , db_orders = nano.db.use('gifpop-orders')
  , Q = require('q')
  , knox = require('knox')
  , s3 = knox.createClient({
	  key: config.AWSCDNAccessKey,
	  secret: config.AWSCDNSecret,
	  bucket: config.S3Bucket
	});

/*
	load an order
	and grab the doc_id's associated with it, and render them
*/
var getOrderGifs = function() {
	console.log(order_id, 'loading...');
	var deferred = Q.defer(),
		gifs = [];

	db_orders.get(order_id, function(err, order) {
		if (err) {
			console.log(err);
			return;
		}

		if (order.note != '') {
			console.log("has note!");
			return;
		}

		var items = order.line_items;
		items.forEach(function(item, i) {
			var property = item.properties[0],
				variant = item.variant_title.split(' - ')[0], // "Large Square - 2+"
				quantity = item.quantity,
				product_name = item.title; // item.title = "GIF CHOP" item.name = "GIF CHOP - Small Square 2+"

			// make sure we have a doc-id
			if (property.name == 'doc-id' && property.value.length) {
				var doc_id = property.value;
				console.log(order_id, 'contains doc-id:', doc_id, 'size:', variant);
				gifs.push({
					order_id: order_id,
					id: doc_id,
					quantity: quantity,
					size: variant,
					product_name: product_name,
					type: product_name == 'FLIP FLOP' ? 'flipflop' : 'gifchop',
					effect: product_name == 'FLIP FLOP' ? '2FLIP' : 'MOVIE'
				});
			} else if (variant == '3&#189; x 3&#189;\"' || variant == '10x10\"' || variant == '10 x 10"') {
				console.log(order_id, 'artist gif!');
				var artist_size = variant == '3&#189; x 3&#189;\"' ? 'Artist Small' : 'Artist Large';

				gifs.push({
					order_id: order_id,
					id: 'print_' + item.product_id,
					thumb: 'thumb_' + item.product_id,
					quantity: item.quantity,
					size: artist_size,
					artist: item.title,
					product_name: item.title + ' - ' + artist_size,
					type: 'artist',
					effect: 'MOVIE'
				});

			} else {
				console.log(order_id, 'doc-id not found');
			}
		});

		processGifs(gifs, order).then(function(results) {
			console.log(order_id, 'processed order');
			deferred.resolve({
				gifs: gifs,
				order: order,
				docs: results
			});
		});
	});

	return deferred.promise;
};

var processGifs = function(gifs, order) {
	console.log(order._id, 'has', gifs.length, 'gifs to process');
	var deferred = Q.defer();

	var resultsToProcess = [];
	gifs.forEach(function(gif, i) {
		resultsToProcess.push(processRow(gif));
	});

	Q.all(resultsToProcess)
		.then(function(results) {
			deferred.resolve(results);
		});
	return deferred.promise;
};

var processRow = function(row) {
	var deferred = Q.defer();

	if (row.type == 'artist') {
		deferred.resolve({});
		return;
	}

	db.get(row.id, function(err, doc) {
		// keep track of the size with the gif doc
		doc.size = row.size;
		doc.status = 'ordered';
		doc.order_id = row.order_id;

		// creating this function here to make sure we can resolve processRow's promise
		// this saves the doc back to gifpop-uploads so we don't have to reprocess things if we don't want to
		var saveDoc = function(result) {
			doc.zip_url = 'http://' + config.S3Bucket + '/' + getCurrentUploadFolder() + doc.order_id + '_' + doc._id + '.zip';
			if (DEBUG) {
				console.log('>>>> not saving doc because DEBUG');
				deferred.resolve(result);
			} else {
				db.insert(doc, doc._id, function(err) {
					if (err) console.log(err);

					console.log('>>>> saved doc-id:\t', doc._id);
					deferred.resolve(result);
				});
			}
		};

		// if it has the url, don't bother reprocessing it
		// otherwise we need to download it and chop it up and put it on s3
		console.log("type:", doc._id, doc.type);
		if (doc.zip_url && doc.zip_url.search('cdn.gifpop.io') > 0) {
			console.log('>>>> already processed:\t', doc.zip_url);
			deferred.resolve(doc);
		} else if (doc.type == "flip") {
			console.log('>>>> processing as flipflop');
			downloadImages(doc)
				.then(zipFlip)
				.then(uploadZip)
				.then(saveDoc);
		} else {
			console.log('>>>> processing as gifchop');
			downloadGif(doc)
				.then(chopGif)
				.then(zipGifChop)
				.then(uploadZip)
				.then(saveDoc);
		}
	});

	return deferred.promise;
};

var downloadImages = function(doc) {
	var deferred = Q.defer();

	var tempimages = 'processing/frames/' + doc.order_id + '_' + doc._id,
		filename0 = './' + tempimages + '/frame0.' + doc.url0.split('.').pop(),
		filename1 = './' + tempimages + '/frame1.' + doc.url1.split('.').pop();

	console.log('>>>> made directory:\t', tempimages);
	exec('mkdir ' + tempimages, function(err, stdout, stderr) {
		var file0 = fs.createWriteStream(filename0),
			file1 = fs.createWriteStream(filename1);

		console.log('>>>> downloading url0:\t', doc.url0);

		request(doc.url0).pipe(file0);
		file0.on('finish', function(){
			console.log('>>>> downloading url1:\t', doc.url1);
			request(doc.url1).pipe(file1);
			file1.on('finish', function() {
				console.log('>>>> downloaded both flip images!');
				deferred.resolve(doc);
			});
		});
	});

	return deferred.promise;
};

var zipFlip = function(doc) {
	var deferred = Q.defer();
	var fileroot = doc.order_id + '_' + doc._id,
		size = getSize(doc.size),
		input = 'processing/frames/' + fileroot + '/frame*',
		output = 'processing/frames/' + fileroot + '/flip_%03d.jpg',
		cmd = "convert {input} -adaptive-resize {size} -quality 90% {output}",
		cmd_exec = cmd.replace("{folder}", 'processing/frames/' + fileroot)
						.replace("{input}", input)
						.replace("{output}", output)
						.replace("{size}", "'" + size + "'");

	console.log('>>>> exporting frames:\t', fileroot);
	exec(cmd_exec, function(err, stdout, stderr) {
		var zip = "cd {folder}; zip {output} {input}",
			zip_exec = zip.replace("{folder}", 'processing/frames/' + fileroot)
							.replace("{output}", getFilename(doc, 'zip'))
							.replace("{input}", "flip*.jpg");

		console.log('>>>> zipping:\t\t', fileroot);
		exec(zip_exec, function(err, stdout, stderr) {
			deferred.resolve(doc);
		});
	});

	return deferred.promise;
};

var downloadGif = function(doc) {
	var deferred = Q.defer();

	var tempimages = './processing/images/',
		filename = tempimages + getFilename(doc, 'gif'),
		file = fs.createWriteStream(filename);

	console.log('>>>> downloading:\t', doc.url);
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

    var fileroot = doc.order_id + '_' + doc._id,
		size = getSize(doc.size),
		mkdir = "mkdir processing/frames/{folder}; ".replace("{folder}", fileroot),
    	cmd = "convert ./processing/images/{input} -coalesce -adaptive-resize {size} -quality 90% 'processing/frames/{output}/%03d.jpg'",
    	makegif = 'convert ./processing/frames/{folder}/%03d.jpg[{frames}] ./processing/choppt/{output}.gif';

    var cmd_exec = mkdir + cmd.replace("{input}", getFilename(doc, 'gif'))
    					.replace("{frames}", doc.frames)
    					.replace("{size}", size)
    					.replace("{output}", fileroot);

    console.log('>>>> chopping:\t', cmd_exec);
    exec(cmd_exec, function(err, stdout, stderr) {
    	var gif_exec = makegif.replace("{folder}", fileroot)
    						.replace("{frames}", doc.frames)
    						.replace("{output}", fileroot);

    	console.log('>>>> making gif:\t', gif_exec);
    	exec(gif_exec, function(err, stdout, stderr) {
    		console.log('>>>> made gif!');
			deferred.resolve(doc);
    	});
    });

	return deferred.promise;
};

/*
	here we use imagemagick to coalesce and export the frames
	and then zip them up for upload to the manufacturer
	we can set image quality here
*/
var zipGifChop = function(doc) {
	var deferred = Q.defer();

	var tempchoppt = './processing/choppt/',
		tempframes = './processing/frames/',
		fileroot = doc.order_id + '_' + doc._id,
		filename = tempchoppt + getFilename(doc, 'gif'),
		size = getSize(doc.size);

	// in case we want to change the frames in the admin, we don't assume ranges here
    var frames = doc.frames.split(','),
    	selection = '';

    frames.forEach(function(frame) {
    	selection += getPad(frame, 3) + '.jpg ';
    });

	var zip = "cd {folder}; zip {output} {input}",
		zip_exec = zip.replace("{folder}", 'processing/frames/' + fileroot)
						.replace("{output}", getFilename(doc, 'zip'))
						.replace("{input}", selection);

	console.log('>>>> zipping:\t\t', zip_exec);
	exec(zip_exec, function(err, stdout, stderr) {
		deferred.resolve(doc);
	});

	return deferred.promise;
};

var uploadZip = function(doc) {
	var deferred = Q.defer();

	var tempzipped = './processing/frames/' + doc.order_id + '_' + doc._id + '/',
		filename = tempzipped + getFilename(doc, 'zip'),
		destination = getCurrentUploadFolder() + getFilename(doc, 'zip');

	doc.zip_url = 'http://' + config.S3Bucket + '/' + destination;
	console.log('>>>> uploading to s3:\t', doc.zip_url);

	if (DEBUG) {
		console.log('>>>> skipping upload because DEBUG');
		deferred.resolve(doc);
	} else {
		s3.putFile(filename, destination, function(err, response) {
		    if (!err) {
		    	console.log('>>>> uploaded successfully!');
		    	deferred.resolve(doc);
		    }
		    else {
			    console.log(err);
		    }
		});
	}

	return deferred.promise;
};

var getPad = function(num, numZeros) {
	var n = Math.abs(num);
	var zeros = Math.max(0, numZeros - Math.floor(n).toString().length );
	var zeroString = Math.pow(10,zeros).toString().substr(1);
	if( num < 0 ) {
		zeroString = '-' + zeroString;
	}

	return zeroString+n;
};

var getFilename = function(doc, ext) {
	return doc.order_id + '_' + doc._id + '.' + ext;
};

var getCurrentUploadFolder = function() {
  var d = new Date(),
      date = ("0" + d.getDate()).slice(-2),
      month = ("0" + (d.getMonth() + 1)).slice(-2);

    return 'zips/' + [d.getFullYear(), month, date].join('-') + '/';
};

var getSize = function(size) {
	var words = size.split(' '),
		size = words.length > 2 ? words[0] + ' ' + words[1] : size;

	switch (size) {
		case 'Business Card':
			return "1012x637^";
		case 'Postcard':
		case 'Landscape Postcard':
			return "1500x1050^";

		case 'Portrait Postcard':
			return "1050x1500^";

		case 'Large Square':
			return "1500x1500^";

		case 'Small Square':
			return "825x825^";

		default:
			console.log("unable to find", size);
			return "825x825^";
	}
};

// manufacturer's internal product ids
// 2.75 Instagram Motion Print	CAP01A0A
// 3.5 Instagram Motion Print	CAQ01A0A
// Large Motion Print			AA20110A
// Wallet Motion Print			AA10110A
// 5” x 5”						AAS01A00
// 10” x 10”					AAT01A00
var getProductId = function(size) {
	var words = size.split(' '),
		realsize = [];

	words.forEach(function(word, i) {
		if (word.charAt(word.length-1) != '+') {
			realsize.push(word);
		}
	});

	realsize = realsize.join(' ');

	switch (realsize) {
		case 'Business Card':
			return "AA10110A";
		case 'Postcard':
		case 'Landscape Postcard':
			return "AA20110A";

		case 'Portrait Postcard':
			return "AA20110A";

		case 'Large Square':
			return "AAS01A00";

		case 'Artist Small':
		case '3&#189; x 3&#189;\"':
			return "CAQ01A0A";

		case 'Artist Large':
		case 'Artist Print':
		case '10 x 10\"':
			return "AAT01A00"

		case 'Small Square':
			return "CAP01A0A";

		default:
			console.log("unable to find", size);
			return "unknown";
	}
};

var getShippingMethod = function(order) {
	var method = 'standard';

	if (order.shipping_lines && order.shipping_lines[0] && order.shipping_lines[0].code) {
		var code = order.shipping_lines[0].code;
		switch (code) {
			case '2 Day':
				return '2day';
			case 'Priority':
				return 'priority';
			case 'Overnight':
				return 'overnight';
		}
	}

	return method;
};

var makeFullOrderRequest = function(order_details) {
	var gifs = order_details.gifs,
		order = order_details.order,
		docs = order_details.docs,
		shipping = order.shipping_address;

	var full_order = config.REQUEST;

	full_order.requestId = new Date().getTime();
	full_order.orderId = order_id;

	full_order.orderDate = order.created_at;
	full_order.orderLineItems = [];

	// attach all gifpop product information
	gifs.forEach(function(gif, i) {
		var amazon_url = 'http://' + config.S3Bucket + '/' + getCurrentUploadFolder() + gif.order_id + '_' + gif.id + '.zip',
			thumbnail_url = 'http://gifbot.gifpop.io/' + gif.type + '/' + gif.id + '/preview.gif';

		if (gif.type == 'artist') {
			amazon_url =     artist_info[gif.artist.toUpperCase()][gif.id];
			thumbnail_url =  artist_info[gif.artist.toUpperCase()][gif.thumb];
			console.log(gif.thumb, gif.id);
		}

		full_order.orderLineItems.push({
			lineId: gif.id,
			productId: getProductId(gif.size),
			productInfo: gif.size,
			productName: gif.product_name,
			quantity: gif.quantity,
			pictures: amazon_url,
			thumbnail: thumbnail_url,
			effect: gif.effect
		});
	});

	// attach shipping information from shopify order
	full_order.shippingInfo = {
		shippingEmail: 		order.email,
		shippingFirstName: 	shipping.first_name,
		shippingLastName: 	shipping.last_name,
		shippingCompany: 	shipping.company,
		shippingAddress1: 	shipping.address1,
		shippingAddress2: 	shipping.address2,
		shippingCity: 		shipping.city,
		shippingState: 		shipping.province,
		shippingPostalCode: shipping.zip,
		shippingCountry:  	shipping.country_code,
		shippingPhone: 		shipping.phone,
		shippingMethod: 	getShippingMethod(order)
	};

	console.log(full_order);

	if (!DEBUG) {
		request({
			method: 'GET',
			uri: config.REQUESTENDPOINT,
			json: full_order
	    }, function(err, res, body) {
	    	if (!err) {
				console.log('-------------------------------------');
				console.log('------- ' + order_id + ' SUBMITTED! -------');
				console.log('-------------------------------------');
	    	}
			console.log(err, body);
		});
	}
};

var order_id = null,
	DEBUG = false;
process.argv.forEach(function (val, index, array) {
	if (index == 2 && val != null) {
		order_id = 'order-' + val;
	}
	if (val == '-debug') {
		console.log('running in debug mode, no uploading or saving to database');
		DEBUG = true;
	}
});

getOrderGifs(order_id)
	.then(makeFullOrderRequest);