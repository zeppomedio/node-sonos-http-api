var metadataTemplate = '<DIDL-Lite xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:upnp="urn:schemas-upnp-org:metadata-1-0/upnp/" ' +
        'xmlns:r="urn:schemas-rinconnetworks-com:metadata-1-0/" xmlns="urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/">' +
        '<item id="00030020{uri}" restricted="true"><upnp:class>object.item.audioItem.musicTrack</upnp:class>' +
        '<desc id="cdudn" nameSpace="urn:schemas-rinconnetworks-com:metadata-1-0/">SA_RINCON3079_X_#Svc3079-0-Token</desc></item></DIDL-Lite>';
var Promise = require('bluebird');

function queueAndPlayStation(player, station) {
    return setTransportURI(player, station.getURI(), station.getMetadata()).then(function() { return player.coordinator.play() });
}

function queueAndPlayItem(player, item) {
    return queue(player, item).then(function() { return play(player) });
}

function queue(player, item) {
    // TODO would be nice to do this elsewhere, beforehand
    var addURIToQueue = Promise.promisify(player.coordinator.addURIToQueue, {context: player.coordinator});

    var uriInfo = item.getURI();
    var metadata = item.getMetadata();
    return addURIToQueue(uriInfo, metadata, true, 1);
}

function play(player) {
    if (player.coordinator.avTransportUri != queueTransportUri) {
        var queueTransportUri = 'x-rincon-queue:' + player.coordinator.uuid + '#0';
        return setTransportURI(player, queueTransportUri, null).then(function() {
            player.coordinator.play();
        });
    } else {
        return player.coordinator.play();
    }
}

function setTransportURI(player, transportURI, metadata) {
    var setAVTransportAsync = Promise.promisify(player.coordinator.setAVTransportURI, {context: player.coordinator});
    return setAVTransportAsync(transportURI, metadata);
}

module.exports.queueAndPlayItem = queueAndPlayItem;
module.exports.queueAndPlayStation = queueAndPlayStation;
