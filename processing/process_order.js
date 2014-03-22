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
var getOrderGifs = function(order_id) {
	console.log(order_id, 'loading...');
	var deferred = Q.defer(),
		gifs = [];

	db_orders.get(order_id, function(err, order) {
		if (err) {
			console.log(err);
			return;
		}

		if (order.note != '') {
			console.log("has note:", order.note);
			return;
		}

		var items = order.line_items;
		items.forEach(function(item, i) {
			var property = item.properties[0],
				variant = item.variant_title.split(' - ')[0], // "Large Square - 2+"
				quantity = item.quantity,
				product_name = item.title; // item.title = "GIF CHOP" item.name = "GIF CHOP - Small Square 2+"

			if (product_name == 'Gift Card') {
				console.log(order_id, 'gift card, skipping!');
				return;
			}

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
			} else if (variant == '3&#189; x 3&#189;\"' || variant == '10x10\"' || variant == '10 x 10"' || variant == '10x10"') {
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

		if (!gifs.length) {
			console.log('no line items', order.line_items.length);
			deferred.resolve({
				id: order_id
			});
		} else {
			processGifs(gifs, order).then(function(results) {
				console.log(order_id, 'processed order\n');
				deferred.resolve({
					gifs: gifs,
					order: order,
					docs: results
				});
			});
		}
	});

	return deferred.promise;
};

var processGifs = function(gifs, order) {
	console.log(order._id, 'has', gifs.length, 'gifs to process');
	var deferred = Q.defer();

	var resultsToProcess = [];
	gifs.forEach(function(gif, i) {
		if (ONLY_LINEID && gif.id != ONLY_LINEID) {
			return;
		}

		if (ONLY_SELFMADE && gif.type == 'artist') {
			return;
		}

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
		if (doc.zip_url && doc.zip_url.search('cdn.gifpop.io') > 0 && FORCE == false) {
			console.log('>>>> already processed:\t', doc.zip_url);
			deferred.resolve(doc);
		} else if (doc.type == "flip") {
			console.log('>>>> processing as flipflop');
			downloadImages(doc)
				.then(processFlip)
				// .then(uploadZip)
				.then(uploadFlip)
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

	var tempimages = 'processing/renamedframes/' + doc.order_id + '_' + doc._id,
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

var processFlip = function(doc) {
	var deferred = Q.defer();
	var fileroot = doc.order_id + '_' + doc._id,
		size = getSize(doc.size),
		input = 'processing/renamedframes/' + fileroot + '/frame*',
		output = 'processing/renamedframes/' + fileroot + '/%03d.jpg',
		cmd = "convert {input} -adaptive-resize {size} -quality 90% {output}",
		cmd_exec = cmd.replace("{folder}", 'processing/renamedframes/' + fileroot)
						.replace("{input}", input)
						.replace("{output}", output)
						.replace("{size}", "'" + size + "'");

	console.log('>>>> exporting frames:\t', fileroot);
	exec(cmd_exec, function(err, stdout, stderr) {
		deferred.resolve(doc);
		// var zip = "cd {folder}; zip {output} {input}",
		// 	zip_exec = zip.replace("{folder}", 'processing/renamedframes/' + fileroot)
		// 					.replace("{output}", getFilename(doc, 'zip'))
		// 					.replace("{input}", "flip*.jpg");

		// console.log('>>>> zipping:\t\t', fileroot);
		// exec(zip_exec, function(err, stdout, stderr) {
		// 	deferred.resolve(doc);
		// });
	});

	return deferred.promise;
};

var uploadFlip = function(doc) {
	var deferred = Q.defer();

	var tempfolder = './processing/renamedframes/' + doc.order_id + '_' + doc._id + '/',
		filename0 = tempfolder + '000.jpg',
		filename1 = tempfolder + '001.jpg',
		destination = getCurrentUploadFolder() + doc.order_id + '_' + doc._id + '_';

	doc.zip_url = 'http://' + config.S3Bucket + '/' + destination;
	console.log('>>>> uploading to s3:\t', doc.zip_url);

	if (DEBUG) {
		console.log('>>>> skipping upload because DEBUG');
		deferred.resolve(doc);
	} else {
		s3.putFile(filename0, destination + '000.jpg', function(err, response) {
		    if (!err) {
		    	s3.putFile(filename1, destination + '001.jpg', function(err, response) {
		    		if (!err) {
				    	console.log('>>>> uploaded!\t\t', doc.order_id, doc._id);
				    	deferred.resolve(doc);
		    		} else {
		    			console.log(err);
		    		}
			    });
		    }
		    else {
			    console.log(err);
		    }
		});
	}

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

var getTenFrames = function(doc, folder) {
	var oldframes = doc.frames.split(','),
		frames = [],
		front = true,
		offset = 0,
		cp = [];

	// while (frames.length < 10) {
	// 	if (front) {
	// 		frames.splice(offset, 0, frames[offset]);
	// 	} else {
	// 		var end = frames.length - 1 - offset;
	// 		frames.splice(end, 0, frames[end]);
	// 		offset++;
	// 	}
	// 	front = !front;
	// }

	// round the frames
	console.log('found', oldframes);
	for (var j = 0; j < 10; j++) {
		var roundedIndex = Math.floor((j / 10) * oldframes.length);
		frames.push(oldframes[roundedIndex]);
	}
	console.log('padded to', frames);

	for (var i = 0; i < frames.length; i++) {
		cp.push('cp processing/frames/' + folder + '/' + getPad(frames[i], 3) + '.jpg processing/renamedframes/' + folder + '/' + getPad(i, 3) + '.jpg');
	}
	// console.log(cp);
	return cp.join(';');
};
/*
	the image processing part, where we get the selected frames
	and then use gifsicle to chop them out into a new gif
*/
var chopGif = function(doc) {
	var deferred = Q.defer();

    var fileroot = doc.order_id + '_' + doc._id,
		size = getSize(doc.size),
		mkdir = "mkdir processing/frames/{folder}; mkdir processing/renamedframes/{folder};".replace("{folder}", fileroot).replace("{folder}", fileroot),
		// if we want a custom background use hex like -background '#f1f7f7'
    	cmd = "convert ./processing/images/{input} -coalesce -background white -alpha Remove -adaptive-resize {size} -quality 90% {rotate} {border} 'processing/frames/{output}/%03d.jpg'",
    	// cmd = "convert ./processing/images/{input} -coalesce -quality 90% 'processing/frames/{output}/%03d.jpg'", // no resize
    	makegif = 'convert ./processing/frames/{folder}/%03d.jpg[{frames}] ./processing/choppt/{output}.gif; {cp_exec}';

    var cmd_exec = mkdir + cmd.replace("{input}", getFilename(doc, 'gif'))
    					.replace("{size}", size)
    					.replace("{output}", fileroot)
    					.replace("{rotate}", ROTATE ? '-rotate 90' : '')
							.replace("{border}", BORDER_VALUE ? '-bordercolor black -border ' + BORDER_VALUE + 'x' + BORDER_VALUE : '');

    console.log('>>>> chopping:\t\t', cmd_exec);
    exec(cmd_exec, function(err, stdout, stderr) {
    	var gif_exec = makegif.replace("{folder}", fileroot)
					    	.replace("{folder}", fileroot)
    						.replace("{frames}", doc.frames)
    						.replace("{output}", fileroot)
    						.replace("{cp_exec}", getTenFrames(doc, fileroot));

    	console.log('>>>> making gif:\t', fileroot);
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
		tempframes = './processing/renamedframes/',
		fileroot = doc.order_id + '_' + doc._id,
		filename = tempchoppt + getFilename(doc, 'gif'),
		size = getSize(doc.size);

	// in case we want to change the frames in the admin, we don't assume ranges here
    var frames = doc.frames.split(','),
    	selection = '',
    	i = 0;

    // frames.forEach(function(frame) {
    // 	selection += getPad(i, 3) + '.jpg ';
    // 	i++;
    // });
	for (var j = 0; j < 10; j++) {
		selection += getPad(j, 3) + '.jpg ';
	}

	var zip = "cd {folder}; zip {output} {input}",
		zip_exec = zip.replace("{folder}", 'processing/renamedframes/' + fileroot)
						.replace("{output}", getFilename(doc, 'zip'))
						.replace("{input}", selection);

	console.log('>>>> zipping:\t\t', selection);
	exec(zip_exec, function(err, stdout, stderr) {
		deferred.resolve(doc);
	});

	return deferred.promise;
};

var uploadZip = function(doc) {
	var deferred = Q.defer();

	var tempzipped = './processing/renamedframes/' + doc.order_id + '_' + doc._id + '/',
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
		    	console.log('>>>> uploaded!\t\t', doc.order_id, doc._id);
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
      date = FORCE_DATE || ("0" + d.getDate()).slice(-2),
      month = FORCE_MONTH || ("0" + (d.getMonth() + 1)).slice(-2);

    return 'zips/' + [d.getFullYear(), month, date].join('-') + '/';
};

var getSize = function(size) {
	var words = size.split(' '),
		size = words.length > 2 ? words[0] + ' ' + words[1] : size;

	var realwords = [];
	words.forEach(function(word, i) {
		if (word.charAt(word.length-1) != '+') {
			realwords.push(word);
		}
	});

	var realsize = realwords.join(' ');

	switch (realsize) {
		case 'Business Card':
			return "1012x637^";
		case 'Postcard':
		case 'Landscape Postcard':
			return "1500x1050^";

		case 'Portrait Postcard':
			return "1050x1500^";

		case 'Artist Large':
			return "3000x3000^";

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
			return "AA10110A3";
		case 'Portrait Business Card':
			return "AA10110A31";

		case 'Postcard ':
		case 'Postcard':
		case 'Landscape Postcard':
			return "AA20110A3";

		case 'Portrait Postcard':
			return "AA20110A31";

		case 'Large Square':
			return "AAS01A003";

		case 'Artist Small':
		case '3&#189; x 3&#189;\"':
			return "CAQ01A0A3";

		case 'Artist Large':
		case 'Artist Print':
		case '10 x 10\"':
		case '10 x 10"':
			return "AAT01A003"

		case 'Small Square':
			return "CAP01A0A3";

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
			case 'Fedex 2-Day':
			case "Fedex International Shipping, 2-3 Days":
				return '2day';
			case 'Priority':
			case 'USPS Priority — With Tracking Number':
				return 'priority';
			case 'Overnight':
				return 'overnight';
		}
	}

	return method;
};

var makeFullOrderRequest = function(order_details) {
	if (!order_details.gifs) {
		console.log(order_details.id, 'ended before making request');
		return;
	}
	var gifs = order_details.gifs,
		order = order_details.order,
		docs = order_details.docs,
		shipping = order.shipping_address;

	var full_order = config.REQUEST;

	full_order.requestId = new Date().getTime();
	full_order.orderId = "order-" + order.order_number + FORCE_SUFFIX;

	full_order.orderDate = order.created_at;
	full_order.orderLineItems = [];

	// attach all gifpop product information
	gifs.forEach(function(gif, i) {
		var amazon_url = 'http://' + config.S3Bucket + '/' + getCurrentUploadFolder() + gif.order_id + '_' + gif.id,
			thumbnail_url = 'http://gifbot.gifpop.io/' + gif.type + '/' + gif.id + '/preview.gif';

		if (ONLY_LINEID != null && gif.id != ONLY_LINEID) {
			return;
		}
		if (ONLY_SELFMADE && gif.type == 'artist') {
			return;
		}

		var item = {
			lineId: gif.id,
			productId: getProductId(gif.size),
			productInfo: gif.size,
			productName: gif.product_name,
			quantity: gif.quantity,
			thumbnail: thumbnail_url,
			effect: gif.effect
		};

		if (gif.type == 'flipflop') {
			item.picture0 = amazon_url + '_000.jpg';
			item.picture1 = amazon_url + '_001.jpg';
		} else if (gif.type == 'gifchop' ) {
			item.pictures = amazon_url + '.zip';
			// item.thumbnail = amazon_url + '.jpg'; // just for this one bulk run
		} else if (gif.type == 'artist') {
			item.pictures  = artist_info[gif.artist.toUpperCase()][gif.id];
			item.thumbnail = artist_info[gif.artist.toUpperCase()][gif.thumb];
			console.log(gif.thumb, gif.id);
		} else {
			console.log('UNKNOWN ORDER TYPE!');
		}

		full_order.orderLineItems.push(item);
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

	if (!DEBUG && !PREP) {
		request({
			method: 'GET',
			uri: config.REQUESTENDPOINT_LIVE,
			json: full_order
	    }, function(err, res, body) {
	    	if (!err) {
				console.log('-------------------------------------');
				console.log('------- order-' + order.order_number + ' SUBMITTED! -------');
				console.log('-------------------------------------');

				var csv = [];
				csv.push('\n' + full_order.orderId);
				csv.push(full_order.orderLineItems.length + ' line items');
				csv.push(getCurrentUploadFolder());
				csv.push(full_order.requestId);
				csv.push(body.desc);
				fs.appendFile('processing/render_logs.txt', csv.join(','), function (err) { });
	    	}
			console.log(err, body);

		});

		// https.request({
		// 	method: 'GET',
		// 	hostname: 'www.tracerpix.com',
		// 	path: '/api/order?format=json',
		// 	// uri: config.REQUESTENDPOINT_LIVE,
		// 	json: full_order
	 //    }, function(err, res, body) {
	 //    	if (!err) {
		// 		console.log('-------------------------------------');
		// 		console.log('------- order-' + order.order_number + ' SUBMITTED! -------');
		// 		console.log('-------------------------------------');
	 //    	}
		// 	console.log(err, body);
		// });
	}
};

var ORDER_ID = null,
	DEBUG = false,
	PREP = false,
	ROTATE = false,
	ONLY_LINEID = null,
	ONLY_SELFMADE = null,
	FORCE = false,
	FORCE_MONTH = null,
	FORCE_DATE = null,
	FORCE_SUFFIX = '',
	BORDER_VALUE = null,
	ORDER_START = null,
	ORDER_END = null;
process.argv.forEach(function (val, index, array) {
	if (index == 2 && val != null) {
		if (val.split('-').length > 1) {
			ORDER_START = parseInt(val.split('-')[0]);
			ORDER_END = parseInt(val.split('-')[1]);
			console.log(ORDER_START, ORDER_END);
		} else {
			ORDER_ID = 'order-' + val;
		}
	}

	if (val == '-debug') {
		console.log('running in debug mode, no uploading or saving to database');
		DEBUG = true;
	}
	else if (val == '-prep') {
		console.log('running in prep mode, uploading to s3 and saving to db, but not pushing to manufacturer');
		PREP = true;
	}
	else if (val == '-force') {
		console.log('running in force mode, regenerating files');
		FORCE = true;
	}
	else if (val == '-rotate') {
		console.log('rotating 90 degrees');
		ROTATE = true;
	}
	else if (val == '-noartist') {
		console.log('not submitting artist prints');
		ONLY_SELFMADE = true;
	}
	else if (val.search("lineid=") == 0) {
		ONLY_LINEID = val.split("lineid=")[1];
		console.log('only processing lineid', ONLY_LINEID);
	}
	else if (val.search("date=") == 0) {
		FORCE_DATE = val.split("date=")[1];
		console.log('forcing date', FORCE_DATE);
	} else if (val.search("suffix=") == 0) {
		FORCE_SUFFIX = val.split("suffix=")[1];
		console.log('forcing suffix', FORCE_SUFFIX);
	} else if (val.search("border=") == 0) {
		BORDER_VALUE = val.split("border=")[1];
		console.log('adding a black border of ', BORDER_VALUE);
	}
});

if (ORDER_ID) {
	getOrderGifs(ORDER_ID)
		.then(makeFullOrderRequest);
} else if (ORDER_START && ORDER_END) {
	for (var i = ORDER_START; i <= ORDER_END; i++) {
		var makeOrder = function(num) {
			return function() {
				getOrderGifs('order-' + num)
					.then(makeFullOrderRequest);
			};
		};
		setTimeout(makeOrder(i), (i - ORDER_START) * 60000);
			// .then(makeFullOrderRequest); // not submitting for now just processing
	}
}