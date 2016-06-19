/*
 * TODO:
 * - spotify fix artist case
 */
var Promise = require('bluebird');
var fs = Promise.promisifyAll(require('fs'));
var path = require('path');
var request = Promise.promisifyAll(require('request'));
var xml2js = Promise.promisifyAll(require('xml2js'));
var StreamingCommon = require(path.resolve( __dirname, "streamingcommon.js" ) );
var SSLClientKey = fs.readFileSync(path.resolve(__dirname, '../certs/sonos-client-key'));
var SSLClientCert = fs.readFileSync(path.resolve(__dirname, '../certs/sonos-client-cert'));


var ContainerTypeIDs = {
    Album: '0004204c',
    Podcast: '0008206c',
}

String.prototype.format = function (replaceTable) {
  return this.replace(/{([a-z]+)}/gi, function (match) {
    return (replaceTable.hasOwnProperty(RegExp.$1)) ? replaceTable[RegExp.$1] : match;
  });
};


function SMAPIService(options) {

    var service = this;
    this.SMAPIEndpoint = options.smapiEndpoint;
    this.authConfig = JSON.parse(fs.readFileSync(options.authConfigPath));
    this.authConfigPath = options.authConfigPath;
    this.presentationMap = options.presentationMap;
    this.albumTypeMap = options.albumTypeMap;
    this.trackOptions = options.trackOptions;
    this.serviceId = options.serviceId;

    if (!this.authConfig.token || !this.authConfig.key || !this.authConfig.deviceId || !this.authConfig.householdId) {
        throw new Error("Invalid config");
    }

    // TODO better to build XML programatically in future
    var SOAP = {
        Credentials: '<credentials xmlns="http://www.sonos.com/Services/1.1"><deviceId>{deviceId}</deviceId><deviceProvider>Sonos</deviceProvider><loginToken><token>{token}</token><key>{key}</key><householdId>{householdId}</householdId></loginToken></credentials>',
        GetLastUpdate: '<getLastUpdate xmlns="http://www.sonos.com/Services/1.1"></getLastUpdate>',
        Search: '<search xmlns="http://www.sonos.com/Services/1.1"><id>{category}</id><term>{term}</term><index>{index}</index><count>{count}</count></search>',
        GetMetadata: '<getMetadata xmlns="http://www.sonos.com/Services/1.1"><id>{id}</id><recursive>{recursive}</recursive><index>{index}</index><count>{count}</count></getMetadata>',
        Envelope: '<?xml version="1.0" ?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"><s:Header>{credentials}</s:Header><s:Body>{body}</s:Body></s:Envelope>',
        TrackMetadata: '<DIDL-Lite xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:upnp="urn:schemas-upnp-org:metadata-1-0/upnp/" xmlns:r="urn:schemas-rinconnetworks-com:metadata-1-0/" xmlns="urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/"><item id="{typeId}{id}" restricted="true"><dc:title>{title}</dc:title><upnp:class>object.item.audioItem.musicTrack</upnp:class><desc id="cdudn" nameSpace="urn:schemas-rinconnetworks-com:metadata-1-0/">' + this.authConfig.tokenId + '</desc></item></DIDL-Lite>',
        ContainerMetadata: '<DIDL-Lite xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:upnp="urn:schemas-upnp-org:metadata-1-0/upnp/" xmlns:r="urn:schemas-rinconnetworks-com:metadata-1-0/" xmlns="urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/"><item id="{containerTypeID}{id}" restricted="true"><dc:title>{title}</dc:title><upnp:class>object.container.album.musicAlbum</upnp:class><desc id="cdudn" nameSpace="urn:schemas-rinconnetworks-com:metadata-1-0/">' + this.authConfig.tokenId + '</desc></item></DIDL-Lite>',
        StationMetadata: '<DIDL-Lite xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:upnp="urn:schemas-upnp-org:metadata-1-0/upnp/" xmlns:r="urn:schemas-rinconnetworks-com:metadata-1-0/" xmlns="urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/"><item id="000c206c{id}" restricted="true"><dc:title>{title}</dc:title><upnp:class>object.item.audioItem.audioBroadcast</upnp:class><desc id="cdudn" nameSpace="urn:schemas-rinconnetworks-com:metadata-1-0/">' + this.authConfig.tokenId + '</desc></item></DIDL-Lite>'
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
            return 'x-sonosapi-radio:' + this.id + '?sid=' + service.serviceId + '&flags=8300&sn=15';
        }
    }

    function Track(rawTrack) {
        Object.assign(this, rawTrack);

        this.getMetadata = function() {
            return SOAP.TrackMetadata.format({
                id: encodeURIComponent(this.id),
                title: this.title,
                typeId: service.trackOptions.typeId
            })
        };

        this.getURI = function() {
            var prefix = service.trackOptions.prefix || "";
            var extension = service.trackOptions.extension || "";
            return prefix + encodeURIComponent(this.id) + extension + '?sid=' + service.serviceId + '&flags=' + service.trackOptions.flags + '&sn=15';
        }
    }


    function Container(rawContainer, containerTypeID) {
        Object.assign(this, rawContainer);
        this.containerTypeID = containerTypeID;

        this.getMetadata = function() {
            return SOAP.ContainerMetadata.format({
                id: encodeURIComponent(this.id),
                title: this.title,
                containerTypeID: this.containerTypeID
            })
        };

        this.getURI = function() {
            return 'x-rincon-cpcontainer:' + this.containerTypeID + encodeURIComponent(this.id);
        }
    }


    function Album(rawAlbum) {
        return new Container(rawAlbum, ContainerTypeIDs.Album);
    }

    function Podcast(rawPodcast) {
        return new Container(rawPodcast, ContainerTypeIDs.Podcast);
    }

    this.searchAndPlay = function(player, values) {
        var type = values[0];
        var searchTerm = unescape(values[1].toLowerCase());
        if (type == 'undefined') {
            var numTerms = searchTerm.split(" ").length;
            // handle things like "feeling good by nina simone", but
            // avoid false positives like "guided by voices"
            if (searchTerm.indexOf(' by ') != -1 && numTerms > 3) {
                type = 'track';
            } else {
                type = 'artist';
            }
        } else if (type == 'song') {
            type = 'track';
        }
        var removeTracksAsync = Promise.promisify(player.coordinator.removeAllTracksFromQueue, {context: player.coordinator});

        var service = this;
        this.checkAuth().then(function() {
            console.info("running search for " + type + " query: " + searchTerm);
            return service.searcher(type, searchTerm);
        }).then(function(searchResult) {
            if (!searchResult) {
                console.error("No result found!");
                return;
            }
            return removeTracksAsync().then(function() {
                if (type == 'artist' || type == 'album') {
                    return StreamingCommon.queueAndPlayItem(player, searchResult);
                } else if (type == 'station') {
                    var station = searchResult;
                    return StreamingCommon.queueAndPlayStation(player, station);
                } else if (type == 'podcast') {
                    return StreamingCommon.queueAndPlayItem(player, searchResult);
                } else if (type == 'track') {
                    return StreamingCommon.queueAndPlayItem(player, searchResult);
                }
            });
        }).catch(function(error) {
            debugger;
            console.error(error);
        });
    };

    this.searcher = function(type, searchTerm) {
        if (type == 'artist') {
            var albumToGet = 'top';
            if (searchTerm.startsWith("latest")) {
                albumToGet = 'latest';
                searchTerm = searchTerm.replace("latest ", "");
            } else if (searchTerm.endsWith("radio")) {
                albumToGet = 'radio';
                searchTerm = searchTerm.replace(" radio", "");
            }
            return this.getArtist(searchTerm).then(this.getArtistAlbums).then(function(albums) {
                return albums[albumToGet];
            });
        } else if (type == 'album') {
            return this.getAlbum(searchTerm);
        } else if (type == 'station') {
            return this.getStation(searchTerm);
        } else if (type == 'podcast') {
            return this.getPodcast(searchTerm);
        } else if (type == 'track') {
            return this.getTrack(searchTerm);
        } else {
            throw new Error("unknown search type");
        }
    }

    this.checkAuth = function() {
        return this.getLastUpdate().then(function(body) {
            return body;
        });
    }

    this.getLastUpdate = function() {
        return service.soapAction(
            'getLastUpdate',
            SOAP.GetLastUpdate
        );
    }

    this.getArtist = function(searchTerm) {
        var soapString = SOAP.Search.format({
            'category': this.presentationMap.artists,
            'term': searchTerm,
            'index': 0,
            'count': 5
        });
        return service.soapAction('search', soapString).then(function(body) {
            console.info("Got artist response!");
            var artists = arrayifyIfNeeded(body["searchResponse"]["searchResult"]["mediaCollection"]);
            for (var i = 0; i < artists.length; i++) {
                var artist = artists[i];
                // in Google Play, skip any Library artists
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
    this.getAlbum = function(searchTerm) {
        var soapString = SOAP.Search.format({
            'category': this.presentationMap.albums,
            'term': searchTerm,
            'index': 0,
            'count': 5
        });
        return service.soapAction('search', soapString).then(function(body) {
            console.info("Got album response!");
            var albums = arrayifyIfNeeded(body["searchResponse"]["searchResult"]["mediaCollection"]);
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

    this.getStation = function(searchTerm) {
        var soapString = SOAP.Search.format({
            'category': this.presentationMap.stations,
            'term': searchTerm,
            'index': 0,
            'count': 5
        });
        return service.soapAction('search', soapString).then(function(body) {
            console.info("Got station response!");
            var stations = arrayifyIfNeeded(body["searchResponse"]["searchResult"]["mediaCollection"]);
            return new Station(stations[0]);
        });
    }

    this.getPodcast = function(searchTerm) {
        var soapString = SOAP.Search.format({
            'category': this.presentationMap.podcasts,
            'term': searchTerm,
            'index': 0,
            'count': 5
        });
        return service.soapAction('search', soapString).then(function(body) {
            console.info("Got podcast response!");
            var stations = arrayifyIfNeeded(body["searchResponse"]["searchResult"]["mediaCollection"]);
            return new Podcast(stations[0]);
        });
    }


    this.getArtistAlbums = function(artist) {
        var soapString = SOAP.GetMetadata.format({
            'id': artist.id,
            'index': 0,
            'count': 5
        });
        return service.soapAction("getMetadata", soapString).then(function(body) {
            debugger;
            var availableAlbums = arrayifyIfNeeded(body["getMetadataResponse"]["getMetadataResult"]["mediaCollection"]);
            var albumResult = {};
            for (var i = 0; i < availableAlbums.length; i++) {
                var album = availableAlbums[i];
                var typeMap = service.albumTypeMap;
                if (album.title == "Artist Shuffle") {
                    albumResult["shuffle"] = new Album(album);
                } else if (album.title == artist.title + " Radio") {
                    albumResult["radio"] = new Album(album);
                } else if (album.title == typeMap.topTracks) {
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
    this.getTrack = function(searchTerm) {
        var soapString = SOAP.Search.format({
            'category': this.presentationMap.tracks,
            'term': searchTerm,
            'index': 0,
            'count': 5
        });
        return service.soapAction('search', soapString).then(function(body) {
            console.info("Got tracks response!");
            var tracks = arrayifyIfNeeded(body["searchResponse"]["searchResult"]["mediaMetadata"]);
            return new Track(tracks[0]);
        });
    }

    this.buildCredentialsXML = function() {
        var soap = SOAP.Credentials.format({
            deviceId: this.authConfig.deviceId,
            token: this.authConfig.token,
            key: this.authConfig.key,
            householdId: this.authConfig.householdId
        })
        return soap;
    }

    this.soapAction = function(action, soapBody) {
        var soapActionURL = '"http://www.sonos.com/Services/1.1#' + action + '"';
        var fullSoap = SOAP.Envelope.format({
            'credentials': this.buildCredentialsXML(),
            'body': soapBody
        });
        var options = {
            url: this.SMAPIEndpoint,
            headers: {
                "SOAPAction": soapActionURL,
                "Content-Type": 'text/xml; charset="utf-8"',
                "Accept-Encoding": 'gzip',
                "accept-language": 'en-US',
                "Connection": "close",
                'user-agent': "Linux UPnP/1.0 Sonos/32.11-29160 (MDCR_x86_64_MacBookPro12,1)",
            },
            gzip: true,
            body: fullSoap,
            agentOptions: {
                cert: SSLClientCert,
                key: SSLClientKey
            }
        }
        console.log("calling postAsync");
        var smapi = this;
        return request.postAsync(options).then(function(result) {
            if (result.statusCode != 200) {
                return parseResponse(result.body).then(function(body) {
                    var fault = body['Fault'];
                    if (fault['faultcode'].indexOf('Client.TokenRefreshRequired') != -1) {
                        // TODO put this in its own member function
                        smapi.authConfig.token = fault['detail']['refreshAuthTokenResult']['authToken'];
                        smapi.authConfig.key = fault['detail']['refreshAuthTokenResult']['privateKey'];
                        console.log("Refreshing token! " + smapi.authConfig.token);
                        fs.writeFileSync(smapi.authConfigPath, JSON.stringify(smapi.authConfig));
                        return smapi.soapAction(action, soapBody);
                    } else {
                        throw new Error("Failed to make SOAP call " + JSON.stringify(body));
                    }
                });
            } else {
                console.info("got successful response!");
                return parseResponse(result.body);
            }
        });

    }
}


function arrayifyIfNeeded(arrayOrItem) {
    // in the case of a single entry, the XML parser collapses into item
    // rarther into an array
    if (arrayOrItem.constructor === Array) {
        return arrayOrItem;
    } else {
        return [arrayOrItem];
    }
}


var prefixMatch = new RegExp(/(?!xmlns)^.*:/g);
var stripPrefix = function(str) {
    return str.replace(prefixMatch, '');
};

function parseResponse(xml) {
    var parser = xml2js.Parser({
        explicitArray: false,
        tagNameProcessors: [stripPrefix]
    });
    return parser.parseStringAsync(xml).then(function(result) {
        return result["Envelope"]["Body"];
    });
}

module.exports.SMAPIService = SMAPIService;