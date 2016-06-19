/*
 * TODOs
 *
 *  - feed station names to voice recognizer
 *  - voice command to read back available stations
 *  - store household ID in Config
 *
 *  x tell sonos to STOP in all rooms
 *  x write token/key back to the Config
 *  x podcast support
 *  x individual track support
 */

var path = require('path');
var SMAPICommon = require(path.resolve( __dirname, "../smapicommon.js" ) );
var GooglePlayService = new SMAPICommon.SMAPIService({
    "smapiEndpoint": "https://mclients.googleapis.com/music/sonos/wsf/smapi",
    "authConfigPath": path.resolve(__dirname, "../../googleplaysettings.json"),
    "serviceId": "151",
    "presentationMap": {
        "artists": "ARTIST",
        "albums": "ALBUM",
        "tracks": "TRACK",
        "stations": "CURATED_STATION",
        "podcasts": "PODCAST_SERIES"
    },
    "albumTypeMap": {
        "topTracks": "Top Songs",
    },
    "trackOptions": {
        "prefix": "x-sonos-http:",
        "flags": "32",
        "extension": ".mp3",
        "typeId": "00030020"
    }
})

function googlePlay(player, values) {
    GooglePlayService.searchAndPlay(player, values);
}

module.exports = function (api) {
    api.registerAction('googleplay', googlePlay);
}


/** EXAMPLES **/
/*
{"token":"ya29.CjMGAxQF0BxRibzWoGjXaBWRY6ZP5iKDbG2QnQBA-HsgY7VpZnLZVYo0fpYEzvXymSCv4OE","key":"Ci0xL0gwZHBoWTctb1o4R0tEVUt0UlA2dEFWTldHbzVwSGFoRzlFbl9LakFOZWMQ1d_wuMsq", "deviceId": "00-0E-58-D6-56-1E:A", "householdId": "Sonos_JpRt9G7QxxkS5NFnhf2hcPoPBZ", "tokenId": "SA_RINCON38663_X_#Svc38663-0-Token"}
*/


var SonosDiscovery = require('sonos-discovery');
var discovery = new SonosDiscovery({});
setTimeout(function() {
    var office = discovery.getPlayer("Office");
    //googlePlay(office, ['undefined', "junior boys radio"]);
    //googlePlay(office, ["album", "hamilton cast"]);
    //googlePlay(office, ["podcast", "reply all"]);
    //googlePlay(office, ["station", "cool air warm heart"]);
    //googlePlay(office, ["track", "henrietta indiana"]);
}, 1000);