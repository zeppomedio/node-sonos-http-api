var metadataTemplate = '<DIDL-Lite xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:upnp="urn:schemas-upnp-org:metadata-1-0/upnp/" ' +
        'xmlns:r="urn:schemas-rinconnetworks-com:metadata-1-0/" xmlns="urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/">' +
        '<item id="00030020{uri}" restricted="true"><upnp:class>object.item.audioItem.musicTrack</upnp:class>' +
        '<desc id="cdudn" nameSpace="urn:schemas-rinconnetworks-com:metadata-1-0/">SA_RINCON3079_X_#Svc3079-0-Token</desc></item></DIDL-Lite>';
var https = require('https');
var Promise = require('bluebird');
var Levenshtein = require('levenshtein');
var SpotifyWebApi = require('spotify-web-api-node');
var client_secret = '394f8d0a4e0e475c831f47b14c0af5a3';
var spotifyApi;

/*
Song - will play the track found
Artist - will play this artists' top tracks
Playlist - will play the playlist
ALbum - will play the album.

If Type is not speciified, search for all types and take the one which matches
the closest. If multiple types match, then take the most popular.

URL format: /RoomName/spotify/{type}/{searchTerm}

*/
function spotify(player, values) {
  var type = values[0];
  var decodedSearchTerm = unescape(values[1].toLowerCase());
  spotifyAuth().then(function (responses){
    return spotifySearcher(type, decodedSearchTerm);
  }).then(function (responses){
    var tracks = responses[0];
    var actualType = responses[1];
    if (tracks.length > 0) {
      var firstTrack = tracks[0];
      player.coordinator.removeAllTracksFromQueue(function (error) {
         if (type == 'song' || type == 'track'){
          getRecommendationsForTrack(firstTrack).then(function(newTracks) {
              newTracks.unshift(firstTrack);
              queueAndPlay(player, newTracks);
          });
         } else {
           queueAndPlay(player, tracks);
         }
       });
    }
  });
}

function queueAndPlay(player, tracks) {
  if (! tracks.length > 0) { return; }

  firstTrackPlayer(player, tracks.shift()).then(function (result){
    var tracks_reverse = tracks.reverse();

    Promise.each(tracks_reverse, function(track) {
      return new Promise(function(resolve, reject) {
        var encodedSpotifyURI = encodeURIComponent(track.uri)
        var uri = 'x-sonos-spotify:' + encodedSpotifyURI + '?sid=9&flags=32&sn=1';
        var metadata = metadataTemplate.format({uri: encodedSpotifyURI});
        player.coordinator.addURIToQueue(uri, metadata, true, 2, function() {
          resolve();
        });
      });
    });
  });
}

function firstTrackPlayer(player, track) {
  return new Promise(function (resolve, reject) {
    var encodedSpotifyURI = encodeURIComponent(track.uri)
    var uri = 'x-sonos-spotify:' + encodedSpotifyURI + '?sid=9&flags=32&sn=1';
    var metadata = metadataTemplate.format({uri: encodedSpotifyURI});
    player.coordinator.addURIToQueue(uri, metadata, true, 1, function() {
      console.log("playing " + track.name);
      var queueTransportUri = 'x-rincon-queue:' + player.coordinator.uuid + '#0';
      var finalize = function() {
          player.coordinator.play();
          resolve();
      };

      if (player.coordinator.avTransportUri != queueTransportUri) {
          player.coordinator.setAVTransportURI(queueTransportUri, null, function() {
              console.log("New Transport URI Set!");
              finalize();
          });
      } else {
          finalize();
      }
      /*
      player.coordinator.nextTrack(function (error) {
        console.log("NEXT TRACK " + error);
        if (!error) {
          player.coordinator.play();
          resolve();
        }
        resolve();
      });
      */
    });
  });
}

function spotifySearcher(type, decodedSearchTerm) {
  return new Promise(function (resolve, reject) {
    //if we have a type, then only search that type
    //else search all types and return the one w/ the highest popularity
    if (type == 'song' || type == 'track') {
      getSong(decodedSearchTerm).then(function (responses){
        resolve([responses, type]);
      });
    }
    else if (type == 'artist') {
      getArtist(decodedSearchTerm).then(function (artist){
        return getTracksForArtist(artist);
      }).then(function (tracks){
        resolve([tracks, type]);
      });
    }
    else if (type == 'album'){
      getAlbum(decodedSearchTerm).then(function (album){
        return getTracksForAlbum(album);
      }).then (function (tracks){
        resolve([tracks, type]);
      });
    }
    else if (type == 'playlist') {
      getPlaylist(decodedSearchTerm).then(function (playlist){
        return getTracksForPlaylist(playlist);
      }).then (function (tracks){
        resolve([tracks, type]);
      });
    }
    else {
      searchAll(decodedSearchTerm).then(function (responses){
        resolve(responses); //includes type
      });
    }
  });
}

//returns [track]
function getSong(decodedSearchTerm) {
  return new Promise(function (resolve, reject) {
    spotifyApi.searchTracks(decodedSearchTerm, {market: 'US'})
    .then(function(data) {
      var tracks = data.body.tracks.items;
      resolve([tracks[0]]);
    }, function(err) {
      resolve([]);
    });
  });
}

//returns artist json object
function getArtist(decodedSearchTerm) {
  return new Promise(function (resolve, reject) {
    spotifyApi.searchArtists(decodedSearchTerm, {market: 'US'})
    .then(function(data) {
      resolve(data.body.artists.items[0]);
    }, function(err) {
      resolve(undefined);
    });
  });
}

//returns album json object
function getAlbum(decodedSearchTerm) {
  return new Promise(function (resolve, reject) {
    spotifyApi.searchAlbums(decodedSearchTerm, {market: 'US'})
    .then(function(data) {
      resolve(data.body.albums.items[0]);
    }, function(err) {
      resolve(undefined);
    });
  });
}

//returns playlist json object
function getPlaylist(decodedSearchTerm) {
  return new Promise(function (resolve, reject) {
    spotifyApi.searchPlaylists(decodedSearchTerm)
    .then(function(data) {
      resolve (data.body.playlists.items[0]);
    }, function(err) {
      resolve (undefined);
    });
  });
}

//returns [tracks]
function getTracksForArtist(artist){
  return new Promise(function (resolve, reject) {
    if (artist.uri){
      var artist_id = artist.uri.split(':')[2];
      spotifyApi.getArtistTopTracks(artist_id, 'US')
      .then(function(data) {
        resolve(data.body.tracks);
        }, function(err) {
        resolve([]);
      });
    }
    else {resolve ([])}
  });
}

//return [tracks]
function getTracksForPlaylist(playlist){
  return new Promise(function (resolve, reject) {
    if (playlist.uri){
      var id = playlist.id;
      var owner = playlist.owner.id;

      spotifyApi.getPlaylistTracks(owner, id)
      .then(function (data) {
        var tracks = [];
        for (var i = 0; i < data.body.items.length; i++){
          track = data.body.items[i].track;
          if (track.available_markets.indexOf('US') != -1){
            tracks.push(track);
          }
        }
        resolve(tracks);
        }, function(err) {
        resolve([]);
      });
    }
    else {resolve ([])}
  });
}

//returns a number
function getFollowersForPlaylist(playlist) {
 return new Promise(function (resolve, reject) {
    if (playlist.uri){
      var id = playlist.id;
      var owner = playlist.owner.id;

      spotifyApi.getPlaylist(owner, id)
      .then(function(data) {
        resolve(data.body.followers.total);
      }, function(err) {
        resolve(-1);
      });
    }
    else {
      resolve(-1);
    }
  });
}

//returns [tracks]
function getTracksForAlbum(album){
  return new Promise(function (resolve, reject) {
    if (album.uri){
      var album_id = album.uri.split(":")[2];
      spotifyApi.getAlbumTracks(album_id, {limit: 50})
      .then(function(data) {
        resolve(data.body.items);
      }, function(err) {
        resolve([]);
      });
    }
    else {
      resolve([]);
    }
  });
}

//returns [tracks]
function getRecommendationsForTrack(track) {
  return new Promise(function(resolve, reject) {
    spotifyApi.getRecommendations(
        {"seed_tracks": [track.id].join(","),
         "limit": 50}
    ).then(function(data) {
        resolve(data.body.tracks);
    }, function(err) {
        resolve(-1);
    });
  });
}


//returns a number
function getPopularityForAlbum(album) {
 return new Promise(function (resolve, reject) {
    if (album.uri){
      var album_id = album.uri.split(":")[2];
      spotifyApi.getAlbum(album_id)
      .then(function(data) {
        resolve(data.body.popularity);
      }, function(err) {
        resolve(-1);
      });
    }
    else {
      resolve(-1);
    }
  });
}

function searchAll(decodedSearchTerm){
  return new Promise(function (resolve, reject) {
    var searchSongPromise = getSong(decodedSearchTerm);
    var searchArtistPromise = getArtist(decodedSearchTerm);
    var searchAlbumPromise = getAlbum(decodedSearchTerm);
    var searchPlaylistPromise = getPlaylist(decodedSearchTerm);


    Promise.all([searchSongPromise, searchArtistPromise, searchAlbumPromise, searchPlaylistPromise]).then(function(responses) {
      var track = responses[0][0];
      var artist = responses[1];
      var album = responses[2];
      var playlist = responses[3];

      if (album){
        var albumPopularityPromise = getPopularityForAlbum(album);
      }
      if (playlist) {
        var playlistFollowersPromise = getFollowersForPlaylist(playlist);
      }

      Promise.all([albumPopularityPromise, playlistFollowersPromise]).then(function(responses) {
        var albumPopularity = responses[0];
        var playlistFollowers = responses[1];

        info_array = []

        var winner_type = undefined;
        if (track){
          var songName = track.name.toLowerCase();
          console.log("Song Name: " + songName);
          songPopularity = track.popularity;
          songDistance = new Levenshtein(decodedSearchTerm, songName).distance;
          info_array.push(['song', songDistance, songPopularity]);
        }
        if (artist){
          var artistName = artist.name.toLowerCase();
          artistName = artistName.replace("&", "and");
          if (artistName.indexOf(decodedSearchTerm.toLowerCase()) != -1) {
            winner_type = 'artist';
          }
          console.log("Artist Name: " + artistName);
          artistPopularity = artist.popularity;
          artistDistance = new Levenshtein(decodedSearchTerm, artistName).distance;
          info_array.push(['artist', artistDistance, artistPopularity]);
        }
        if (album){
          var albumName = album.name.toLowerCase();
          console.log("Album name: " + albumName);
          albumDistance = new Levenshtein(decodedSearchTerm, albumName).distance;
          info_array.push(['album', albumDistance, albumPopularity]);
        }
        if (playlist){
          var playlistName = playlist.name.toLowerCase();
          console.log("Playlist Name: " + playlistName);
          playlistDistance = new Levenshtein(decodedSearchTerm, playlistName).distance;
          playlistPopularity = playlistFollowers / 1000;
          info_array.push(['playlist', playlistDistance, playlistPopularity]);
        }

        if (!winner_type) {
          winner_type = getWinner(info_array, decodedSearchTerm.length);
        }
        console.log (winner_type + " wins");

        switch(winner_type) {
          case "song":
            resolve([[track], winner_type]);
            break;
          case "artist":
            getTracksForArtist(artist).then(function(responses) {
              resolve([responses, winner_type]);
            })
            break;
          case "album":
            getTracksForAlbum(album).then(function(responses) {
              resolve([responses, winner_type]);
            })
            break;
          case "playlist":
            getTracksForPlaylist(playlist).then(function(responses) {
              resolve([responses, winner_type]);
            })
            break;
          default:
            resolve([[], undefined]);
        }
      });
    });
  });
}

function getWinner(info_array, searchTermLength) {
  console.log(info_array);
  var distance_sort = info_array.sort(distanceSort);

  if ((distance_sort[1][1] - distance_sort[0][1]) > (searchTermLength / 10)) {
    console.log("clear winner");
    return distance_sort[0][0];
  }
  else {
    //how many to consider?
    for (var i = 1; i < distance_sort.length; i++) {
      if ((distance_sort[i][1] - distance_sort[i-1][1]) > (searchTermLength / 10)){
        break;
      }
    }
    //just those we want to consider for popularity
    var popularity_sort = distance_sort.slice(0,i);
    popularity_sort.sort(popularitySort);
    return popularity_sort[0][0];
  }
}

//return spotifyAPI object w/ token
function spotifyAuth() {
  return new Promise(function (resolve, reject) {
    var client_id = 'e9bccd1692554d81a05b837806b4ab4e';

    spotifyApi = new SpotifyWebApi({
      clientId: client_id,
      clientSecret: client_secret
    });

    spotifyApi.clientCredentialsGrant()
      .then(function(data) {
        console.log('The access token expires in ' + data.body['expires_in']);
        console.log('The access token is ' + data.body['access_token']);
        resolve(spotifyApi);
        // Save the access token so that it's used in future calls
        spotifyApi.setAccessToken(data.body['access_token']);
      }, function(err) {
        console.log('Something went wrong when retrieving an access token', err);
        resolve(undefined);
      })
  });
}

function distanceSort(a,b){
  return a[1]-b[1];
}
function popularitySort(a,b){
  return b[2]-a[2];
}

module.exports = function (api) {
  api.registerAction('spotify', spotify);
}