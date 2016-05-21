/*
 * TODOs
 *
 *  - support other broadcasts
 */

var Promise = require('bluebird');

var LatestNews = {
    'NPR': {
        'uri': 'x-sonosapi-rtrecent:t37047160%3ap212?sid=254&flags=8224&sn=0',
        'metadata': '<DIDL-Lite xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:upnp="urn:schemas-upnp-org:metadata-1-0/upnp/" xmlns:r="urn:schemas-rinconnetworks-com:metadata-1-0/" xmlns="urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/"><item id="F00032020t37047160%3ap212" parentID="F000b2064p212%3atopic" restricted="true"><dc:title>Latest NPR Hourly News Update</dc:title><upnp:class>object.item.audioItem.musicTrack.recentShow</upnp:class><desc id="cdudn" nameSpace="urn:schemas-rinconnetworks-com:metadata-1-0/">SA_RINCON65031_</desc></item></DIDL-Lite>'
    },
    'BBC': {
        'uri': 'x-sonosapi-rtrecent:t39382358%3ap14?sid=254&flags=8224&sn=0',
        'metadata': '<DIDL-Lite xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:upnp="urn:schemas-upnp-org:metadata-1-0/upnp/" xmlns:r="urn:schemas-rinconnetworks-com:metadata-1-0/" xmlns="urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/"><item id="F00032020t39382358%3ap14" parentID="F000b2064p14%3atopic" restricted="true"><dc:title>Latest BBC World Service - Hourly Bulletin</dc:title><upnp:class>object.item.audioItem.musicTrack.recentShow</upnp:class><desc id="cdudn" nameSpace="urn:schemas-rinconnetworks-com:metadata-1-0/">SA_RINCON65031_</desc></item></DIDL-Lite>'
    }
};

function readNews(player, values) {
    var removeTracksAsync = Promise.promisify(player.coordinator.removeAllTracksFromQueue, {context: player.coordinator});
    var addURIToQueue = Promise.promisify(player.coordinator.addURIToQueue, {context: player.coordinator});
    var searchTerm = unescape(values[0].toLowerCase());

    var newsBroadcast = LatestNews.NPR;
    console.info("Playing news from " + searchTerm);
    if (searchTerm == 'undefined' || searchTerm == 'npr') {
        newsBroadcast = LatestNews.NPR;
    } else if (searchTerm == 'bbc') {
        newsBroadcast = LatestNews.BBC;
    }

    removeTracksAsync().then(function() {
        return addURIToQueue(newsBroadcast.uri, newsBroadcast.metadata, true, 1)
    }).then(function() { return player.coordinator.play() });
}

module.exports = function (api) {
    api.registerAction('news', readNews);
}