var test = require('tape');
var _ = require('underscore');
var os = require('os');
var fs = require('fs');
var path = require('path');
var assert = require('assert');
var tilelive = require('tilelive');
var yaml = require('js-yaml');

var tm = require('../lib/tm');
var middleware = require('../lib/middleware');
var style = require('../lib/style');
var source = require('../lib/source');
var mockOauth = require('../lib/mapbox-mock')(require('express')());
var mockAtlas = require('../lib/mapbox-mock').AtlasServer(require('express')());
var tmppath = tm.join(os.tmpdir(), 'mapbox-studio', 'middleware-' + (+new Date));
var tmpId = tm.join(os.tmpdir(), 'mapbox-studio', 'middlewareProject-' + (+new Date));
var sourceId = 'tmsource://' + tm.join(path.resolve(__dirname), 'fixtures-local source');
var styleId = 'tmstyle://' + tm.join(path.resolve(__dirname), 'fixtures-local source');
var server;
var atlas;

test('setup: config ' + __filename, function(t) {
    tm.config({
        log: false,
        db: path.join(tmppath, 'app.db'),
        cache: path.join(tmppath, 'cache'),
        fonts: path.join(tmppath, 'fonts')
    }, t.end);
});

test('setup: mockserver', function(t) {
    tm.db.set('oauth', {
        account: 'test',
        accesstoken: 'testaccesstoken'
    });
    tm.db.set('MapboxAPIAuth', 'http://localhost:3001');
    tm.db.set('MapboxAPITile', 'http://localhost:3001');
    server = mockOauth.listen(3001, function(){
        atlas = mockAtlas.listen(2999, t.end);
    });
});

test('normalizePaths', function(assert) {
    var req;

    req = { query: {} };
    middleware.normalizePaths(req, {}, function(err) {
        assert.ifError(err);
        assert.deepEqual(req.query, {});
    });

    req = { query: { id:'A Font Name' } };
    middleware.normalizePaths(req, {}, function(err) {
        assert.ifError(err);
        assert.deepEqual(req.query.id, 'A Font Name');
    });

    req = {
        query: {
            id:'tmstyle:///path with spaces/style.tm2',
            style:'tmstyle:///path with spaces/style.tm2',
            source:'tmsource:///path with spaces/source.tm2source'
        },
        body: {
            id:'tmstyle:///path with spaces/style.tm2',
            source:'tmsource:///path with spaces/source.tm2source'
        }
    };
    middleware.normalizePaths(req, {}, function(err) {
        assert.ifError(err);
        assert.deepEqual(req.query.id, 'tmstyle:///path with spaces/style.tm2');
        assert.deepEqual(req.query.style, 'tmstyle:///path with spaces/style.tm2');
        assert.deepEqual(req.query.source, 'tmsource:///path with spaces/source.tm2source');
        assert.deepEqual(req.body.id, 'tmstyle:///path with spaces/style.tm2');
        assert.deepEqual(req.body.source, 'tmsource:///path with spaces/source.tm2source');
    });

    req = {
        query: {
            id:'tmstyle://C:\\path with\\spaces/style.tm2',
            style:'tmstyle://C:\\path with\\spaces/style.tm2',
            source:'tmsource://C:\\path with\\spaces/source.tm2source'
        },
        body: {
            id:'tmstyle://C:\\path with\\spaces/style.tm2',
            source:'tmsource://C:\\path with\\spaces/source.tm2source'
        }
    };

    //fake Windows platform for these Windows specific tests
    //process.platform is readonly, using Object.defineProperty to override
    var orig_platform = process.platform;
    if ('win32' !== process.platform) {
        Object.defineProperty(process, 'platform', {value: 'win32'});
    }
    middleware.normalizePaths(req, {}, function(err) {
        assert.ifError(err);
        assert.deepEqual(req.query.id, 'tmstyle://c:/path with/spaces/style.tm2');
        assert.deepEqual(req.query.style, 'tmstyle://c:/path with/spaces/style.tm2');
        assert.deepEqual(req.query.source, 'tmsource://c:/path with/spaces/source.tm2source');
        assert.deepEqual(req.body.id, 'tmstyle://c:/path with/spaces/style.tm2');
        assert.deepEqual(req.body.source, 'tmsource://c:/path with/spaces/source.tm2source');
    });
    if (orig_platform !== process.platform) {
        Object.defineProperty(process, 'platform', {value: orig_platform});
    }
    assert.deepEqual(process.platform, orig_platform);

    req = {
	// NOTE: these are empty for this test - we do not check their values
	// but they are required to be present.
	query: {
	    id: '',
	    style: '',
	    source: ''
	},
	body: {
	    id: '',
	    source: 'http://localhost:31337/path/to/tile.json'
	}
    }
    middleware.normalizePaths(req, {}, function(err) {
	assert.ifError(err);
	assert.deepEqual(req.body.source, 'http://localhost:31337/path/to/tile.json');
    });

    assert.end();
});

test('history: loads', function(t) {
    var req = {};
    middleware.history(req, {}, function() {
        t.ok(req.history, 'has history');
        t.ok(req.history.source, 'history object includes a source');
        t.ok(req.history.source['mapbox:///mapbox.mapbox-streets-v5'], 'default source is listed');
        t.end();
    });
});

test('history: gets style/source info', function(t) {
    tm.history(sourceId);
    tm.history(styleId);

    var req = {};
    middleware.history(req, {}, function() {
        var sourceInfo = req.history.source[sourceId];
        var styleInfo = req.history.style[styleId];
        t.equal('Test source', sourceInfo.name, 'source info was loaded');
        t.equal('Test style', styleInfo.name, 'style info was loaded');
        t.end();
    });
});

test('history: removes dead source/styles', function(t) {
    tm.history('tmstyle:///foo');
    tm.history('tmsource:///bar');
    var req = {};
    middleware.history(req, {}, function() {
        t.ok(!req.history.source.foo, 'source `foo` was removed');
        if (req.history.style) t.ok(!req.history.style.bar, 'style `bar` was removed');
        t.end();
    });
});

test('examples: gets style info', function(t) {
    var req = {};
    middleware.examples(req, {}, function(err) {
        t.ifError(err);
        t.equal(typeof req.examples.style, 'object');
        t.equal(typeof req.examples.source, 'object');
        t.deepEqual(Object.keys(req.examples.style), [
            'mapbox-studio-default-style',
            'mapbox-studio-comic',
            'mapbox-studio-dark',
            'mapbox-studio-emerald',
            'mapbox-studio-high-contrast',
            'mapbox-studio-light',
            'mapbox-studio-osm-bright',
            'mapbox-studio-outdoors',
            'mapbox-studio-pencil',
            'mapbox-studio-pirates',
            'mapbox-studio-run-bike-hike',
            'mapbox-studio-satellite-afternoon',
            'mapbox-studio-streets-basic',
            'mapbox-studio-streets-satellite',
            'mapbox-studio-streets',
            'mapbox-studio-wheatpaste'
        ], 'has example styles');
        t.equal(req.examples.style['mapbox-studio-default-style'].name, '');
        t.equal(req.examples.style['mapbox-studio-osm-bright'].name, 'OSM Bright 2');
        t.end();
    });
});

test('writeStyle: makes tmp styles (refresh)', function(t) {
    var data = {
        id:'tmpstyle://' + tm.parse(styleId).dirname,
        name:'tmp-1234',
        source:'mapbox:///mapbox.mapbox-streets-v2',
        styles:{ 'a.mss': '#water { polygon-fill:#fff }' }
    };
    var req = { body: data, query: { refresh: 1 } };
    middleware.writeStyle(req, {}, function(err) {
        t.ifError(err);
        t.ok(req.style, 'appends style to req');
        t.ok(style.tmpid(req.style.data.id), 'creates a valid tmp id');
        var history = tm.history();
        if (history.style) {
            t.ok(history.style.indexOf(req.style.data.id) === -1, 'does not write to history');
        }
        t.equal(req.style.data.name, data.name, 'has correct info');
        t.end();
    });
});

test('writeStyle: makes persistent styles', function(t) {
    var data = {
        id:'tmstyle://' + tmpId,
        name:'tmp-1234',
        source:'mapbox:///mapbox.mapbox-streets-v2',
        styles:{ 'a.mss': '#water { polygon-fill:#fff }' }
    };
    var req = { body: data };
    middleware.writeStyle(req, {}, function(err) {
        t.ifError(err);
        t.ok(req.style, 'appends style to req');
        t.ok(!style.tmpid(req.style.data.id), 'does not create a tmp id');
        t.ok(tm.history().indexOf(req.style.data.id) !== -1, 'writes to history');
        t.equal(req.style.data.name, data.name, 'has correct info');
        t.ok(/maxzoom: 22/.test(fs.readFileSync(tmpId + '/project.yml', 'utf8')), 'saves project.yml');
        t.equal(data.styles['a.mss'], fs.readFileSync(tmpId + '/a.mss', 'utf8'), 'saves a.mss');
        t.end();
    });
});

test('loadStyle: loads a tmp style', function(t) {
    var req = { query: { id:'tmpstyle://' + tm.parse(styleId).dirname } };
    middleware.loadStyle(req, {}, function(err) {
        t.ifError(err);
        t.ok(req.style, 'appends style to req');
        t.equal(req.style.data.id, req.query.id, 'has the correct id');
        var history = tm.history();
        if (history.style) {
            t.ok(history.style.indexOf(req.style.data.id) === -1, 'does not write to history');
        }
        t.end();
    });
});

test('newStyle: creates a tmp style with source', function(t) {
    var sourceId = 'tmsource://' + tm.join(path.resolve(__dirname), 'fixtures-local source');
    var req = { body: {}, query: { source:sourceId } };
    middleware.newStyle(req, {}, function(err) {
        t.ifError(err);
        t.deepEqual({
            'style.mss': 'Map {\n  background-color: #fff;\n}\n\n#solid {\n  line-width: 1;\n  line-color: rgba(153,204,68,0.5);\n}\n\n#box {\n  line-width: 1;\n  line-color: rgba(238,68,187,0.5);\n}\n\n'
        }, req.style.data.styles, 'creates default styles');
        t.equal(sourceId, req.style.data.source, 'sets source from input param');
        t.ok(style.tmpid(req.style.data.id));
        t.end();
    });
});

test('newStyle: creates a tmp style with a raster source', function(t) {
    var sourceId = 'tmsource://' + tm.join(path.resolve(__dirname), 'fixtures-local raster');
    var req = { body: {}, query: { source:sourceId } };
    middleware.newStyle(req, {}, function(err) {
        t.ifError(err);
        t.deepEqual({
            'style.mss': 'Map {\n  background-color: #fff;\n}\n\n#_image {\n  raster-opacity: 1;\n}\n\n'
        }, req.style.data.styles, 'creates default styles');
        t.equal(sourceId, req.style.data.source, 'sets source from input param');
        t.ok(style.tmpid(req.style.data.id));
        t.end();
    });
});

test('newStyle: errors a tmp style with bad source', function(t) {
    var sourceId = 'tmsource:///bad/path/to/nonexistent/source';
    var req = { body: {}, query: { source:sourceId } };
    middleware.newStyle(req, {}, function(err) {
        t.ok(err);
        t.equal('ENOENT', err.code);
        t.end();
    });
});

test('loadStyle: loads a persistent style', function(t) {
    var styleId = 'tmstyle://' + tm.join(path.resolve(__dirname), 'fixtures-local source');
    var styleDoc = require('./fixtures-local source/project.yml');
    var req = { query: { id: styleId } };
    middleware.loadStyle(req, {}, function() {
        t.ok(req.style, 'appends style to req');
        t.equal(req.style.data.id, styleId, 'has the correct id');
        t.ok(tm.history().indexOf(req.style.data.id) !== -1, 'writes to history');
        t.equal(req.style.data.mtime, styleDoc.mtime, 'style info was loaded');
        t.end();
    });
});

test('newSource: makes tmp sources', function(t) {
    var req = { body: {} };
    middleware.newSource(req, {}, function() {
        t.ok(req.source, 'appends source to req');
        t.ok(source.tmpid(req.source.data.id), 'creates a valid tmp id');
        var history = tm.history();
        if (history.source) {
            t.ok(history.source.indexOf(req.source.data.id) === -1, 'does not write to history');
        }
        t.end();
    });
});

test('writeSource: makes persistent sources', function(t) {
    var data = {
        id: 'tmsource://' + tmpId,
        name: 'Test source',
        attribution: '&copy; John Doe 2013.',
        minzoom: 0,
        maxzoom: 6,
        Layer: [ {
            id: 'box',
            name: 'box',
            description: '',
            srs: '+proj=merc +a=6378137 +b=6378137 +lat_ts=0.0 +lon_0=0.0 +x_0=0.0 +y_0=0.0 +k=1.0 +units=m +nadgrids=@null +wktext +no_defs +over',
            properties: {
                'buffer-size': 0,
                minzoom: 0,
                maxzoom: 6
            },
            Datasource: {
                file: __dirname + '/fixtures-local source/10m-900913-bounding-box.shp',
                type: 'shape'
            }
        } ]
    };
    var req = { body: data };
    middleware.writeSource(req, {}, function() {
        var s = req.source;
        t.ok(s, 'appends source to req');
        t.ok(!source.tmpid(s.data.id), 'does not creates a tmp id');
        var history = tm.history();
        if (history.source) {
            t.ok(history.source.indexOf(s.data.id) !== -1, 'writes to history');
        }
        t.deepEqual(s.data, data, 'has the right data');
        t.end();
    });
});

test('loadSource: loads a tmp source', function(t) {
    var writeReq = { body: {} };
    var req = { query: { id: source.tmpid() } };
    middleware.loadSource(req, {}, function() {
        t.ok(req.source, 'appends source to req');
        t.equal(req.source.data.id, source.tmpid(), 'has the correct id');
        var history = tm.history();
        if (history.source) {
            t.ok(history.source.indexOf(req.source.data.id) === -1, 'does not write to history');
        }
        t.end();
    });
});

test('loadSource: loads a persistent source', function(t) {
    var sourceId = 'tmsource://' + tm.join(path.resolve(__dirname), 'fixtures-local source');
    var sourceDoc = require('./fixtures-local source/data.yml');
    var req = { query: { id: sourceId } };
    middleware.loadSource(req, {}, function() {
        t.ok(req.source, 'appends source to req');
        t.equal(req.source.data.id, sourceId, 'has the correct id');
        t.ok(tm.history().indexOf(req.source.data.id) !== -1, 'writes to history');
        t.equal(req.source.data.name, sourceDoc.name, 'has the correct name');
        t.equal(req.source.data.attribution, sourceDoc.attribution, 'has the correct attribution');
        t.equal(req.source.data.minzoom, sourceDoc.minzoom, 'has the correct minzoom');
        t.equal(req.source.data.maxzoom, sourceDoc.maxzoom, 'has the correct maxzoom');
        t.deepEqual(req.source.data.Layer[0].Datasource, sourceDoc.Layer[0].Datasource, 'has the correct Layer');
        t.end();
    });
});

test('auth: errors on unauthenticated requests', function(t) {
    tm.db.rm('oauth');
    middleware.auth({}, {}, function(err) {
        t.equal('EOAUTH', err.code);
        t.end();
    });
});

test('auth: passes through authenticated requests', function(t) {
    tm.db.set('oauth', {
        account: 'test',
        accesstoken: '12345678'
    });
    middleware.auth({}, {}, function(err) {
        t.ok(!err);
        t.end();
    });
});

test('exporting: passes through', function(t) {
    middleware.exporting({}, {}, function(err) {
        t.ifError(err);
        t.end();
    });
});
// @TODO test cases where copytask has been started.
// Requires fixes for copytask pause/cancel.

test('userTilesets: fails without oauth', function(t) {
    tm.db.rm('oauth');
    middleware.userTilesets({}, {}, function(err) {
        t.equal('Error: No active OAuth account', err.toString());
        t.equal(err.code, 'EOAUTH');
        t.end();
    });
});

test('userTilesets: requires 200 from Mapbox API', function(t) {
    tm.db.set('oauth', {
        account: 'baduser',
        accesstoken: 'badtoken'
    });
    middleware.userTilesets({}, {}, function(err) {
        t.equal('Error: 403 GET http://localhost:3001/api/Map?account=baduser&_type=tileset&private=true&access_token=badtoken', err.toString());
        t.end();
    });
});

test('userTilesets: adds history entries for tilesets', function(t) {
    tm.db.set('oauth', {
        account: 'test',
        accesstoken: '12345678'
    });
    middleware.userTilesets({}, {}, function(err) {
        t.ifError(err);
        t.ok(tm.history().indexOf('mapbox:///test.vector-source') !== -1);
        t.ok(tm.history().indexOf('mapbox:///test.raster-source') === -1);
        t.end();
    });
});

test('config: bad url', function(t) {
    var res = {};
    res.redirect = function(qs){
    };
    middleware.config({query: {MapboxAPITile: 'http://localhost:2999/badurl'}}, res, function(err){
        t.deepEqual(err.message, 'Cannot find Mapbox API at http://localhost:2999/badurl', 'errors correctly');
        t.equal(tm.db.get('user'), undefined, 'does not set user');
        t.end();
    });
});

test('config: bad location', function(t) {
    var res = {};
    res.redirect = function(qs){
    };
    middleware.config({query: {MapboxAPITile: 'http://localhost:2999/badlocation'}}, res, function(err){
        t.deepEqual(err.message, 'Cannot find Mapbox API at http://localhost:2999/badlocation', 'errors correctly');
        t.equal(tm.db.get('user'), undefined, 'does not set user');
        t.end();
    });
});

test('config: good url - mapbox', function(t) {
    var res = {};
    res.redirect = function(qs){
        t.equal(qs, '/oauth/mapbox', 'redirects to /oauth/mapbox');
        t.end();
    };

    middleware.config({query: {MapboxAPITile: 'http://localhost:2999/mapbox'}}, res, function(){});
});

test('config: good url - offline', function(t) {
    var res = {};
    res.redirect = function(qs){
        t.equal(qs, '/authorize', 'redirects to /authorize');
        t.equal(tm.db.get('user').id, 'offline', 'sets user correctly');
        t.equal(tm.db.get('user').name, 'Offline user', 'sets user correctly');
        t.equal(tm.db.get('user').avatar, '/app/avatar.png', 'sets user correctly');
        t.equal(tm.db.get('oauth').account, 'offline', 'sets oauth correctly');
        t.equal(tm.db.get('oauth').accesstoken, '', 'sets oauth correctly');
        t.equal(tm.db.get('oauth').isMapboxAPI, false, 'sets oauth correctly');
        t.end();
    };

    middleware.config({query: {MapboxAPITile: 'http://localhost:2999/atlas'}}, res, function(){});
});

test('config: trailing slash - offline', function(t) {
    var res = {};
    res.redirect = function(qs){
        t.equal(qs, '/authorize', 'redirects to /authorize');
        t.equal(tm.apiConfig('MapboxAPITile'), 'http://localhost:2999/atlas', 'strips trailing slash');
        t.equal(tm.db.get('user').id, 'offline', 'sets user correctly');
        t.equal(tm.db.get('user').name, 'Offline user', 'sets user correctly');
        t.equal(tm.db.get('user').avatar, '/app/avatar.png', 'sets user correctly');
        t.equal(tm.db.get('oauth').account, 'offline', 'sets oauth correctly');
        t.equal(tm.db.get('oauth').accesstoken, '', 'sets oauth correctly');
        t.equal(tm.db.get('oauth').isMapboxAPI, false, 'sets oauth correctly');
        t.end();
    };

    middleware.config({query: {MapboxAPITile: 'http://localhost:2999/atlas/'}}, res, function(){});
});

test('cleanup ' + __filename, function(t) {
    tm.db.rm('oauth');
    tm.history(sourceId, true);
    tm.history(styleId, true);
    server.close(function() { atlas.close(function(){ t.end(); }) });
});
