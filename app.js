
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
  , couchdb = require('felix-couchdb')
  , client = couchdb.createClient(13893, 'localhost') // may need to change this for webfaction
  , db = client.db('gifpop');

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
  res.render('index', { what: 'best', title: 'me' });
});

app.get('/upload', function(req, res) {
  var cur = new Date()
    , folder = [cur.getFullYear(), cur.getMonth() + 1, cur.getDate()].join('-');

  res.render('form', { 
    title: '',
    base_url: config.HOST,
    aws_signature: config.AWSSignature, 
    aws_accesskeyid: config.AWSAccessKeyId,
    aws_policy: config.AWSPolicy,
    scan_id: folder,
    file_prefix: cur.getTime()
  });
});

app.get('/dropform', function(req, res) {
  var cur = new Date()
    , folder = [cur.getFullYear(), cur.getMonth() + 1, cur.getDate()].join('-');

  res.render('dropform', { 
    title: '',
    base_url: config.HOST,
    aws_signature: config.AWSSignature, 
    aws_accesskeyid: config.AWSAccessKeyId,
    aws_policy: config.AWSPolicy,
    scan_id: folder,
    file_prefix: cur.getTime()
  });
});


app.get('/uploaded', function(req, res) {
  var bucket = req.query["bucket"]
    , etag = req.query["etag"]
    , key = decodeURIComponent(req.query["key"])
    , base = 'http://{bucket}.s3.amazonaws.com/{key}'
    , url = base.replace('{bucket}', bucket).replace('{key}', key);

  // save the uploaded gif information
  // doc id is timestamp in milliseconds plus etag
  var docId = key.split('-').shift() + '-' + etag.substr(1, etag.length - 2);
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
    res.render('uploaded', { 
      title: 'GifPOP',
      image_url: url,
      doc_id: docId
    });
  });

});

app.post('/selected', function(req, res) {
  var docId = req.body.id
    , frames = req.body.frames;
  db.getDoc(docId, function(er, doc) {
    util.p(doc);

    db.saveDoc(docId, {
      _rev: doc._rev,
      url: doc.url,
      date: JSON.stringify(new Date()),
      type: 'gif',
      status: 'processed',
      frames: frames,
      zip: doc.url.replace('.gif', '.zip')
    }, function(er, ok) {

    });
  });
});

app.get('/split/:image', function(req, res) {
  var filename = '/' + req.params.image + '.gif';
  var options = {
      host: 'i.imgur.com'
    , port: 80
    , path: filename
  };

  var request = http.get(options, function(response){
      var imagedata = '';
      response.setEncoding('binary');

      response.on('data', function(chunk) {
          imagedata += chunk;
      });

      response.on('end', function() {
        var savedImage = './public/images/temporary' + filename;
        fs.writeFile(savedImage, imagedata, 'binary', function(err) {
          if (err) throw err;
          console.log(filename + ' saved.');

          gm('./public/images/temporary/blank.gif')
            .append(savedImage, true)
            .stream(function streamOut (err, stdout, stderr) {
                if (err) return console.log(err);
                console.log('streaming image');
                stdout.pipe(res); //pipe to response
                stdout.on('error', console.log);
            });
            // .write('./public/images/wolf_static_0.jpg', function(err, stdout, stderr) {
            //   console.log(err);
            // });
        });
      });
  });

});

http.createServer(app).listen(app.get('port'), function(){
  console.log("Express server listening on port " + app.get('port'));
});
