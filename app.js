var config = require(process.argv[2]);
var irc = require('irc');
var maxmind = require('maxmind');
var dns = require('dns');
var fs = require('fs');
var time = require('time');
var http = require('http');
var https = require('https');
var request = require('request');
var format = require('format-number');

// Load the MaxMind GeoIP databases
var cityLookup = maxmind.openSync('./GeoLite2-City.mmdb', { watchForUpdates: true });
var asnLookup = maxmind.openSync('./GeoLite2-ASN.mmdb', { watchForUpdates: true });

// Set up IRC client
var client = new irc.Client(config.irc.host, config.irc.nickname, {
  userName: config.irc.username,
  realName: config.irc.realname
});

// Global Variables
var oper = false;
var nickCol = false;
var channelList = [];
var adminList = [];

// Read files into memory
fs.readFile('./' + config.name + '.channels', function(err, data) {
  if(err) throw err;

  channelList = JSON.parse(data);
});

fs.readFile('./' + config.name + '.admins', function(err, data) {
  if(err) throw err;

  adminList = JSON.parse(data);
});

// IRC connecton checker
setInterval(function() {
  client.send('PONG', 'empty');
}, 5*60*1000);

client.addListener('registered', function(message) {
  console.log("Connected to " + message.server + "!");

  if(config.irc.nickserv !== "") {
		client.say('NickServ', 'IDENTIFY ' + config.irc.nickserv);
	}

  if(config.irc.operName !== "" && config.irc.operPass != "") {
		client.send('OPER', config.irc.operName, config.irc.operPass);
  }

  if(config.irc.modes !== "") {
    client.send('MODE', client.nick, config.irc.modes);
  }

  if(client.nick !== config.irc.nickname) {
    console.log("Nick already in use");
    nickCol = true;
    if(config.irc.nickserv !== "") {
      client.say('NickServ', 'GHOST', config.irc.nickname, config.irc.nickserv);
      setTimeout(function() {
        client.send('NICK', config.irc.nickname);

        setTimeout(function() {
          if(client.nick !== config.irc.nickname) {
            console.log("Could not regain control of nickname");
          } else {
            nickCol = false;
          }
        }, 2000);
      }, 2000);
    }
  }

  if(!config.debug) {
    // Join all channels
    channelList.forEach(function(item) {
      client.join(item);
    });
  } else {
    client.join("#you10");
  }
});

client.addListener('join', function(channel, nick, message) {
	if(nick == client.nick) {
		console.log("Joined " + channel);
	}
});

client.addListener('kick', function(channel, nick, by, reason, message) {
  if(nick == client.nick) {
    console.log("Kicked from " + channel + " rejoining after 5 seconds");

    setTimeout(function() {
      client.say('ChanServ', 'UNBAN', channel);
      client.join(channel);
    }, 5000);
  }
});

client.addListener('message#', function(nick, to, text, message) {
  text = text.trim();
  var split = text.split(' ');
  var command = split[0].toLowerCase();

  if(split.length > 1) {
    var params = text.substring(text.indexOf(' ') + 1).split(' ');
  }

  if(command === "&dns") {
    if(typeof params !== "undefined" && params !== null) {
      console.log(nick + " did a DNS lookup for " + params[0]);

      dnsLookup(to, params);
    } else {
      client.say(to, irc.colors.wrap('light_red', 'Syntax: &dns <Domain/IP address> <Limit for domain. Max = 5>'));
    }
  } else if(command === "&proxy") {
    if(typeof params !== "undefined" && params !== null) {
      if(maxmind.validate(params[0])) {
        console.log(nick + " did a proxy check for " + params[0]);

        https.request({ host: 'check.getipintel.net', path: '/check.php?ip=' + encodeURIComponent(params[0]) + '&contact=you10@sa-irc.com' }, function(response) {
          var data = '';
          response.setEncoding('utf8');
          response.on('data', function(chunk) {
            data += chunk;
          });

          response.on('end', function() {
            if(data === '-2') {
              client.say(to, irc.colors.wrap('light_red', 'Error: IPv6 is not supported for this command'));
            } else if(data === '-3') {
              client.say(to, irc.colors.wrap('light_red', 'Error: IP address entered is unroutable'));
            } else if(data < 0) {
              client.say(to, irc.colors.wrap('light_red', 'Error: The result was ' + data));
            } else {
              client.say(to, irc.colors.wrap('dark_green', 'The probability that the IP ') + irc.colors.wrap('dark_red', params[0] + " ") + irc.colors.wrap('dark_green', 'is a proxy/vpn is ') + irc.colors.wrap('dark_red', data));
            }
          });
        }).end();
      } else {
        client.say(to, irc.colors.wrap('light_red', 'Error: Not a valid IP address'));
      }
    } else {
      client.say(to, irc.colors.wrap('light_red', 'Syntax: &proxy <IP address>'));
    }
  } else if(command === "&timezone") {
    if(typeof params !== "undefined" && params !== null) {
      console.log(nick + " did a timezone lookup for " + params[0]);

      timezoneLookup(to, params);
    } else {
      client.say(to, irc.colors.wrap('light_red', 'Syntax: &timezone <IP address>'));
    }
  } else if(command === "&time") {
    if(typeof params !== "undefined" && params !== null) {
      https.request({ host: 'maps.googleapis.com', path: '/maps/api/geocode/json?key=' + config.googlekey + '&address=' + encodeURIComponent(params.join(' ')) }, function(response) {
        var data = '';
        response.setEncoding('utf8');
        response.on('data', function(chunk) {
          data += chunk;
        });

        response.on('end', function() {
          var location = JSON.parse(data);

          if(location.status === 'OK') {
            https.request({ host: 'maps.googleapis.com', path: '/maps/api/timezone/json?key=' + config.googlekey + '&timestamp=' + time.time() + '&location=' + location.results[0].geometry.location.lat + ',' + location.results[0].geometry.location.lng }, function(response) {
              var data = '';
              response.setEncoding('utf8');
              response.on('data', function(chunk) {
                data += chunk;
              });

              response.on('end', function() {
                var timezone = JSON.parse(data);

                if(timezone.status === 'OK') {
                  var now = new time.Date();
                  now.setTimezone(timezone.timeZoneId);
                  client.say(to, irc.colors.wrap('dark_green', 'Location: ') + irc.colors.wrap('dark_red', location.results[0].formatted_address) +  irc.colors.wrap('light_red', ' => ') + irc.colors.wrap('dark_green', 'Timezone: ') + irc.colors.wrap('dark_red', timezone.timeZoneName) + irc.colors.wrap('orange', ' (' + timezone.timeZoneId + ')') + irc.colors.wrap('dark_green', ' Current Time: ') + irc.colors.wrap('dark_red', now.toString()));
                } else {
                  client.say(to, irc.colors.wrap('light_red', 'Error: Could not get time information'));
                }
              });
            }).end();
          } else if(location.status === 'ZERO_RESULTS') {
            client.say(to, irc.colors.wrap('light_red', 'Error: Location not found'));
          } else {
            client.say(to, irc.colors.wrap('light_red', 'Error: Could not get location information'));
          }
        });
      }).end();
    } else {
      client.say(to, irc.colors.wrap('light_red', 'Syntax: &time <Location>'));
    }
  } else if(command === "&weather") {
    if(typeof params !== "undefined" && params !== null) {
      console.log(nick + " did a weather lookup for "+ params.join(' '));

      https.request({ host: 'api.openweathermap.org', path: '/data/2.5/weather?appid=' + config.weatherkey + '&q=' + encodeURIComponent(params.join(' ')) }, function(response) {
        var data = '';
        response.setEncoding('utf8');
        response.on('data', function(chunk) {
          data += chunk;
        });

        response.on('end', function() {
          var weather = JSON.parse(data);

          if(weather.cod == 200) {
            var output = '';
            var direction = '';
            if(weather.wind.deg > 22.5 && weather.wind.deg <= 67.5) {
							direction = "Northeast";
						} else if(weather.wind.deg > 67.5 && weather.wind.deg <= 112.5) {
							direction = "East";
						} else if(weather.wind.deg > 112.5 && weather.wind.deg <= 157.5) {
							direction = "Southeast";
						} else if(weather.wind.deg > 157.5 && weather.wind.deg <= 202.5) {
							direction = "South";
						} else if(weather.wind.deg > 202.5 && weather.wind.deg <= 247.5) {
							direction = "Southwest";
						} else if(weather.wind.deg > 247.5 && weather.wind.deg <= 292.5) {
							direction = "West";
						} else if(weather.wind.deg > 292.5 && weather.wind.deg <= 337.5) {
							direction = "Northwest";
						} else {
              direction = "North";
            }

            output += irc.colors.wrap('dark_green', 'Location: ');
            if(weather.name !== "") {
              output += irc.colors.wrap('dark_red', weather.name + ', ');
            }
            output += irc.colors.wrap('dark_red', weather.sys.country);

            output += irc.colors.wrap('light_red', ' => ');

            output += irc.colors.wrap('dark_green', 'Weather: ');
            weather.weather.forEach(function(item) {
              output += irc.colors.wrap('dark_red', item.main);
              output += irc.colors.wrap('orange', " (" + item.description + "), ");
            });
            output = output.substring(0, output.length - 3);

            output += irc.colors.wrap('dark_green', ' Temperature: ');
            output += irc.colors.wrap('dark_red', Math.round(weather.main.temp - 273.15) + "C ");
            output += irc.colors.wrap('orange', '(' + Math.round(weather.main.temp_min - 273.15) + 'C Min ' + Math.round(weather.main.temp_max - 273.15) + 'C Max)');

            output += irc.colors.wrap('dark_green', ' Humidity: ');
            output += irc.colors.wrap('dark_red', weather.main.humidity + "%");

            output += irc.colors.wrap('dark_green', ' Wind: ');
            output += irc.colors.wrap('dark_red', weather.wind.speed + "m/s");
            output += irc.colors.wrap('orange', " (" + direction + ")");

            if(typeof weather.wind.gust !== "undefined" && weather.wind.gust !== null) {
              output += irc.colors.wrap('dark_green', " gusts of ");
              output += irc.colors.wrap('dark_red', weather.wind.gust + "m/s");
            }

            output += irc.colors.wrap('dark_green', ' Cloud cover: ');
            output += irc.colors.wrap('dark_red', weather.clouds.all + "%");

            if(weather.sys.sunrise < time.time() && weather.sys.sunset > time.time()) {
              output += irc.colors.wrap('dark_green', ' Sunset: ');
              output += irc.colors.wrap('dark_red', new time.Date(weather.sys.sunset * 1000).setTimezone("UTC").toTimeString());
            } else {
              output += irc.colors.wrap('dark_green', ' Sunrise: ');
              output += irc.colors.wrap('dark_red', new time.Date(weather.sys.sunrise * 1000).setTimezone("UTC").toTimeString());
            }

            client.say(to, output);
          } else {
            client.say(to, irc.colors.wrap('light_red', 'Error: ' + weather.message));
          }
        });
      }).end();
    } else {
      client.say(to, irc.colors.wrap('light_red', 'Syntax: &weather <Location>'));
    }
  } else if(command === "&forecast") {
    // TODO: forcast code

    client.say(to, "Command coming soon");
  } else if(command === "&metar") {
    if(typeof params !== "undefined" && params !== null) {
      if(params[0].length == 4) {
        request.get('http://metar.vatsim.net/' + encodeURIComponent(params[0]), function(err, response, body) {
          if(err) {
            client.say(to, irc.colors.wrap('light_red', 'Error: Could not get metar data'));
            console.log(err);
            return;
          }
          client.say(to, irc.colors.wrap('dark_green', body.trim()));
        });
      } else {
        client.say(to, irc.colors.wrap('light_red', 'Error: ICAO code must be 4 characters'));
      }
    } else {
      client.say(to, irc.colors.wrap('light_red', 'Syntax: &metar <ICAO Code>'));
    }
  } else if(command === "&translate") {
    // TODO: translate code

    client.say(to, "Command coming soon");
  } else if(command === "&isup") {
    // TODO: isup code from multiple locations

    client.say(to, "Command coming soon");
  } else if(command === "&trace") {
    // TODO: traceroute code

    client.say(to, "Command coming soon");
  } else if(command === "&ping") {
    client.say(to, "Pong!");
  } else if(command === "&youtube" || command === "&yt") {
    if(typeof params !== "undefined" && params !== null) {
      youtubeLookup(to, params[0]);
    } else {
      client.say(to, irc.colors.wrap('light_red', 'Syntax: &youtube <URL>'));
    }
  } else if(command.indexOf("youtube.com/watch?v=") > -1) {
    var ourCommand = split[0];
    var vidIdLoc = ourCommand.indexOf("v=");
    var vidId = ourCommand.substring(vidIdLoc + 2);
    var vidIdEnd = vidId.indexOf("&");

    if(vidIdEnd > -1) {
      vidId = vidId.substring(0, vidIdEnd);
    }

    youtubeLookup(to, vidId);
  } else if(command.indexOf("youtu.be/") > -1) {
    var ourCommand = split[0];
    var vidIdLoc = ourCommand.indexOf("youtu.be/");
    var vidId = ourCommand.substring(vidIdLoc + 9);

    youtubeLookup(to, vidId);
  } else if(command === "&channels" && adminList.indexOf(message.host) > -1) {
    if(typeof params !== "undefined" && params !== null) {
      if(params[0].toLowerCase() == "list") {
        client.say(to, irc.colors.wrap('dark_green', "Channel List: " + JSON.stringify(channelList)));
      } else if(params[0].toLowerCase() == "add") {
        if(params.length == 2) {
          // TODO: check if actually a channel

          if(channelList.indexOf(params[1].toLowerCase()) == -1) {
            channelList.push(params[1].toLowerCase());
            client.join(params[1].toLowerCase());

            client.say(to, irc.colors.wrap('dark_green', 'Channel added to channel list'));

            fs.writeFile('./' + config.name + '.channels', JSON.stringify(channelList), function(err) {
							if (err) throw err;
						});
          } else {
            client.say(to, irc.colors.wrap('light_red', 'Channel already in the channel list'));
          }
        } else {
          client.say(to, irc.colors.wrap('light_red', 'Syntax: &channels Add <Channel>'));
        }
      } else if(params[0].toLowerCase() == "remove" || params[0].toLowerCase() == "del") {
        if(params.length == 2) {
          if(channelList.indexOf(params[1].toLowerCase()) == -1) {
            client.say(to, irc.colors.wrap('light_red', 'Channel not in the channel list'));
          } else {
            channelList.remove(channelList.indexOf(params[1].toLowerCase()));
            client.part(params[1].toLowerCase(), "Channel removed from YouBot");

            client.say(to, irc.colors.wrap('dark_green', 'Channel removed from channel list'));

            fs.writeFile('./' + config.name + '.channels', JSON.stringify(channelList), function(err) {
							if (err) throw err;
						});
          }
        } else {
          client.say(to, irc.colors.wrap('light_red', 'Syntax: &channels Remove <Channel>'));
        }
      } else {
        client.say(to, irc.colors.wrap('light_red', 'Syntax: &channels [Add/Remove/List] <Args>'));
      }
    } else {
      client.say(to, irc.colors.wrap('light_red', 'Syntax: &channels [Add/Remove/List] <Args>'));
    }
  } else if(command === "&admins" && adminList.indexOf(message.host) > -1) {
    if(typeof params !== "undefined" && params !== null) {
      if(params[0].toLowerCase() === "list") {
        client.say(to, irc.colors.wrap('dark_green', "Admin List: " + JSON.stringify(adminList)));
      } else if(params[0].toLowerCase() == "add") {
        if(params.length == 2) {
          if(adminList.indexOf(params[1]) == -1) {
            adminList.push(params[1]);

            client.say(to, irc.colors.wrap('dark_green', 'Host added to admin list'));

            fs.writeFile('./' + config.name + '.admins', JSON.stringify(adminList), function(err) {
							if (err) throw err;
						});
          } else {
            client.say(to, irc.colors.wrap('light_red', 'Host already in the admin list'));
          }
        } else {
          client.say(to, irc.colors.wrap('light_red', 'Syntax: &admins Add <Host>'));
        }
      } else if(params[0].toLowerCase() == "remove" || params[0].toLowerCase() == "del") {
        if(params.length == 2) {
          if(adminList.indexOf(params[1]) == -1) {
            client.say(to, irc.colors.wrap('light_red', 'Host not in the admin list'));
          } else {
            adminList.remove(adminList.indexOf(params[1]));

            client.say(to, irc.colors.wrap('dark_green', 'Host removed from admin list'));

            fs.writeFile('./' + config.name + '.admins', JSON.stringify(adminList), function(err) {
							if (err) throw err;
						});
          }
        } else {
          client.say(to, irc.colors.wrap('light_red', 'Syntax: &admins Remove <Host>'));
        }
      } else {
        client.say(to, irc.colors.wrap('light_red', 'Syntax: &admins [Add/Remove/List] <Args>'));
      }
    } else {
      client.say(to, irc.colors.wrap('light_red', 'Syntax: &admins [Add/Remove/List] <Args>'));
    }
  }

  if(split.length > 4 && text.includes(client.nick) && oper) {
    var users = client.chans[to.toLowerCase()].users;

    if(users[nick] === '') {
      var nickCount = 0;

      split.forEach(function(item) {
        if(item.replace(',', '') in users) {
          nickCount++;
        }
      });

      if(nickCount > 4) {
        console.log('Killing ' + nick + " for mass highlight spam");

        client.send('KILL', nick, 'Mass Highlight Spam');
      }
    }
  }
});

client.on('raw', function(message) {
  if(message.rawCommand === '381') {
    console.log('IRC Operator functions enabled');

    oper = true;
  }
});

// Error handling
client.on('error', function(message) {
  console.log('IRC Error: ' + JSON.stringify(message));
});

process.on('uncaughtException', function(err) {
  console.log("Proccess uncaught error: " + err);
});

// Functions
function dnsLookup(channel, params) {
  if(maxmind.validate(params[0])) {
    ipLookup(channel, params[0]);
  } else {
    if(params.length > 1) {
      if(!isNaN(parseInt(params[1])) && parseInt(params[1]) < 6) {
        domainLookup(channel, params[0], params[1]);
      } else {
        client.say(channel, irc.colors.wrap('light_red', 'Error: No number was entered or it was greater than 5'));
      }
    } else {
      domainLookup(channel, params[0], 1);
    }
  }
}

function ipLookup(channel, ip, domain = "") {
  var ipInfo = [];
  ipInfo["ip"] = ip;

  dns.reverse(ip, function(err, domains) {
    if(err && err.code != dns.NOTFOUND) {
      ipInfo['rDNS'] = "Unknown";

      console.log("Error getting rDNS for " + ip + " " + err.code);
    } else {
      if(typeof domains !== 'undefined' && typeof domains[0] !== 'undefined') ipInfo['rDNS'] = domains[0];
  		else ipInfo['rDNS'] = "None";
    }

    var ipLocation = cityLookup.get(ip);
    var ipASN = asnLookup.get(ip);

    if(typeof ipLocation === 'undefined' || ipLocation === null) {
      client.say(channel, irc.colors.wrap('light_red', 'Error: No geodata found for the IP ' + ip));
      return;
    }

    if(typeof ipLocation.city === 'undefined' || ipLocation.city === null) {
      ipInfo['city'] = "Unknown";
    } else {
      ipInfo['city'] = ipLocation.city.names.en;
    }

    if(typeof ipLocation.subdivisions === 'undefined' || ipLocation.subdivisions === null) {
      ipInfo['subdivision'] = "Unknown";
    } else {
      ipInfo['subdivision'] = ipLocation.subdivisions[0].names.en;
    }

    if(typeof ipLocation.country === 'undefined' || ipLocation.country === null) {
      ipInfo['country'] = "Unknown";
      ipInfo['countryISO'] = "Unknown";
    } else {
      ipInfo['country'] = ipLocation.country.names.en;
      ipInfo['countryISO'] = ipLocation.country.iso_code;
    }

    if(typeof ipASN === 'undefined' || ipASN === null) {
      ipInfo['autonomous_system_number'] = "Unknown";
      ipInfo['autonomous_system_organization'] = "Unknown";
    } else {
      ipInfo['autonomous_system_number'] = ipASN.autonomous_system_number;
      ipInfo['autonomous_system_organization'] = ipASN.autonomous_system_organization;
    }

    dnsOutput(channel, domain, ipInfo);
  });
}

function domainLookup(channel, domain, limit) {
  dns.resolve4(domain, function(err, addresses) {
    if(err) {
			if(err.code != dns.NODATA) client.say(channel, irc.colors.wrap('light_red', 'Error: ' + err.code));
			return;
		}

    var count = 0;
    addresses.every(function(address) {
      count++;
			if(count > limit) return false;

      ipLookup(channel, address, domain);

      return true;
    });
  });

  dns.resolve6(domain, function(err, addresses) {
    if(err) {
      return;
    }

    var v6Count = 0;
    addresses.every(function(address) {
      v6Count++;
      if(v6Count > limit) return false;

      ipLookup(channel, address, domain);

      return true;
    });
  });
}

function dnsOutput(channel, domain, ipInfo) {
  var output = "";

  if(domain !== "") {
    output += irc.colors.wrap('dark_green', 'Domain: ') + irc.colors.wrap('dark_red', domain + " ") + irc.colors.wrap('light_red', '=> ');
  }

  output += irc.colors.wrap('dark_green', 'IP: ') + irc.colors.wrap('dark_red', ipInfo.ip + " ");
  output += irc.colors.wrap('dark_green', 'rDNS: ') + irc.colors.wrap('dark_red', ipInfo.rDNS + " ");
  output += irc.colors.wrap('dark_green', 'Location: ');

  if(ipInfo.city !== "Unknown") {
    output += irc.colors.wrap('dark_red', ipInfo.city + ", ");
  }

  if(ipInfo.subdivision !== "Unknown") {
     output += irc.colors.wrap('dark_red', ipInfo.subdivision + ", ");
  }

  output += irc.colors.wrap('dark_red', ipInfo.country);

  if(ipInfo.countryISO != "Unknown") {
    output += irc.colors.wrap('orange', " (" + ipInfo.countryISO +") ");
  }

  output += irc.colors.wrap('dark_green', 'ASN: ');

  if(ipInfo.autonomous_system_number != "Unknown") {
    output += irc.colors.wrap('dark_red', "AS" + ipInfo.autonomous_system_number + " ");
  }

  output += irc.colors.wrap('dark_red', ipInfo.autonomous_system_organization + " ");
  output += irc.colors.wrap('dark_green', 'BGP: ') + irc.colors.wrap('dark_red', "http://bgp.he.net/ip/" + ipInfo.ip + " ");

  client.say(channel, output);
}

function timezoneLookup(channel, params) {
  if(maxmind.validate(params[0])) {
    var ipLocation = cityLookup.get(params[0]);

    if(typeof ipLocation.location.time_zone === 'undefined' || ipLocation.location.time_zone === null) {
      client.say(channel, irc.colors.wrap('light_red', 'Error: No data available for this IP address'));
    } else {
      var now = new time.Date();
      now.setTimezone(ipLocation.location.time_zone);
      client.say(channel, irc.colors.wrap('dark_green', 'IP: ') + irc.colors.wrap('dark_red', params[0] + " ") + irc.colors.wrap('light_red', '=> ') + irc.colors.wrap('dark_green', 'Timezone: ') + irc.colors.wrap('dark_red', ipLocation.location.time_zone) + irc.colors.wrap('dark_green', ' Current Time: ') + irc.colors.wrap('dark_red', now.toString()));
    }
  } else {
    client.say(channel, irc.colors.wrap('light_red', 'Error: Not a valid IP address'));
  }
}

function youtubeLookup(channel, videoId) {
  request.get('https://www.googleapis.com/youtube/v3/videos?key=' + config.googlekey + '&part=snippet%2Cstatistics&id=' + videoId, function(err, response, body) {
    if(err) {
      client.say(channel, irc.colors.wrap('light_red', 'Error: Could not look up video'));
      console.log(err);
      return;
    }

    var youtube = JSON.parse(body);

    if(youtube.items.length == 0) {
      client.say(channel, irc.colors.wrap('light_red', 'Error: Video not found'));
    } else {
      client.say(channel, irc.colors.wrap('dark_green', "Title: ") + irc.colors.wrap('dark_red', youtube.items[0].snippet.title) + irc.colors.wrap('dark_green', " Channel: ") + irc.colors.wrap('dark_red', youtube.items[0].snippet.channelTitle) + irc.colors.wrap('dark_green', " Views: ") + irc.colors.wrap('dark_red', format()(youtube.items[0].statistics.viewCount)) + irc.colors.wrap('dark_green', " Rating: ") + irc.colors.wrap('light_green', format()(youtube.items[0].statistics.likeCount)) + irc.colors.wrap('orange', "/") + irc.colors.wrap('light_red', format()(youtube.items[0].statistics.dislikeCount)) + irc.colors.wrap('dark_green', " URL: ") + irc.colors.wrap('dark_red', 'https://youtu.be/' + videoId));
    }
  });
}

// Array Remove - By John Resig (MIT Licensed)
Array.prototype.remove = function(from, to) {
	var rest = this.slice((to || from) + 1 || this.length);
	this.length = from < 0 ? this.length + from : from;
	return this.push.apply(this, rest);
};
