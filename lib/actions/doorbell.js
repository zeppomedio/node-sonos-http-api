var Promise = require('bluebird');
var port;
var chimeVolume = 40;

var playersToGroup = ["Kitchen", "Gallery", "Bedroom", "Office"];

function doorbell(player, values) {
    var setAVTransportAsync = Promise.promisify(player.coordinator.setAVTransportURI, {context: player.coordinator});
    var applyPresetAsync = Promise.promisify(player.discovery.applyPreset, {context: player.discovery});
    var uri = "http://" + player.discovery.localEndpoint + ":" + port + "/chime.m4a";
    var currentStates = saveAllStates(player);
    var presetToApply = makePreset(uri);
    applyPresetAsync(presetToApply).then(function() {
        // TODO would be nice to listen to the
        // transport event instead
        return Promise.delay(2000);
    }).then(function() {
        Promise.each(currentStates, function(state) {
            return applyPresetAsync(state);
        });
    });
}

function makePreset(uri) {
    var preset = {
        "state": "playing",
        "playMode": "NORMAL",
        "players": [],
        "uri": uri
    }
    playersToGroup.forEach(function(playerName) {
        preset.players.push({
            "roomName": playerName,
            "volume": chimeVolume
        });
    });
    return preset;
}


function saveAllStates(player) {
    var discovery = player.discovery;
    var backupPresets = [];
    discovery.getZones().forEach(function (zone) {
        console.log("ZONE !" + zone);
        var player = discovery.getPlayerByUUID(zone.uuid);
        var state = player.getState();
        var preset = {
            'players': [
                { 'roomName': player.roomName, 'volume': state.volume }
            ],
            'state': player.state.currentState,
            'uri': player.avTransportUri,
            'playMode': 'NORMAL',
            'trackNo': state.trackNo,
            'elapsedTime': state.elapsedTime
        }


        zone.members.forEach(function (p) {
            if (player.uuid != p.uuid)
                preset.players.push({ roomName: p.roomName, volume: p.state.volume });
        });

        backupPresets.push(preset);

    });

    return backupPresets;
}

module.exports = function (api) {
    api.registerAction('doorbell', doorbell);
    port = api.getPort();
}

/*
var SonosDiscovery = require('sonos-discovery');
var discovery = new SonosDiscovery({});
setTimeout(function() {
    var player = discovery.getPlayer("Kitchen");
    port = 5005;
    doorbell(player);
}, 1000);
*/
