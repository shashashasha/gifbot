
/**
 * Module dependencies.
 */

var express = require('express')
  , engine = require('ejs-locals')
  , gm = require('gm')
  , fs = require('fs')
  , http = require('http')
  , path = require('path')
  , util = require('util')
  , crypto = require('crypto')
  , exec = require('child_process').exec
  , couchdb = require('felix-couchdb')
  , client = couchdb.createClient(13893, 'localhost') // may need to change this for webfaction
  // , client = couchdb.createClient(null, 'db.gifpop.io') // may need to change this for webfaction
  , db = client.db('gifpop')
  , tempfiles = require("tempfiles"); // https://github.com/andris9/tempfiles

var app = express()
  , config = JSON.parse(fs.readFileSync('./settings.json'));

// use ejs-locals for all ejs templates:
app.engine('ejs', engine);

app.configure(function() {
  app.set('port', config.PORT || 3000); // 28171 on webfaction

  // view templates
  app.set('views', __dirname + '/views');
  app.set('view engine', 'ejs');

  // app.use(express.favicon());
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
  res.render('index', { what: 'bestest :)', title: 'me' });
});

var uploadForm = function(res, form, img_uri, doc_id) {
  var cur = new Date()
    , folder = [cur.getFullYear(), cur.getMonth() + 1, cur.getDate()].join('-');

  var formOptions = {
    title: '',
    base_url: config.HOST,
    aws_signature: config.AWSSignature,
    aws_accesskeyid: config.AWSAccessKeyId,
    aws_policy: config.AWSPolicy,
    scan_id: folder,
    file_prefix: cur.getTime()
  };

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
    , base = 'http://gifpop-uploads.s3.amazonaws.com/{key}'
    , url0 = base.replace('{key}', key0);

  uploadForm(res, 'form-flipflop2', key0, docId0);
});

app.get('/gifchop', function(req, res) {
  var docId = req.query["id"]
    , key = decodeURIComponent(req.query["key"])
    , base = 'http://gifpop-uploads.s3.amazonaws.com/{key}'
    , url = base.replace('{key}', key);

  // save the uploaded gif information
  db.saveDoc(docId, {
    url: url,
    date: JSON.stringify(new Date()),
    type: 'gif',
    status: 'uploaded'
  }, function(er, ok) {
    if (er) {
      util.puts(er);
    }

    util.p(ok);

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
    , base = 'http://gifpop-uploads.s3.amazonaws.com/{key}'
    , url0 = base.replace('{key}', encodeURIComponent(key0))
    , url1 = base.replace('{key}', encodeURIComponent(key1));

  saveAndRender(docid, details, template, templatevars);

  // save the uploaded gif information
  db.saveDoc(docId0, {
    url0: url0,
    url1: url1,
    date: JSON.stringify(new Date()),
    type: 'flip',
    status: 'uploaded'
  }, function(er, ok) {
    if (er) {
      util.puts(er);
    }

    util.p(ok);

    // render the uploaded page if we've saved the gif info to the db
    res.render('flipflop', {
      title: 'GifPOP',
      doc_id: docId0,
      image_url0: url0,
      image_url1: url1
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

  console.log('selecting', docId);
  console.log('frames:', frames);
  db.getDoc(docId, function(err, doc) {
    if (err) console.log(err);

    // update the doc with the current revision id
    db.saveDoc(docId, {
      _rev: doc._rev,
      url: doc.url,
      date: JSON.stringify(new Date()),
      type: 'gif',
      status: 'selected',
      frames: frames,
      zip: doc.url.replace('.gif', '.zip')
    }, function(er, ok) {

    });
  });
});

app.post('/ordered', function(req, res) {
  console.log(req.body);
  // also keep track of orders in couch
  // not sure if this is smart or dumb
  db.saveDoc('order-' + new Date().getTime(), req.body, function(er, ok) {
    console.log(er, ok);
  });
});

/*
  given a doc id, grab the document,
  load the url of the image/gif,
  and send it to the processor
*/
var imageHandler = {};

// write temp gif and run command
imageHandler.gifsicle = function(id, cmd) {
  var output = id + '-' + mode + '.gif',
    tempFolder = './public/images/temporary/',
    temp = tempFolder + id + '.gif';

  // write the gif to a temp file, then resize it to a smaller gif
  fs.writeFile(temp, imagedata, 'binary', function(err) {
    if (err) throw err;

    exec("gifsicle " + temp + " " + cmd + " -o " + output, function(err) {
      if (err) throw err;

      imageHandler.returnImage(res, output);
    });
  });
};

imageHandler.returnImage = function(res, path) {
  var img = fs.readFileSync(path);
  res.writeHead(200, {'Content-Type': 'image/gif' });
  res.end(img, 'binary');
};

imageHandler.processImage = function(id, url, processor) {
  console.log('processing image', id);
  db.getDoc(id, function(err, doc) {
    console.log(err)
    if (err) return;

    http.get(doc[url], function(response) {
      var imagedata = '';

      response.setEncoding('binary');

      response.on('data', function(chunk) {
        imagedata += chunk;
        console.log(imagedata.length);
      });

      response.on('end', function() {
        if (processor)
          processor(doc, imagedata);
        else
          console.log('no image processor defined');
      });
    });
  });
};

app.post('/upload-url/', function(req, res) {

});

app.get('/flipflop/:doc/:image/preview.jpg', function(req, res) {
  console.log(req.params.doc);
  var docId = req.params.doc,
    image = 'url' + req.params.image, // images are saved as "url0" or "url1"
    tempFolder = './public/images/temporary/';

    imageHandler.processImage(docId, image, function(doc, imagedata) {
      var temp = tempFolder + docId + '-' + image + '.jpg',
        finalOutput = tempFolder + docId + '-' + image + '-thumbnail.jpg';

      console.log('writing to temp file ', temp);

      // write the image to a temp file, then resize it to a smaller image
      fs.writeFile(temp, imagedata, 'binary', function(err) {
        if (err) throw err;

        // graphicsmagick-node library
        gm(temp)
          .resize(120)
          .write(finalOutput, function (err) {
            if (!err) console.log('done');

            imageHandler.returnImage(res, finalOutput);
          });
      });
    });
});

app.get('/gifchop/:doc/preview.gif', function(req, res) {
  console.log(req.params.doc);
  var docId = req.params.doc,
    filename = req.params.doc + '-preview.gif',
    tempFolder = './public/images/temporary/';

  imageHandler.processImage(docId, 'url', function(doc, imagedata) {
    var temp = tempFolder + filename;
    console.log('writing to temp file ', temp);

    // write the gif to a temp file, then resize it to a smaller gif
    fs.writeFile(temp, imagedata, 'binary', function(err) {
      if (err) throw err;

      var output = tempFolder + docId + "-preview.gif";
      console.log('resizing to ', output);

      exec("gifsicle " + temp + " --resize-width 120 -o " + output, function(err, stdout, stderr) {
        if (err) throw err;

        var selection = doc.frames.split(','),
            start = +selection[0],
            end = +selection[selection.length-1],
            frames = "'#" + start + "-" + end + "'";

        var finalOutput = tempFolder + [docId, "frames", start, end].join('-') + ".gif";
        console.log('chopping frames', finalOutput);

        exec("gifsicle -U " + output + " " + frames + " -o " + finalOutput, function(err, stdout, stderr) {
          if (err) throw err;

          imageHandler.returnImage(res, finalOutput);
        });

      });
    });
  });
});

app.get('/gifchop/:doc/:start/:end', function(req, res) {
  console.log(req.params.doc);
  var start = req.params.start,
    end = req.params.end,
    id = req.params.doc,
    tempFolder = './public/images/temporary/';

  imageHandler.processImage(id, 'url', function(doc, imagedata) {
    var temp = tempFolder + id + '.gif';
    console.log('writing to temp file ', temp);

    // write the gif to a temp file, then resize it to a smaller gif
    fs.writeFile(temp, imagedata, 'binary', function(err) {
      if (err) throw err;

      var output = tempFolder + [id, "frames", start, end].join('-') + ".gif";
      var frames = "'#" + start + "-" + end + "'";
      console.log('writing frames ', frames);

      exec("gifsicle -U " + temp + " " + frames + " -o " + output, function(err, stdout, stderr) {
        if (err) throw err;

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
tempfiles.cleanPeriodically("./public/images/temporary", 600, function(err, timer){
    if(!err)
        console.log("Cleaning periodically directory /public/images/temporary");
});