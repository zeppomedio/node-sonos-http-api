var path = require('path');
var SMAPICommon = require(path.resolve( __dirname, "../smapicommon.js" ) );
var SpotifyService = new SMAPICommon.SMAPIService({
    "smapiEndpoint": "https://spotify-v4.ws.sonos.com/smapi",
    "authConfigPath": path.resolve(__dirname, "../../spotifysettings.json"),
    "serviceId": "12",
    "presentationMap": {
        "artists": "artist",
        "albums": "album",
        "tracks": "track",
        "playlists": "playlist"
    },
    "albumTypeMap": {
        "topTracks": "Top Tracks",
    },
    "trackOptions": {
        "prefix": "x-sonos-spotify:",
        "flags": "8224",
        "typeId": "00032020"
    }
})

function spotify(player, values) {
    SpotifyService.searchAndPlay(player, values);
}

module.exports = function (api) {
    api.registerAction('spotify', spotify);
}


/** EXAMPLES **/

var SonosDiscovery = require('sonos-discovery');
var discovery = new SonosDiscovery({});
setTimeout(function() {
    var office = discovery.getPlayer("Office");
    //googlePlay(office, ['undefined', "junior boys radio"]);
    //spotify(office, ["album", "hamilton cast"]);
    // spotify(office, ["artist", "josh ritter"]);
    //googlePlay(office, ["podcast", "reply all"]);
    //googlePlay(office, ["station", "cool air warm heart"]);
    spotify(office, ["track", "henrietta indiana"]);
}, 1000);