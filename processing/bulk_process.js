var gm = require('gm')
  , fs = require('fs')
  , config = JSON.parse(fs.readFileSync('./settings.json'))

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

var getPad = function(num, numZeros) {
  var n = Math.abs(num);
  var zeros = Math.max(0, numZeros - Math.floor(n).toString().length );
  var zeroString = Math.pow(10,zeros).toString().substr(1);
  if( num < 0 ) {
    zeroString = '-' + zeroString;
  }

  return zeroString+n;
};

var getUploadId = function(jobname, folder) {
  var d = new Date(),
      date = FORCE_DATE || ("0" + d.getDate()).slice(-2),
      month = FORCE_MONTH || ("0" + (d.getMonth() + 1)).slice(-2);

  return ['bulk', d.getFullYear(), month, date, jobname, folder].join('_');
};

var getCurrentUploadFolder = function() {
  var d = new Date(),
      date = FORCE_DATE || ("0" + d.getDate()).slice(-2),
      month = FORCE_MONTH || ("0" + (d.getMonth() + 1)).slice(-2);

    return 'zips/' + [d.getFullYear(), month, date].join('-') + '/';
};

var makeZips = function(start, end) {
  var deferred = Q.defer();

  var cardsToProcess = [];
  for (var i = start; start < end; start++) {
    // if (i < 10) folders.push('00' + i);
    // else if (i < 100) folders.push('0' + i);
    // else  folder.push(i.toString());
    if (i < 10) cardsToProcess.push(processFolder('00' + i));
    else if (i < 100) cardsToProcess.push(processFolder('0' + i));
    else  cardsToProcess.push(processFolder(i.toString()));
  }

  Q.all(cardsToProcess)
};

var processFolder = function(job_name, folder, order_id) {
  console.log('>>>> processing folder:\t', folder);
  var deferred = Q.defer();

  var card = {};
  card.job_name = job_name;
  card.folder = folder;
  card.order_id = order_id;
  card.zip_filename = card.order_id + '_' + getUploadId(job_name, folder) + '.zip';
  card.zip_url = 'http://' + config.S3Bucket + '/' + getCurrentUploadFolder() + card.zip_filename;

  card.selection = '';
  card.frames = [];
  for (var j = 0; j < 10; j++) {
    card.selection += getPad(j, 3) + '.jpg ';
    card.frames.push(j);
  }

  deferred.resolve(card);
  return deferred.promise;
};

var zipFolder = function(card) {
  var deferred = Q.defer();
  console.log('zipping folder', card.folder);

  var zip = "cd {folder}; zip {output} {input}",
    zip_exec = zip.replace("{folder}", 'processing/' + card.job_name + '/' + card.folder)
            .replace("{output}", card.zip_filename)
            .replace("{input}", card.selection);

  console.log('>>>> zipping:\t\t', card.folder, card.selection);
  exec(zip_exec, function(err, stdout, stderr) {
    deferred.resolve(card);
  });

  return deferred.promise;
};

var uploadCard = function(card) {
  var deferred = Q.defer();

  var local_file = './processing/' + card.job_name + '/' + card.folder + '/' + card.zip_filename,
    local_image = './processing/' + card.job_name + '/' + card.folder + '/000.jpg',
    destination = getCurrentUploadFolder() + card.zip_filename,
    destination_image = getCurrentUploadFolder() + card.zip_filename.replace('.zip', '.jpg');

  card.zip_url = 'http://' + config.S3Bucket + '/' + destination;
  card.url = 'http://' + config.S3Bucket + '/' + destination_image;

  console.log('>>>> uploading to s3:\t', destination);

  if (DEBUG) {
    console.log('>>>> skipping upload because DEBUG');
    deferred.resolve(card);
  } else {
    // upload thumbnail then zip
    s3.putFile(local_image, destination_image, function(err, response) {
        if (!err) {
          console.log('>>>> uploaded!\t\t', card.order_id, 'thumbnail');
          s3.putFile(local_file, destination, function(err, response) {
              if (!err) {
                console.log('>>>> uploaded!\t\t', card.order_id, card.zip_filename);
                deferred.resolve(card);
              }
              else {
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

var saveUpload = function(card) {
  console.log('>>>> saving this card:\t', card.zip_filename);
  var deferred = Q.defer();
  var id = getUploadId(card.job_name, card.folder);
  var doc = {
    date: JSON.stringify(new Date()),
    type: 'gif',
    status: 'ordered',
    source: 'frames',
    job_name: card.job_name,
    order_id: card.order_id,
    size: 'Artist Large',
    frames: card.frames.join(','),
    url: card.url,
    zip_url: card.zip_url
  };

  var line_item = {
       "fulfillment_service": "manual",
       "fulfillment_status": null,
       "grams": 227,
       "id": 451324909,
       "price": "15.00",
       "product_id": 118058266,
       "quantity": 1,
       "requires_shipping": true,
       "sku": "",
       "taxable": false,
       "title": "GIF CHOP",
       "variant_id": 281911490,
       "variant_title": "Artist Large",
       "vendor": "shabinx",
       "name": "GIF CHOP - Artist Large",
       "variant_inventory_management": "",
       "properties": [
           {
               "name": "doc-id",
               "value": "user_1396826228908_AzkIm1PJTyOPnSsxtDLM"
           }
       ],
       "product_exists": true,
       "tax_lines": [
       ]
   };
  line_item.properties[0].value = id;

  console.log(JSON.stringify(line_item) + ',');
  fs.appendFile('processing/' + card.job_name + '.txt', JSON.stringify(line_item) + ',', function (err) { console.log(err); });

  if (DEBUG) {
    console.log(doc);
    deferred.resolve(doc);
  } else {
    db.insert(doc, id, function(err) {
      if (err) console.log(err);

      console.log('>>>> saved doc-id:\t', id);
      deferred.resolve(doc);
    });
  }

  return deferred.promise;
};


var ORDER_ID = null,
  JOB_NAME = null,
  DEBUG = false,
  PREP = false,
  ONLY_LINEID = null,
  ONLY_SELFMADE = null,
  FORCE = false,
  FORCE_MONTH = null,
  FORCE_DATE = null,
  FORCE_SUFFIX = '',
  ORDER_START = null,
  ORDER_END = null,
  ORDER_INDEX = null;
process.argv.forEach(function (val, index, array) {
  if (index == 2 && val != null) {
    if (val.split('-').length > 1) {
      ORDER_START = parseInt(val.split('-')[0]);
      ORDER_END = parseInt(val.split('-')[1]);
      ORDER_INDEX = ORDER_START;
      console.log(ORDER_START, ORDER_END);
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
  else if (val.search("job_name=") == 0) {
    JOB_NAME = val.split("job_name=")[1];
    console.log('setting job_name', JOB_NAME);
  }
  else if (val.search("order=") == 0) {
    ORDER_ID = val.split("order=")[1];
    console.log('setting order', ORDER_ID);
  }
  else if (val.search("date=") == 0) {
    FORCE_DATE = val.split("date=")[1];
    console.log('forcing date', FORCE_DATE);
  } else if (val.search("suffix=") == 0) {
    FORCE_SUFFIX = val.split("suffix=")[1];
    console.log('forcing suffix', FORCE_SUFFIX);
  }
});

var nextCard = function() {
  var deferred = Q.defer();

  if (ORDER_INDEX > ORDER_END) {
    deferred.resolve();
    console.log('finished!');
    return;
  }

  setTimeout(function() {
    processFolder(JOB_NAME, getPad(ORDER_INDEX, 3), ORDER_ID)
      .then(zipFolder)
      .then(uploadCard)
      .then(saveUpload)
      .then(nextCard);

    ORDER_INDEX++;
  }, 500);
  return deferred.promise;
};

nextCard();