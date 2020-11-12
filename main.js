"use strict";
//
// begin Load and check connection parameters
//
var config;
try {
	config = require('./config.js');
} catch (e) {
	console.log('Error loading config.js. Please rename or copy config.sample.js into config.js');
	process.exit();
}
var token = config.token;
var trading_api_host = config.trading_api_host;
var trading_api_port = config.trading_api_port;
var trading_api_proto = config.trading_api_proto;
if (typeof (token) === 'undefined' || typeof (trading_api_host) === 'undefied' || typeof (trading_api_port) === 'undefined' || typeof (trading_api_proto) === 'undefined') {
	console.log('config.js contents error');
	process.exit();
}

if (token === 'PASTE_YOUR_TOKEN_HERE') {
	console.log('please paste your token in config.js file');
	process.exit();
}
//
// end Load and check connection parameters
//

//
// begin Internal variables and objects
//
var EventEmitter = require('events');
var cli = new EventEmitter();
var io = require('socket.io-client');
var socket;
var querystring = require('querystring');
var tradinghttp = require(trading_api_proto);
var globalRequestID = 1;
var request_headers = {
	'User-Agent': 'request',
	'Accept': 'application/json',
	'Content-Type': 'application/x-www-form-urlencoded'
}
//
// end Internal variables and objects
//

//
// begin Core functionality
//
var getNextRequestID = () => {
	return globalRequestID++;
}

var default_callback = (statusCode, requestID, data) => {
	if (statusCode === 200) {
		try {
			var jsonData = JSON.parse(data);
		} catch (e) {
			console.log('request #', requestID, ' JSON parse error:', e);
			return;
		}
		console.log('request #', requestID, ' has been executed:', JSON.stringify(jsonData, null, 2));
	} else {
		console.log('request #', requestID, ' execution error:', statusCode, ' : ', data);
	}
}

var request_processor = (method, resource, params, callback) => {
	var requestID = getNextRequestID();
	if (typeof (callback) === 'undefined') {
		callback = default_callback;
		console.log('request #', requestID, ' sending');
	}
	if (typeof (method) === 'undefined') {
		method = "GET";
	}

	// GET HTTP(S) requests have parameters encoded in URL
	if (method === "GET") {
		resource += '/?' + params;
	}
	var req = tradinghttp.request({
		host: trading_api_host,
		port: trading_api_port,
		path: resource,
		method: method,
		headers: request_headers
	}, (response) => {
		var data = '';
		response.on('data', (chunk) => data += chunk); // re-assemble fragmented response data
		response.on('end', () => {
			callback(response.statusCode, requestID, data);
		});
	}).on('error', (err) => {
		callback(0, requestID, err); // this is called when network request fails
	});

	// non-GET HTTP(S) reuqests pass arguments as data
	if (method !== "GET" && typeof (params) !== 'undefined') {
		req.write(params);
	}
	req.end();
};

// FXCM REST API requires socket.io connection to be open for requests to be processed
// id of this connection is part of the Bearer authorization
var authenticate = (token) => {
	socket = io(trading_api_proto + '://' + trading_api_host + ':' + trading_api_port, {
		query: querystring.stringify({
			access_token: token
		})
	});
	// fired when socket.io connects with no errors
	socket.on('connect', () => {
		console.log('Socket.IO session has been opened: ', socket.id);
		request_headers.Authorization = 'Bearer ' + socket.id + token;
	});
	// fired when socket.io cannot connect (network errors)
	socket.on('connect_error', (error) => {
		console.log('Socket.IO session connect error: ', error);
	});
	// fired when socket.io cannot connect (login errors)
	socket.on('error', (error) => {
		console.log('Socket.IO session error: ', error);
	});
	// fired when socket.io disconnects from the server
	socket.on('disconnect', () => {
		console.log('Socket disconnected, terminating client.');
		process.exit(-1);
	});
}
//
// end Core functionality
//

//
// begin Setup CLI
//

// this is called on console input
process.stdin.on('data', function (data) {
	var input = data.toString().trim();

	// if the line was empty we don't want to do anything
	if (input === '') {
		cli.emit('prompt');
		return;
	}

	// split input into command and parameters
	var inputloc = input.search('{');
	if (inputloc === -1) {
		inputloc = input.length;
	}
	var command = input.substr(0, inputloc).trim();
	var params = input.substr(inputloc).trim();

	// command must be registered with cli
	if (cli.eventNames().indexOf(command) >= 0) {
		if (params.length > 0) {
			try {
				cli.emit(command, JSON.parse(params));
			} catch (e) {
				console.log('could not parse JSON parameters: ', e);
			}
		} else {
			cli.emit(command, {});
		}
		cli.emit('prompt');
	} else {
		console.log('command not found. available commands: ', cli.eventNames());
	}
});

cli.on('prompt', () => {
	process.stdout.write('> ');
});

cli.on('exit', () => {
	process.exit();
});


// loading of extra modules
cli.on('load', (params) => {
	if (typeof(params.filename) === 'undefined') {
		console.log('command error: "filename" parameter is missing.')
	} else {
		var test = require(`./${params.filename}`);
		test.init(cli,socket);
		console.log("file loaded successfully!");
	}
});

// helper function to send parameters in stringified form, which is required by FXCM REST API
cli.on('send', (params) => {
	if (typeof (params.params) !== 'undefined') {
		params.params = querystring.stringify(params.params);
	}
	cli.emit('send_raw', params);
});

// will send a request to the server
cli.on('send_raw', (params) => {
	// avoid undefined errors if params are not defined
	if (typeof (params.params) === 'undefined') {
		params.params = '';
	}
	// method and resource must be set for request to be sent
	if (typeof (params.method) === 'undefined') {
		console.log('command error: "method" parameter is missing.');
	} else if (typeof (params.resource) === 'undefined') {
		console.log('command error: "resource" parameter is missing.');
	} else {
		request_processor(params.method, params.resource, params.params, params.callback);
	}
});
//
// end Setup CLI
//


//
// begin Main
//

authenticate(token);
cli.emit('prompt');
//
// end Main
//


const http = require('http');
const fs = require('fs');
const qs = require("querystring");
const lp = require("./liveprices.js");
const json_file = require('./json.js')
const express = require('express');
const path = require('path');
const app = express();
//app.use(express.static(__dirname + 'public'));

const hostname = 'localhost';
const port = 3000;


var prev_dat = new Date();
var dc;
var test = 0;

const server = http.createServer((req, res) => {
	res.statusCode = 200;

	fs.readFile('index.html', null, function (error, data) {

		if (error) {
			res.writeHead(404);
			res.write('file not found!');
		
		} else {

			res.writeHead(200, { 'Content-Type': 'text/html' });		
			res.end(data);				
		}
	
	});
	
	if (req.method == "POST") {
		var body = '';
	

		req.on('data', (data) => {		
				body += data;		
		});
		req.on('end', () => {
			var post_data = qs.parse(body);

			if(post_data.data === 'post request'){
			
				setTimeout(function(){
				//console.log(JSON.stringify(post_data));
			   /* check if liveprices module has been loaded.
			   
			   if(test != ''){
				console.log(" liveprices file loaded successfully!");
			   }
				  */	  
			  // loading liveprices module and executing setupCLI().
			  // it will return the current values of gold\silver as array
			   lp.init(cli,socket);			
		      			   
			  // res.write(JSON.stringify(lp.rates)); WRONG WAY TO RETURN DATA BACK TO THE USER.
			   //console.log(lp.rates);

			  //data collecting
			  //var data_split = lp.rates.split(',');
			   
			  
			 // var data_split = data_strigify.split(',');

			 /*
			 var obj = {
				table: []
			 };
			 */
 
			 // first array 

			 dc = [];
			 dc.push(lp.rates);
			 dc = JSON.stringify(dc);		
			 var data_split = dc.split(',');
			
			 // second array 
			 		
			 
			 var date_ob = new Date();
			 
			  	  console.log(date_ob.getHours() + "XX" + prev_dat.getHours());
					if (date_ob.getHours() < prev_dat.getHours()) { 
						prev_dat = date_ob;	
						var json = data_split[1];

						console.log("New DAY." + "   " + json);
						fs.writeFileSync('./lastprices.js', data_split[1]);
					}
					 if (date_ob.getHours() === prev_dat.getHours()) { 
						//var live_change = data_split;
						//var daily_change = data_split;
						console.log("live change:" +  data_split[1] + "    daily change: "   /*dc[0] - test */);					
				}
				fs.writeFileSync('./lastprices.js', data_split[1]);
			  
				 console.log( "dc array" + " time : " + date_ob.getHours() + date_ob.getMinutes() + date_ob.getSeconds() +" " + dc);
			    // fs.writeFileSync('./lastprices.js', dc);
		// ending response and delivering data to ajax success function, wich displaying data.
		
	},5000);
	res.end(JSON.stringify(dc));
			} 
			//return(post_data);	

		}); // end of createServer

		req.on('err', (err) => {
			console.log(err);
		});
	}

});
server.on('listening',function(){
    console.log('server is running...');
});
server.listen(port, hostname, () => {
	console.log(`Server running at http://${hostname}:${port}/`);
});

// end of client rendering



// server creating/connecting here

// also client displaying

