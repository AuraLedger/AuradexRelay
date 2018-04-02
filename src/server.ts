const fs = require('fs');

import * as express from 'express';
import * as http from 'http';
import * as WebSocket from 'ws';

declare var require: any
declare var global: any

let config: any = require('./config.json');
let logger: any = require('simple-node-logger');

var logDir = config.log_dir || './AuradexRelayLogs';

if (!fs.existsSync(logDir)){
    fs.mkdirSync(logDir);
}

const loggerOptions= {
    errorEventName:'error',
    logDirectory: logDir, 
    fileNamePattern:'roll-<DATE>.log',
    dateFormat:'YYYY.MM.DD'
};
const log = logger.createRollingFileLogger(loggerOptions);
log.info('server started');

if (typeof localStorage === 'undefined' || localStorage === null) {
    var LocalStorage = require('node-localstorage').LocalStorage;
    (<any>global).localStorage = new LocalStorage(config.local_storage_folder);
}

interface ExtWebSocket extends WebSocket {
    isAlive: boolean;
}

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

var messages = {};
var expire = ((new Date()).getTime() - 1000 * 60 * 60 * 24 * 4) * 1000; // four days
//restore non expired messages from local storage on startup
for(var i = 0; i < localStorage.length; i++)
{
    var key = localStorage.key(i);
    var time = Number(key);
    if(key && time) {
        if(time < expire)
            localStorage.removeItem(key);
        else
            messages[time] = localStorage.getItem(key);
    }
}

//commitment fee idea
//allow users to request commitment fees to prevent trolling
//could be sent to a trusted third party, who will return the fees once the trade is successful
//watchtowers

//TODO: blacklist spammers
var blacklist = {};

//// Broadcast to all.
function broadcast(data) {
    wss.clients.forEach(function each(client) {
        if (client.readyState === WebSocket.OPEN) {
            client.send(data);
        }
    });
};

wss.on('error', (err) => {
    try {
        logErr(err);
    } catch {};
});

wss.on('connection', (ws: WebSocket) => {

    try {
        const extWs = ws as ExtWebSocket;
        extWs .isAlive = true;

        ws.on('pong', () => {
            extWs.isAlive = true;
        });

        ws.onerror = ({error}) => {
            if(error.errno) {
                return; //ignore connection reset and pipe closed errors
            }
            logErr(error);
        };

        ws.on('error', (err: any) => {
            if(err.errno == 'ECONNRESET') return;
            if(err.errno == 'EPIPE') return;
            logErr(err);
        });

        ws.on('close', function() {
            ws.terminate();
        });

        ws.on('message', (message: string) => {
            var time = (new Date()).getTime() * 1000; //should support 1000 messages per millisecond
            while(messages.hasOwnProperty(time))
                time++;
            messages[time] = message;
            localStorage.setItem(time.toString(), message);
            broadcast(message);
        });

        //update peer count
        broadcast('{"act":"peers","peers":' + wss.clients.size + '}');

        var expired: any = [];
        var expire = ((new Date()).getTime() - 1000 * 60 * 60 * 24 * 4) * 1000; // four days
        for (var key in messages) {
            var time = Number(key);
            if (time && messages.hasOwnProperty(key)) {
                if(time < expire)
                    expired.push(key);
                else
                    ws.send(messages[key]);
            }
        }

        for(var i = 0; i < expired.length; i++)
        {
            delete messages[expired[i]];
            localStorage.removeItem(expired[i]);
        }

    } catch (err) {
        logErr({err: err, msg: 'fatal error during connection'});
    }
});

function logErr(err) {
    console.log(typeof err);
    console.log(err);
    log.warn(err);
}

//check for broken connections
setInterval(() => {
    wss.clients.forEach((ws: WebSocket) => {

        const extWs = ws as ExtWebSocket;

        if (!extWs.isAlive) {
            return ws.terminate();
        }

        extWs.isAlive = false;
        ws.ping(null, undefined);
    });
}, 30000);

//start our server
server.listen(config.listening_port, () => {
    console.log(`Server started on port ${JSON.stringify(server.address())} :)`);
});
