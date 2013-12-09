var gm = require('gm')
  , fs = require('fs')
  , config = JSON.parse(fs.readFileSync('./settings.json'))

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

	db.get(row.id, function(err, doc) {
		// keep track of the size with the gif doc
		doc.size = row.size;
		doc.status = 'ordered';
		doc.order_id = row.order_id;

		// if it has the url, don't bother reprocessing it
		if (doc.zip_url && doc.zip_url.search('cdn.gifpop.io') > 0) {
			console.log('>>>> already processed, zip here:', doc.zip_url);
			deferred.resolve(doc);
		} else if (doc.type == "flip") {
			console.log('>>>> flip, ignoring for now');
			downloadImages(doc)
				.then(zipFlip);

				// .then(uploadZip)
				// .then(function(result) {
				// 	// finally finished
				// 	doc.zip_url = 'http://' + config.S3Bucket + '/' + getCurrentUploadFolder() + doc.order_id + '_' + doc._id + '.zip';
				// 	db.insert(doc, doc._id, function(err) {
				// 		if (err) console.log(err);

				// 		console.log('>>>> saved doc-id', doc._id);
				// 		deferred.resolve(result);
				// 	});
				// });

		} else {

			// otherwise we need to download it and chop it up and put it on s3
			downloadGif(doc)
				.then(chopGif)
				.then(exportFrames)
				.then(uploadZip)
				.then(function(result) {
					// finally finished
					doc.zip_url = 'http://' + config.S3Bucket + '/' + getCurrentUploadFolder() + doc.order_id + '_' + doc._id + '.zip';
					db.insert(doc, doc._id, function(err) {
						if (err) console.log(err);

						console.log('>>>> saved doc-id', doc._id);
						deferred.resolve(result);
					});
				});
		}
	});

	return deferred.promise;
};

var downloadImages = function(doc) {
	var deferred = Q.defer();

	var tempimages = 'processing/frames/' + doc.order_id + '_' + doc._id,
		filename0 = './' + tempimages + '/frame0.' + doc.url0.split('.').pop(),
		filename1 = './' + tempimages + '/frame1.' + doc.url1.split('.').pop(),
		file0 = fs.createWriteStream(filename0),
		file1 = fs.createWriteStream(filename1);

	console.log('>>>> downloading', doc.url0);
	exec('mkdir ' + tempimages, function(err, stdout, stderr) {
		console.log('>>>> made directory', tempimages);
		request(doc.url0).pipe(file0);
		file0.on('finish', function(){
			console.log('>>>> downloading', doc.url1);
			request(doc.url1).pipe(file1);
			file1.on('finish', function() {
				console.log('>>>> downloaded images!');
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
		input = 'processing/frames/' + fileroot + '/frame*.jpg',
		output = 'processing/frames/' + fileroot + '/flip_%03d.jpg',
		cmd = "convert {input} -adaptive-resize {size} -quality 90% {output}",
		cmd_exec = cmd.replace("{folder}", 'processing/frames/' + fileroot)
						.replace("{input}", input)
						.replace("{output}", output)
						.replace("{size}", "'" + size + "'");

	console.log('>>>> exporting', fileroot);
	exec(cmd_exec, function(err, stdout, stderr) {
		var zip = "cd {folder}; zip {output} {input}",
			zip_exec = zip.replace("{folder}", 'processing/frames/' + fileroot)
							.replace("{output}", getFilename(doc, 'zip'))
							.replace("{input}", "flip*.jpg");

		console.log('>>>> zipping', fileroot);
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

	console.log('>>>> downloading', doc.url);
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

	var tempimages = './processing/images/',
		tempchoppt = './processing/choppt/',
		filename = tempimages + getFilename(doc, 'gif');

	// in case we want to change the frames in the admin, we don't assume ranges here
    var frames = doc.frames.split(','),
    	selection = '';

    frames.forEach(function(frame) {
    	selection += "'#" + frame + "' ";
    });

    var output = tempchoppt + getFilename(doc, 'gif'),
    	// cmd = "gifsicle -U {input} {frames} -o {output}",
    	cmd = "convert -coalesce '{input}[{frames}]' -coalesce {output}";

    var cmd_exec = cmd.replace("{input}", filename)
    					.replace("{frames}", doc.frames)
    					.replace("{output}", output);

    console.log('>>>> chopping', doc._id, selection);
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

	var tempchoppt = './processing/choppt/',
		tempframes = './processing/frames/',
		fileroot = doc.order_id + '_' + doc._id,
		filename = tempchoppt + getFilename(doc, 'gif'),
		size = getSize(doc.size);

	console.log('>>>> found size', doc.size, size);

	var output = tempframes + fileroot + '/%03d.jpg',
		cmd = "mkdir {folder}; convert {input} -coalesce -adaptive-resize {size} -quality 90% {output}",
		cmd_exec = cmd.replace("{folder}", 'processing/frames/' + fileroot)
						.replace("{input}", filename)
						.replace("{output}", output)
						.replace("{size}", "'" + size + "'");

	console.log('>>>> exporting', fileroot);
	exec(cmd_exec, function(err, stdout, stderr) {
		var zip = "cd {folder}; zip {output} {input}",
			zip_exec = zip.replace("{folder}", 'processing/frames/' + fileroot)
							.replace("{output}", getFilename(doc, 'zip'))
							.replace("{input}", "*.jpg");

		console.log('>>>> zipping', fileroot);
		exec(zip_exec, function(err, stdout, stderr) {
			deferred.resolve(doc);
		});
	});
	return deferred.promise;
};

var uploadZip = function(doc) {
	var deferred = Q.defer();

	var tempzipped = './processing/frames/' + doc.order_id + '_' + doc._id + '/',
		filename = tempzipped + getFilename(doc, 'zip'),
		destination = getCurrentUploadFolder() + getFilename(doc, 'zip');

	doc.zip_url = 'http://' + config.S3Bucket + '/' + destination;
	console.log('>>>> uploading to s3', doc.zip_url);

	s3.putFile(filename, destination, function(err, response) {
	    if (!err) {
	    	console.log('>>>> uploaded successfully!');
	    	deferred.resolve(doc);
	    }
	    else {
		    console.log(err);
	    }
	});

	return deferred.promise;
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
	switch (size) {
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
			return "CAQ01A0A";
		case 'Artist Print':
			return "AAT01A00"

		case 'Small Square':
			return "CAP01A0A";

		default:
			console.log("unable to find", size);
			return "unknown";
	}
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
		shippingName: 		shipping.name,
		shippingAddress1: 	shipping.address1,
		shippingAddress2: 	shipping.address2,
		shippingCity: 		shipping.city,
		shippingState: 		shipping.province,
		shippingPostalCode: shipping.zip,
		shippingCountry:  	shipping.country_code,
		shippingPhone: 		shipping.phone
	};

	console.log(full_order);

	// request({
	// 	method: 'GET',
	// 	uri: config.REQUESTENDPOINT,
	// 	json: full_order
 //    }, function(err, res, body) {
	// 	console.log(err, body);
	// });
};

var order_id = null;
process.argv.forEach(function (val, index, array) {
	if (index == 2 && val != null) {
		order_id = 'order-' + val;
	}
});

getOrderGifs(order_id)
	.then(makeFullOrderRequest);