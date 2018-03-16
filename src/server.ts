import * as express from 'express';
import * as http from 'http';
import * as WebSocket from 'ws';
import * as SortedArray from 'sorted-array';
import * as randomstring from 'randomstring';

import { NodeConfig, INode, NodeFactory, DexUtils, CancelMessage, ArrayMap, StoredArrayMap } from './lib/libauradex';
let config: any = require('./config.json');


interface ExtWebSocket extends WebSocket {
    isAlive: boolean;
    coinAddress: string;
    baseAddress: string;
}

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const coinNode: INode = NodeFactory.Create(config.coinNodeConfig); 
const baseNode: INode = NodeFactory.Create(config.baseNodeConfig); 

var coinFeeRate: number = config.coinFeeRate;
var baseFeeRate: number = config.baseFeeRate;

coinNode.setFeeRate(coinFeeRate);
baseNode.setFeeRate(baseFeeRate);

//TODO: create rest api to pull market history data 
//TODO: don't allow sending greater than active trades/bids/asks from the wallet
//consider ipc connection if nodes are local

var messages: StoredArrayMap = new StoredArrayMap('hash');

//TODO: restore listings/offers/accepts from local storage

//commitment fee
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
            disconnect(extWs);
            return; //ignore connection reset and pipe closed errors
        }
        logErr(error);
    };

    ws.on('error', (err: any) => {
        if(err.errno == 'ECONNRESET') return;
        logErr(err);
    });

    ws.on('close', function() {
        disconnect(extWs);
        ws.terminate();
    });

    //connection is up 
    ws.on('message', (message: string) => {
        try {
            var json = JSON.parse(message);

            //route actions
            switch(json.act)
            {
                case 'disconnect': disconnect(extWs); break; 
                case 'setFeeRates': setFeeRates(json); break;
                default: 
                    messages.add(json);
                    //TODO: some kind of simple verification and spam prevention before broadcasting
                    broadcast(json);
                    break;
            }
        } catch(ex) {
            try {
                ws.send('{"act": "err", "err": "WHAT... DID YOU... DO!!!"}');
            } catch { }

            try {
                logErr(ex);
            } catch { }
        }
    });

    //TODO: better fee estimation
    ws.send(feeRateMessage());

    //send current items
    messages.array.forEach(a => { ws.send(JSON.stringify(a));});

    broadcast('{"peers":' + wss.clients.size + '}');

    } catch (err) {
        logErr({err: err, msg: 'fatal error during connection'});
    }
});

var oppoAct = {bid: 'ask', ask: 'bid'};

function disconnect(ws)
{
    //broadcast('{"act": "disconnect", coinAddress: "'+coinAddress+'", baseAddress: "'+baseAddress+'"}');
    //TODO: store coin/base addresses on first listing/offer of ws
}

 
function logErr(err) {
    console.log(typeof err);
    console.log(err);
}

function getFee(entry): number {
    return entry.act == 'bid' ? baseFeeRate : coinFeeRate;
}


function setFeeRates(obj) {
    if(obj.adminKey == config.adminKey) {
        coinFeeRate = Number(obj.coinFeeRate) || coinFeeRate;
        baseFeeRate = Number(obj.baseFeeRate) || baseFeeRate;
        coinNode.setFeeRate(coinFeeRate);
        baseNode.setFeeRate(baseFeeRate);
    }

    broadcast(feeRateMessage());
}

function feeRateMessage(): string {
    return '{"act": "setFeeRates", "coinFeeRate": '+ coinFeeRate + ', "baseFeeRate": ' + baseFeeRate + '}';
}

//check for broken connections
setInterval(() => {
    wss.clients.forEach((ws: WebSocket) => {

        const extWs = ws as ExtWebSocket;

        if (!extWs.isAlive) {
            disconnect(extWs);
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
