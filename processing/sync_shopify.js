var fs = require('fs')
  , config = JSON.parse(fs.readFileSync('./settings.json'))
  , http = require('http')
  , https = require('https')
  , nano = require('nano')(config.DATABASE)
  , db_orders = nano.db.use('gifpop-orders')
  , Q = require('q')
  , gifpop_utils = require('./process_utils');

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