/*
 * TODOs
 *
 *  - feed station names to voice recognizer
 *  - voice command to read back available stations
 *
 *  x tell sonos to STOP in all rooms
 *  x write token/key back to the Config
 *  x podcast support
 *  x individual track support
 */
var Promise = require('bluebird');
var fs = Promise.promisifyAll(require('fs'));
var path = require('path');
var request = Promise.promisifyAll(require('request'));
var xml2js = Promise.promisifyAll(require('xml2js'));
var StreamingCommon = require(path.resolve( __dirname, "../streamingcommon.js" ) );
var Samples = require(path.resolve( __dirname, "../gplaysamples.js" ) );
var ConfigPath = path.resolve(__dirname, "../../googleplaysettings.json");

var Config = JSON.parse(fs.readFileSync(ConfigPath));

if (!Config.token || !Config.key) {
    throw new Error("Invalid config");
}

var SMAPIEndpoint = 'https://mclients.googleapis.com/music/sonos/wsf/smapi';

var ContainerTypeIDs = {
    Album: '0004204c',
    Podcast: '0008206c',
}

// TODO better to build XML programatically in future
var SOAP = {
    Credentials: '<credentials xmlns="http://www.sonos.com/Services/1.1"><deviceId>{deviceId}</deviceId><deviceProvider>Sonos</deviceProvider><loginToken><token>{token}</token><key>{key}</key><householdId>{householdId}</householdId></loginToken></credentials>',
    GetLastUpdate: '<getLastUpdate xmlns="http://www.sonos.com/Services/1.1"></getLastUpdate>',
    Search: '<search xmlns="http://www.sonos.com/Services/1.1"><id>{category}</id><term>{term}</term><index>{index}</index><count>{count}</count></search>',
    GetMetadata: '<getMetadata xmlns="http://www.sonos.com/Services/1.1"><id>{id}</id><recursive>{recursive}</recursive><index>{index}</index><count>{count}</count></getMetadata>',
    Envelope: '<?xml version="1.0" ?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"><s:Header>{credentials}</s:Header><s:Body>{body}</s:Body></s:Envelope>',
    TrackMetadata: '<DIDL-Lite xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:upnp="urn:schemas-upnp-org:metadata-1-0/upnp/" xmlns:r="urn:schemas-rinconnetworks-com:metadata-1-0/" xmlns="urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/"><item id="00030020{id}" restricted="true"><dc:title>{title}</dc:title><upnp:class>object.item.audioItem.musicTrack</upnp:class><desc id="cdudn" nameSpace="urn:schemas-rinconnetworks-com:metadata-1-0/">SA_RINCON38663_X_X#Svc38663-0-Token</desc></item></DIDL-Lite>',
    ContainerMetadata: '<DIDL-Lite xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:upnp="urn:schemas-upnp-org:metadata-1-0/upnp/" xmlns:r="urn:schemas-rinconnetworks-com:metadata-1-0/" xmlns="urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/"><item id="{containerTypeID}{id}" restricted="true"><dc:title>{title}</dc:title><upnp:class>object.container.album.musicAlbum</upnp:class><desc id="cdudn" nameSpace="urn:schemas-rinconnetworks-com:metadata-1-0/">SA_RINCON38663_X_X#Svc38663-0-Token</desc></item></DIDL-Lite>',
    StationMetadata: '<DIDL-Lite xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:upnp="urn:schemas-upnp-org:metadata-1-0/upnp/" xmlns:r="urn:schemas-rinconnetworks-com:metadata-1-0/" xmlns="urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/"><item id="000c206c{id}" restricted="true"><dc:title>{title}</dc:title><upnp:class>object.item.audioItem.audioBroadcast</upnp:class><desc id="cdudn" nameSpace="urn:schemas-rinconnetworks-com:metadata-1-0/">SA_RINCON38663_X_X#Svc38663-0-Token</desc></item></DIDL-Lite>'
};

String.prototype.format = function (replaceTable) {
  return this.replace(/{([a-z]+)}/gi, function (match) {
    return (replaceTable.hasOwnProperty(RegExp.$1)) ? replaceTable[RegExp.$1] : match;
  });
};

function Station(rawStation) {
    Object.assign(this, rawStation);

    this.getMetadata = function() {
        return SOAP.StationMetadata.format({
            id: this.id,
            title: this.title
        })
    };

    this.getURI = function() {
        return 'x-sonosapi-radio:' + this.id + '?sid=151&flags=8300&sn=15';
    }
}

function Track(rawTrack) {
    Object.assign(this, rawTrack);

    this.getMetadata = function() {
        return SOAP.TrackMetadata.format({
            id: this.id,
            title: this.title
        })
    };

    this.getURI = function() {
        return 'x-sonos-http:' + this.id + '.mp3?sid=151&flags=32&sn=15';
    }
}


function Container(rawContainer, containerTypeID) {
    Object.assign(this, rawContainer);
    this.containerTypeID = containerTypeID;

    this.getMetadata = function() {
        return SOAP.ContainerMetadata.format({
            id: this.id,
            title: this.title,
            containerTypeID: this.containerTypeID
        })
    };

    this.getURI = function() {
        return 'x-rincon-cpcontainer:' + this.containerTypeID + this.id;
    }
}


function Album(rawAlbum) {
    return new Container(rawAlbum, ContainerTypeIDs.Album);
}

function Podcast(rawPodcast) {
    return new Container(rawPodcast, ContainerTypeIDs.Podcast);
}


function googlePlay(player, values) {
    var type = values[0];
    var decodedSearchTerm = unescape(values[1].toLowerCase());
    if (type == 'undefined') {
        var numTerms = decodedSearchTerm.split(" ").length;
        // handle things like "feeling good by nina simone", but
        // avoid false positives like "guided by voices"
        if (decodedSearchTerm.indexOf(' by ') != -1 && numTerms > 3) {
            type = 'track';
        } else {
            type = 'artist';
        }
    } else if (type == 'song') {
        type = 'track';
    }
    var removeTracksAsync = Promise.promisify(player.coordinator.removeAllTracksFromQueue, {context: player.coordinator});

    checkAuth().then(function() {
        console.info("running search for " + type + " query: " + decodedSearchTerm);
        return playSearcher(type, decodedSearchTerm);
    }).then(function(searchResults) {
        return removeTracksAsync().then(function() {
            if (type == 'artist' || type == 'album') {
                return StreamingCommon.queueAndPlayItem(player, searchResults);
            } else if (type == 'station') {
                var station = searchResults;
                return StreamingCommon.queueAndPlayStation(player, station);
            } else if (type == 'podcast') {
                return StreamingCommon.queueAndPlayItem(player, searchResults);
            } else if (type == 'track') {
                return StreamingCommon.queueAndPlayItem(player, searchResults);
            }
        });
    })
}

function playSearcher(type, searchTerm) {
    if (type == 'artist') {
        var albumToGet = 'top';
        if (searchTerm.startsWith("latest")) {
            albumToGet = 'latest';
            searchTerm = searchTerm.replace("latest ", "");
        }
        return getArtist(searchTerm).then(getArtistAlbums).then(function(albums) {
            return albums[albumToGet];
        });
    } else if (type == 'album') {
        return getAlbum(searchTerm);
    } else if (type == 'station') {
        return getStation(searchTerm);
    } else if (type == 'podcast') {
        return getPodcast(searchTerm);
    } else if (type == 'track') {
        return getTrack(searchTerm);
    } else {
        throw new Error("unknown search type");
    }
}

function checkAuth() {
    return getLastUpdate().then(function(body) {
        return body;
    });
}

function getLastUpdate() {
    return soapAction(
        'getLastUpdate',
        SOAP.GetLastUpdate
    );
};

function getArtist(searchTerm) {
    var soapString = SOAP.Search.format({
        'category': 'ARTIST',
        'term': searchTerm,
        'index': 0,
        'count': 5
    });
    return soapAction('search', soapString).then(function(body) {
        console.info("Got artist response!");
        var artists = body["searchResponse"]["searchResult"]["mediaCollection"];
        for (var i = 0; i < artists.length; i++) {
            var artist = artists[i];
            // skip any Library artists
            if (artist.albumArtURI.indexOf('artist_icon') != -1) {
                continue;
            } else {
                console.log("Found artist " + JSON.stringify(artist));
                return artist;
            }
        }
        // TODO throw error
    });
}

function getAlbum(searchTerm) {
    var soapString = SOAP.Search.format({
        'category': 'ALBUM',
        'term': searchTerm,
        'index': 0,
        'count': 5
    });
    return soapAction('search', soapString).then(function(body) {
        console.info("Got album response!");
        var albums = body["searchResponse"]["searchResult"]["mediaCollection"];
        // prefer favorites, if there is one
        for (var i = 0; i < albums.length; i++) {
            var album = albums[i];
            if (album.isFavorite) {
                return new Album(album);
            }
        }
        return new Album(albums[0]);
    });
}

function getStation(searchTerm) {
    var soapString = SOAP.Search.format({
        'category': 'CURATED_STATION',
        'term': searchTerm,
        'index': 0,
        'count': 5
    });
    return soapAction('search', soapString).then(function(body) {
        console.info("Got station response!");
        var stations = body["searchResponse"]["searchResult"]["mediaCollection"];
        return new Station(stations[0]);
    });
}

function getPodcast(searchTerm) {
    var soapString = SOAP.Search.format({
        'category': 'PODCAST_SERIES',
        'term': searchTerm,
        'index': 0,
        'count': 5
    });
    return soapAction('search', soapString).then(function(body) {
        console.info("Got podcast response!");
        var stations = body["searchResponse"]["searchResult"]["mediaCollection"];
        return new Podcast(stations[0]);
    });
}

function getArtistAlbums(artist) {
    var soapString = SOAP.GetMetadata.format({
        'id': artist.id,
        'index': 0,
        'count': 5
    });
    return soapAction("getMetadata", soapString).then(function(body) {
        var availableAlbums = body["getMetadataResponse"]["getMetadataResult"]["mediaCollection"];
        var albumResult = {};
        for (var i = 0; i < availableAlbums.length; i++) {
            var album = availableAlbums[i];
            if (album.title == "Artist Shuffle") {
                albumResult["shuffle"] = new Album(album);
            } else if (album.title == artist.title + " Radio") {
                albumResult["radio"] = new Album(album);
            } else if (album.title == "Top Songs") {
                albumResult["top"] = new Album(album);
            } else if (album.title == "My Library") {
                albumResult["library"] = new Album(album);
            } else if (album.itemType == 'album') {
                albumResult["latest"] = new Album(album);
                break;
            }
        }
        return albumResult;
    });
}

function getTrack(searchTerm) {
    var soapString = SOAP.Search.format({
        'category': 'TRACK',
        'term': searchTerm,
        'index': 0,
        'count': 5
    });
    return soapAction('search', soapString).then(function(body) {
        console.info("Got tracks response!");
        var tracks = body["searchResponse"]["searchResult"]["mediaMetadata"];
        return new Track(tracks[0]);
    });
}

function soapAction(action, soapBody) {
    var soapActionURL = "http://www.sonos.com/Services/1.1#" + action;
    var fullSoap = SOAP.Envelope.format({
        'credentials': buildCredentialsXML(),
        'body': soapBody
    });
    var options = {
        url: SMAPIEndpoint,
        headers: {
            "SOAPACTION": soapActionURL,
            "Content-Type": 'text/xml; charset="utf-8"',
            "Accept-Encoding": 'gzip',
            'user-agent': "Linux UPnP/1.0 Sonos/26.8-24090 (ZP120)",
            "x-sonos-buildtype": "alpha"
        },
        gzip: true,
        body: fullSoap
    }
    console.log("calling postAsync");
    return request.postAsync(options).then(function(result) {
        if (result.statusCode != 200) {
            return parseResponse(result.body).then(function(body) {
                var fault = body['soap:Fault'];
                if (fault['faultcode'] == 'soap:Client.TokenRefreshRequired') {
                    Config.token = fault['detail']['refreshAuthTokenResult']['authToken'];
                    Config.key = fault['detail']['refreshAuthTokenResult']['privateKey'];
                    console.log("Refreshing token! " + Config.token);
                    fs.writeFileSync(ConfigPath, JSON.stringify(Config));
                    return soapAction(action, soapBody);
                } else {
                    console.error("Failed to make SOAP call " + JSON.stringify(body));
                }
            });
        } else {
            console.info("got successful response!");
            return parseResponse(result.body);
        }
    });

}

function buildCredentialsXML() {
    var soap = SOAP.Credentials.format({
        deviceId: '00-0E-58-D6-56-1E:A',
        token: Config.token,
        key: Config.key,
        householdId: 'Sonos_JpRt9G7QxxkS5NFnhf2hcPoPBZ_d0059637'
    })
    return soap;
}

function parseResponse(xml) {
    var parser = xml2js.Parser({explicitArray: false});
    return parser.parseStringAsync(xml).then(function(result) {
        return result["soap:Envelope"]["soap:Body"];
    });
}

module.exports = function (api) {
    api.registerAction('googleplay', googlePlay);
}


/** EXAMPLES **/

/*
var SonosDiscovery = require('sonos-discovery');
var discovery = new SonosDiscovery({});
setTimeout(function() {
    var office = discovery.getPlayer("Kitchen");
    // googlePlay(office, ["artist", "junior boys"]);
    // googlePlay(office, ["album", "hamilton"]);
    // googlePlay(office, ["podcast", "reply all"]);
    //googlePlay(office, ["station", "sophisticated indie"]);
    googlePlay(office, ["track", "get back"]);
}, 1000);
*/