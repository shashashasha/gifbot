// process_utils.js
// helper functions for interacting with orders

// Given a card size, return the pixel size
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
      // return "4860x3060^"; // 1440 dpi
      return "1012x637^";
    case 'Postcard':
    case 'Landscape Postcard':
      // return "7200x5040^"; // 1440 dpi
      return "1500x1050^";

    case 'Portrait Postcard':
      // return "5040x7200^"; // 1440 dpi
      return "1050x1500^";

    case 'Artist Print':
    case 'Artist Large':
      return "3000x3000^";

    case 'Large Square':
      // return "3000x3000^"; // 600 dpi
      // return "7200x7200^"; // 1440 dpi
      return "1500x1500^";

    case 'Small Square':
      // return "3960x3960^"; // 1440 dpi
      return "825x825^";

    default:
      console.log("unable to find", size);
      // return "825x825^";
      return "700x700^";
  }
};

var getArtistSize = function(variant) {
  switch (variant) {
    case 'Large Square':
    case '5x5\"':
      return 'Large Square';

    case 'Small Square':
    case '3&#189; x 3&#189;\"':
      return 'Artist Small';

    case '10x10\"':
    case '10 x 10"':
    case '10x10"':
      return 'Artist Large';

    default:
      return 'Artist Large';
  }
};

// Manufacturer's product codes
// 2.75 Instagram Motion Print  CAP01A0A
// 3.5 Instagram Motion Print CAQ01A0A
// Large Motion Print     AA20110A
// Wallet Motion Print      AA10110A
// 5” x 5”            AAS01A00
// 10” x 10”          AAT01A00
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
    case '5x5\"':
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

    case 'Small Sticker':
      return "STKQ00";

    default:
      console.log("unable to find", size);
      return "unknown";
  }
};


// Manufacturer's shipping codes
var getShippingMethod = function(order) {
  var method = 'standard';

  if (order.shipping_lines && order.shipping_lines[0] && order.shipping_lines[0].code) {
    var code = order.shipping_lines[0].code;
    switch (code.toLowerCase()) {
      case '2day':
      case '2 day':
      case 'fedex 2-day':
      case 'fedex 2 day':
      case 'fedex 2-day international':
      case "fedex international shipping, 2-3 days":
        return '2day';
      case 'priority':
      case 'usps priority':
      case 'usps priority — with tracking number':
        return 'priority';
      case 'overnight':
        return 'overnight';
    }
  }

  return method;
};

module.exports = {
  getSize: getSize,
  getProductId: getProductId,
  getArtistSize: getArtistSize,
  getShippingMethod: getShippingMethod
};