var fs = require('fs')
  , config = JSON.parse(fs.readFileSync('./settings.json'))
  , http = require('http')
  , https = require('https')
  , nano = require('nano')(config.DATABASE)
  , db_orders = nano.db.use('gifpop-orders')
  , Q = require('q');

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
		case 'Postcard 2+':
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
			return "AAT01A003"

		case 'Small Square':
			return "CAP01A0A3";

		default:
			console.log("unable to find", size);
			return "unknown";
	}
};

var getOrderGifsFromShopify = function(page) {
	var full_order = '';

	https.get(config.ORDERS + '?page=' + page, function(res) {

	  res.on('data', function(d) {
	    full_order += d;
	  });

	  res.on('end', function(d) {
	  		var orders = JSON.parse(full_order).orders;

			orders.forEach(saveOrderToCouch);
	  });
	}).on('error', function(e) {
	  console.error(e);
	});
};

var saveOrderToCouch = function(order) {
	var order_id = "order-" + order.name.split('#').pop();
	db_orders.insert(order, order_id, function(error, response) {
		if (error) {

			// If Couch returns 'Document update conflict.' that means
			// we already have the record in the db, and don't overwrite it.
			// We want to log other errors that come up incase of weirdness.
			if (error.reason != 'Document update conflict.') {
				console.log(order_id, ":", error.reason);
			}
		} else {

			// Log the order_id that we've saved from Shopify to Couch
			console.log(order_id, ": saved!");
		}
	});
};

process.argv.forEach(function (val, index, array) {
	if (index == 2 && val !== null) {
		console.log("loading shopify orders page", val);
		getOrderGifsFromShopify(val);
	}
	if (index == 0) {
		console.log("no page specified, loading first page of orders");
		getOrderGifsFromShopify(1);
	}
});