/*

  OMG IT'S GIFBOT!

 */

// using express with ejs for templating
var express = require('express')
  , engine = require('ejs-locals')

  // grabbing urls and elements
  , http = require('http')
  , request = require('request')
  , cheerio = require('cheerio')

  // logging
  , util = require('util')

  // processing imagery
  , gm = require('gm')
  , fs = require('fs')
  , path = require('path')
  , exec = require('child_process').exec

  // cleaning up temp files
  , tempfiles = require("tempfiles")

  // database and storage information
  , config = JSON.parse(fs.readFileSync('./settings.json'))
  , nano = require('nano')(config.DATABASE)
  , db = nano.db.use('gifpop-uploads')
  , db_orders = nano.db.use('gifpop-orders')

  // s3 upload
  , knox = require('knox')
  , s3 = knox.createClient({
      key: config.AWSCDNAccessKey,
      secret: config.AWSCDNSecret,
      bucket: config.S3Bucket
  });

var app = express();

// use ejs-locals for all ejs templates:
app.engine('ejs', engine);

app.configure(function() {
  app.set('port', config.PORT || 3000); // 28171 on webfaction

  // view templates
  app.set('views', __dirname + '/views');
  app.set('view engine', 'ejs');

  // Add headers
  app.use(function (req, res, next) {

      // Website you wish to allow to connect
      res.setHeader('Access-Control-Allow-Origin', 'http://cdn.gifpop.io');

      // Request methods you wish to allow
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT');

      // Request headers you wish to allow
      res.setHeader('Access-Control-Allow-Headers', 'X-Requested-With,content-type');

      // Set to true if you need the website to include cookies in the requests sent
      // to the API (e.g. in case you use sessions)
      res.setHeader('Access-Control-Allow-Credentials', true);

      // Pass to next layer of middleware
      next();
  });

  app.use(express.logger('dev'));
  app.use(express.bodyParser());
  app.use(express.methodOverride());
  app.use(app.router);


  // static assets
  app.use(express.static(path.join(__dirname, 'public')));
});


app.configure('development', function(){
  app.use(express.errorHandler());
});

// index page
app.get('/', function(req, res) {
  res.render('index');
});

app.get('/process-url/', function(req, res) {
  // var url = req.body.url; // used for POSTing
  var url = req.query['url'].replace('https', 'http'),
      uploadFolder = uploader.getCurrentUploadFolder(),
      domain = url.split('http://').join('').split('/')[0];

  console.log('PROCESS URL:', url, uploadFolder, domain);

  // prefix with http just in case it doesn't have it
  if (url.search('http') < 0) {
    url = 'http://' + url;
  }

  if (url.match(/(.gif|.GIF)$/)) {
    imageHandler.saveImage(url, function(tempURL) {
      uploader.saveAndGifChop(tempURL, 'urlgif', res);
    });
  } else {
    switch (domain) {
      case 'i.imgur.com':
      case 'imgur.com':
        imageHandler.saveImage(url + '.gif', function(tempURL) {
          uploader.saveAndGifChop(tempURL, 'imgur', res);
        });
        break;
      case 'giphy.com':

        var giphyResource = url.split('gifs/').pop(),
            giphyBase = 'http://media.giphy.com/media/{id}/giphy.gif',
            giphyURL = giphyBase.replace('{id}', giphyResource);

        imageHandler.saveImage(giphyURL, function(tempURL, imageData) {
          uploader.saveAndGifChop(tempURL, 'giphy', res);
        });
        break;
      case 'vine.co':
        request(url, function(err, response, body) {
          var $ = cheerio.load(body),
              source = $('source');

          if (!source.length) {
            console.log('ERROR: no source tags?');
            res.json({ success: "false", error  : "no-image-type" });
            return;
          }

          // video tag
          var videoURL = source[0].attribs.src;
          if (videoURL.charAt(0) == '/') {
            videoURL = 'http:' + videoURL;
          }

          imageHandler.processVideo(videoURL, function(tempURL) {
            uploader.saveAndGifChop(tempURL, 'vine', res);
          });
        });
        break;
      case 'instagram.com':
        request(url, function(err, response, body) {
          // grab meta tags
          var $ = cheerio.load(body),
              meta = $('meta'),
              keys = Object.keys(meta);

          // find the opengraph video tag
          var videoURL;
          keys.forEach(function(key){
            if (  meta[key].attribs
               && meta[key].attribs.property
               && meta[key].attribs.property === 'og:video') {
              videoURL = meta[key].attribs.content;
            }
          });

          imageHandler.processVideo(videoURL, function(tempURL) {
            uploader.saveAndGifChop(tempURL, 'instagram', res);
          });
        });
        break;
      default:
        console.log('ERROR: image type not found, sorry!');
        res.json({
          success: "false",
          error  : "no-image-type"
        });
        break;
    }
  }
});

var uploadForm = function(res, form, img_uri, doc_id) {
  var formOptions = {
    title: '',
    base_url: config.HOST,
    aws_signature: config.AWSSignature,
    aws_accesskeyid: config.AWSAccessKeyId,
    aws_policy: config.AWSPolicy,
    scan_id: uploader.getCurrentUploadFolder(),
    file_prefix: new Date().getTime()
  };

  /*
    these two options are for the second flip flop form to
    be able to show the right image
  */
  if (img_uri) {
    formOptions.key = img_uri;
  }
  if (doc_id) {
    formOptions.doc_id = doc_id;
  }

  res.render(form, formOptions);
};

app.get('/upload-gifchop', function(req, res) {
  uploadForm(res, 'form-gifchop');
});

/*
  This is a bit of a weird way of doing things,
  but right now we have two flip flop form templates
  one for the first image, one for the second
*/
app.get('/upload-flipflop', function(req, res) {
  uploadForm(res, 'form-flipflop1');
});
app.get('/upload-flipflop2', function(req, res) {
  var docId0 = req.query["id0"]
    , key0 = decodeURIComponent(req.query["key0"])
    , base = 'http://cdn.gifpop.io/{key}'
    , url0 = base.replace('{key}', key0);

  uploadForm(res, 'form-flipflop2', key0, docId0);
});

app.get('/gifchop', function(req, res) {
  var docId = req.query["id"]
    , source = req.query["source"]
    , key = decodeURIComponent(req.query["key"])
    , base = 'http://cdn.gifpop.io/{key}'
    , url = base.replace('{key}', key);


  // save the uploaded gif information
  var doc = {
    url: url,
    date: JSON.stringify(new Date()),
    type: 'gif',
    status: 'uploaded',
    source: source ? source : 'user'
  };

  db.insert(doc, docId, function(err, body) {
    if (err) {
      console.log('GIFCHOP:', err);
      util.puts(err);
    }

    console.log("GIFCHOP: docid", docId, util.inspect(docId));

    // render the uploaded page if we've saved the gif info to the db
    res.render('gifchop', {
      title: 'GifPOP',
      image_url: url,
      doc_id: docId
    });
  });
});

/*
  this is the actual page where we show the flipflop
  (basically we're just showing a preview, no editing has to be done)
*/
app.get('/flipflop', function(req, res) {
  var docId0 = req.query["id0"]
    , key0 = decodeURIComponent(req.query["key0"])
    , docId1 = req.query["id1"]
    , key1 = decodeURIComponent(req.query["key1"])
    , base = 'http://cdn.gifpop.io/{key}'
    , url0 = base.replace('{key}', key0)
    , url1 = base.replace('{key}', key1);

  // saveAndRender(docId0, details, template, templatevars);

  // save the uploaded gif information
  var doc = {
    url0: url0,
    url1: url1,
    date: JSON.stringify(new Date()),
    type: 'flip',
    status: 'uploaded',
    source: 'user'
  };

  db.insert(doc, docId0, function(err, body) {
    if (err) {
      util.puts(err);
    }
    console.log("FLIPFLOP: uploaded ", url0, url1);
    console.log("FLIPFLOP: doc_id ", docId0);

    // render the uploaded page if we've saved the gif info to the db
    res.render('flipflop', {
      title: 'GifPop',
      doc_id: docId0,
      image_url0: url0,
      image_url1: url1
    });
  });
});

app.post('/flipflop', function(req, res) {
  var docId0 = req.body.id0
    , key0 = decodeURIComponent(req.body.key0)
    , key1 = decodeURIComponent(req.body.key1)
    , base = 'http://cdn.gifpop.io/{key}'
    , url0 = base.replace('{key}', key0)
    , url1 = base.replace('{key}', key1);

  db.get(docId0, function(err, doc) {
    if (err) console.log('FLIPFLOP:', err);

    doc = doc || {};
    doc.url0 = url0;
    doc.url1 = url1,
    doc.date = JSON.stringify(new Date());
    doc.type = 'flip';
    doc.status = 'uploaded';
    doc.source = 'user';

    db.insert(doc, docId0, function(err, body) {
      if (err) {
        util.puts(err);
      }

      console.log("FLIPFLOP: uploaded ", url0, url1);
      console.log("FLIPFLOP: doc_id ", docId0);

      res.setHeader("Access-Control-Allow-Origin", "http://cdn.gifpop.io");
      res.jsonp({
        success: 'true',
        doc_id: docId0,
        image_url0: url0,
        image_url1: url1
      });
    });
  });
});

/*
  save frame selection to couch, need to get the latest rev number to update it though
*/
app.post('/selected', function(req, res) {
  // frames are grabbed via gifchop.js
  var docId = req.body.id
    , frames = req.body.frames;

  console.log('SELECTED: selecting', docId, 'frames:', frames);

  db.get(docId, function(err, doc) {
    if (err) console.log('SELECTED:', err);

    doc = doc || {};

    doc.type = 'gif';
    doc.status = 'selected';
    doc.date = JSON.stringify(new Date());
    doc.frames = frames;

    db.insert(doc, docId, function (err, body) {
      if(!err) {
        console.log("SELECTED: it worked!!!!");
        res.setHeader("Access-Control-Allow-Origin", "http://cdn.gifpop.io");
        res.jsonp({ success: "true" });
      } else {
        console.log("SELECTED: sadfaces");
      }
    });
  });
});

app.post('/ordered', function(req, res) {
  // also keep track of orders in couch
  // not sure if this is smart or dumb
  var orderDoc = 'order-' + req.body.order_number;
  console.log("ORDERED: saving as", orderDoc);

  // here we're copying information from shopify orders
  // into gifpop-uploads documents
  var updateDocWithOrder = function(docId, orderId, itemId, quantity, title) {
    db.get(docId, function(err, body) {
      if (err) {
        console.log('ORDERED:', err);
        return;
      }

      body.status = 'ordered';
      body.order_doc_id = orderId;
      body.item_id = itemId;
      body.quantity = quantity;
      body.product = title;

      db.insert(body, docId, function (err, body) {
        if(!err) {
          console.log("ORDERED:  updated order for docid", docId, orderId, itemId, quantity, title);
          res.json({ success: true });
        } else {
          console.log("ORDERED: sadfaces");
        }
      });
    });
  };

  // given a shopify order object, update our gifpop-uploads docs
  var updateDocs = function(body) {
    var items = body.line_items,
      orderId = 'order-' + req.body.order_number;

    for (var i = 0; i < items.length; i++) {
      var item = items[i];

      if (item.properties.length == 0) {
        console.log("ORDERED: no doc-id found!");
        continue;
      }

      var docId = item.properties[0].value;
      console.log("ORDERED: updating order for docid", docId, orderId, item.id, item.quantity, item.title);
      updateDocWithOrder(docId, orderId, item.id, item.quantity, item.title);
    }
  };

  db_orders.head(orderDoc, function(err, _, headers) {
    if (headers && headers['status-code'] == 200) {
      console.log('ORDERED: order exists, no need to update!');
      // update docs anyway for now for any old requests we haven't caught
      updateDocs(req.body);
    } else {
      // if it doesn't exist, add it
      db_orders.insert(req.body, orderDoc, function (err, body) {
        if (err) {
          console.log('ORDERED: error inserting!', err);
          return;
        }

        updateDocs(req.body);
      });
    }
  });
});

/*
  uploader pushes files to s3 and then sends them to gifchop
*/
var uploader = {};
uploader.getCurrentUploadFolder = function() {
  var d = new Date(),
      date = ("0" + d.getDate()).slice(-2),
      month = ("0" + (d.getMonth() + 1)).slice(-2);

    return 'uploads/' + [d.getFullYear(), month, date].join('-') + '/';
};

uploader.saveAndGifChop = function(filepath, type, res) {
  var filename = type + '_' + filepath.split('/').pop(),
    destination = uploader.getCurrentUploadFolder() + filename,
    headers = { 'x-amz-acl': 'public-read' };

  console.log('SAVEANDGIFCHOP: putting file to s3', destination);
  s3.putFile(filepath, destination, function(err, response){
    if (err) {
      console.log('SAVEANDGIFCHOP:', err);
      res.json({
        success: "false",
        error  : "error-uploading"
      });
      return;
    }

    console.log('SAVEANDGIFCHOP: SUCCESS!', filename.split('.')[0].toString());
    response.resume();

    res.jsonp({
      success: "true",
      id: filename.split('.')[0].toString(),
      key: destination,
      source: type
    });
  });
};

/*
  given a doc id, grab the document,
  load the url of the image/gif,
  and send it to the processor
*/
var imageHandler = {};

// write temp gif and run command
imageHandler.gifsicle = function(id, cmd) {
  var output = id + '-' + mode + '.gif',
    temp = config.TEMP + id + '.gif';

  // write the gif to a temp file, then resize it to a smaller gif
  fs.writeFile(temp, imagedata, 'binary', function(err) {
    if (err) {
      console.log(err);
      return;
    }

    exec("gifsicle " + temp + " " + cmd + " -o " + output, function(err) {
      if (err) {
        console.log(err);
        return;
      }

      imageHandler.returnImage(res, output);
    });
  });
};

imageHandler.returnImage = function(res, path) {
  console.log(path);
  var img = fs.readFileSync(path);
  res.writeHead(200, {'Content-Type': 'image/gif' });
  res.end(img, 'binary');
};

imageHandler.processVideo = function(url, callback) {
  imageHandler.saveImage(url, function(tempURL) {
    var output = config.TEMP + new Date().getTime() + '_frames';

    // exec("ffmpeg -i %s -r 6 -vf scale=240:-1 %s" % (mp4_path, jpg_out)
    // exec("ffmpeg -i " + tempURL + " -t 10 " + output + "%02d.gif");

    exec("ffmpeg -i " + tempURL + " -r 10 -vf scale=640:-1 " + output + "%03d.gif", function(err, stdout, stderr) {
      if (err) {
        console.log(err);
        return;
      }

      var finaloutput = config.TEMP + new Date().getTime() + '_anim.gif';
      exec("gifsicle --delay=10 --loop " + output + "*.gif" + " > " + finaloutput, function(err, stdout, stderr) {
        if (err) {
          console.log(err);
          return;
        }
        if (callback) {
          callback(finaloutput);
        }
      });
    });

  });
};

imageHandler.processImage = function(id, url, processor) {
  db.get(id, function(err, doc) {
    if (err) return;

    http.get(doc[url], function(response) {
      var imagedata = '';

      response.setEncoding('binary');

      response.on('data', function(chunk) {
        imagedata += chunk;
      });

      response.on('end', function() {
        if (processor) {
          processor(doc, imagedata);
        }
        else
          console.log('no image processor defined');
      });
    });
  });
};

imageHandler.saveImage = function(url, callback) {
  var suffix = url.split('?')[0].split('.').pop(),
      fileRoot = url.split('/').pop().split('.')[0],
      tempFilename = config.TEMP + new Date().getTime() + '.' + suffix;
  console.log('SAVEIMAGE: downloading', url);

  // request(url).pipe(file);

  http.get(url, function(response) {
    console.log("SAVEIMAGE: Got response: " + response.statusCode);
    var imagedata = '';

    response.setEncoding('binary');

    response.on('data', function(chunk) {
      imagedata += chunk;
    });

    response.on('end', function() {
      fs.writeFile(tempFilename, imagedata, 'binary', function(err) {
        if (err) {
          console.log(err);
          return;
        }

        callback(tempFilename, null);
      });
    });
  }).on('error', function(e) {
    console.log("SAVEIMAGE: Got error: " + e.message);
  });
};

app.get('/flipflop/:doc/:image/preview.jpg', function(req, res) {
  var docId = req.params.doc,
    image = 'url' + req.params.image, // images are saved as "url0" or "url1"
    tempFolder = config.TEMP;

    imageHandler.processImage(docId, image, function(doc, imagedata) {
      var temp = tempFolder + docId + '-flipflop.jpg',
        finalOutput = tempFolder + docId + '-thumbnail.jpg';

      // write the image to a temp file, then resize it to a smaller image
      fs.writeFile(temp, imagedata, 'binary', function(err) {
        if (err) {
          console.log(err);
          return;
        }

        // graphicsmagick-node library
        gm(temp).resize(120)
          .write(finalOutput, function (err) {
            if (err) console.log('error processing:', err);
            imageHandler.returnImage(res, finalOutput);
          });
      });
    });
});

app.get('/flipflop/:doc/preview.gif', function(req, res) {
  console.log('PREVIEW FLIPFLOP:', req.params.doc);
  var docId = req.params.doc,
      tempFile = config.TEMP + 'flipflop-' + new Date().getTime() + docId + '-url',
      tempFilename0 = config.TEMP + 'flipflop-' + new Date().getTime() + docId + '-url0.jpg',
      tempFilename1 = config.TEMP + 'flipflop-' + new Date().getTime() + docId + '-url1.jpg',
      outputFilename = config.TEMP + 'flipflop-' + new Date().getTime() + docId + '-preview.gif',
      file0 = fs.createWriteStream(tempFilename0),
      file1 = fs.createWriteStream(tempFilename1);

  db.get(docId, function(err, doc) {
    if (err) {
      console.log(err);
      return;
    }

    request(doc.url0).pipe(file0);
    file0.on('finish', function(err){
      if (err) {
        console.log(err);
        return;
      }

      request(doc.url1).pipe(file1);
      file1.on('finish', function(err) {
        if (err) {
          console.log(err);
          return;
        }

        exec("convert   -delay 100   -loop 0   -geometry x76 " + tempFile + "*.jpg" + " " + outputFilename, function(err, stdout, stderr) {
          if (err) {
            console.log(err);
            return;
          }

          imageHandler.returnImage(res, outputFilename);
        });
      });
    });
  });
});

app.get('/gifchop/:doc/preview.gif', function(req, res) {
  console.log('PREVIEW GIFCHOP:', req.params.doc);
  var docId = req.params.doc,
    filename = req.params.doc + '-preview.gif',
    tempFolder = config.TEMP;

  imageHandler.processImage(docId, 'url', function(doc, imagedata) {
    var temp = tempFolder + filename;

    // write the gif to a temp file, then resize it to a smaller gif
    fs.writeFile(temp, imagedata, 'binary', function(err) {
      if (err) {
        console.log(err);
        return;
      }

      var selection = doc.frames.split(','),
          start = +selection[0],
          end = +selection[selection.length-1],
          frames = "'#" + start + "-" + end + "'";

      var finalOutput = tempFolder + [docId, "frames", start, end].join('-') + ".gif";

      // d10 is 100ms delay, -l0 is loop infinitely
      exec("gifsicle -U " + temp + " --resize-width 120 -d10 -l0 " + frames + "  -o " + finalOutput, function(err, stdout, stderr) {
        if (err) {
          console.log(err);
          return;
        }

        imageHandler.returnImage(res, finalOutput);
      });
    });
  });
});

app.get('/gifchop/:doc/:start/:end', function(req, res) {
  console.log('CHOPPING GIF:', req.params.doc);
  var start = req.params.start,
    end = req.params.end,
    id = req.params.doc,
    tempFolder = config.TEMP;

  imageHandler.processImage(id, 'url', function(doc, imagedata) {
    var temp = tempFolder + id + '.gif';

    // write the gif to a temp file, then resize it to a smaller gif
    fs.writeFile(temp, imagedata, 'binary', function(err) {
      if (err) {
        console.log(err);
        return;
      }

      var output = tempFolder + [id, "frames", start, end].join('-') + ".gif";
      var frames = "'#" + start + "-" + end + "'";
      console.log('CHOPPING GIF: writing frames ', frames);

      exec("gifsicle -U " + temp + " " + frames + " -o " + output, function(err, stdout, stderr) {
        if (err) {
          console.log(err);
          return;
        }

        imageHandler.returnImage(res, output);
      });
    });
  });
});

http.createServer(app).listen(app.get('port'), function(){
  console.log("Express server listening on port " + app.get('port'));
});

/*
  flush the temporary images folder every 10 minutes
*/
tempfiles.cleanPeriodically(config.TEMP, 600, function(err, timer){
    if(!err)
        console.log("Cleaning periodically directory /public/images/temporary");
});