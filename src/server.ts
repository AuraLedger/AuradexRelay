import * as express from 'express';
import * as http from 'http';
import * as WebSocket from 'ws';
import * as mongodb from 'mongodb';
import * as SortedArray from 'sorted-array';
import * as randomstring from 'randomstring';

import { NodeConfig, INode, NodeFactory, DexUtils } from './lib/libauradex';
let config: any = require('./config.json');


interface ExtWebSocket extends WebSocket {
    isAlive: boolean;
    challenge: string;
}

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });
const mongoClient = mongodb.MongoClient;

const coinNode: INode = NodeFactory.Create(config.coinNodeConfig); 
const baseNode: INode = NodeFactory.Create(config.baseNodeConfig); 

var coinFeeRate: number = config.coinFeeRate;
var baseFeeRate: number = config.baseFeeRate;

coinNode.setFeeRate(coinFeeRate);
baseNode.setFeeRate(baseFeeRate);

//minimum order size of base, should be based on avg transaction fee of network
var globalBaseMin = {
    bid: 0,
    ask: 0
}; 

//TODO: create rest api to pull market history data 
//TODO: don't allow sending greater than active trades/bids/asks from the wallet
//consider ipc connection if nodes are local

//local/active bids/asks/trades
var books = {
    bid: SortedArray.comparing(x => { return -x.price; }, []),
    ask: SortedArray.comparing(x => { return x.price; }, [])
};

var maps = {
    bid: {},
    ask: {},
    trade: {},
    tradeTrans: {}, //signed trade transactions
};

//mongo collections
var mongo: any = { };

mongoClient.connect(config.mongo_conn_str, function (err: any, db) {
    if (err) {
        console.log(err)
    }
    else {
        mongo.bid = db.db(config.market_db_name).collection('bid');
        mongo.ask = db.db(config.market_db_name).collection('ask');
        mongo.trade = db.db(config.market_db_name).collection('trade');
        mongo.err = db.db(config.market_db_name).collection('err');
        console.log('connected to mongo db ' + config.market_db_name);

        //get active bids/asks/trades from db
        mongo.bid.find({state: 'active'}).forEach(restoreEntryToMaps);
        mongo.ask.find({state: 'active'}).forEach(restoreEntryToMaps);
        mongo.trade.find({state: 'active'}).forEach(addTrade);
    }
});

//commitment fee
//allow users to request commitment fees to prevent trolling
//could be sent to a trusted third party, who will return the fees once the trade is successful
//watchtowers

//map from bid/ask address to websocket connection
var socks = {
    bid: {},
    ask: {}
};

//map ws challenge to address
var challengeMap = {
    bid: {},
    ask: {}
};

//map address to book balance
var balanceMap = {
    bid: {},
    ask: {}
};

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
            return; //ignore connection reset and pip closed errors
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
                case 'register': register(json, extWs); break; 
                case 'disconnect': disconnect(extWs); break; 

                case 'getBooks': getBooks(extWs); break;
                case 'getNonce': getNonce(extWs); break;
                case 'getHistory': getHistory(json, extWs); break;

                case 'bid': newEntry(clean(json), extWs); break;
                case 'ask': newEntry(clean(json), extWs); break;
                case 'cancel': cancel(json, extWs); break; 
                case 'enableEntry': enableEntry(json, extWs); break;

                case 'readyTrade': readyTrade(json, extWs); break;

                case 'createIndexes': createIndexes(json); break;
                case 'setFeeRates': setFeeRates(json); break;
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

    //request client to register their addresses
    extWs.challenge = randomstring.generate();
    while(challengeMap.ask.hasOwnProperty(extWs.challenge)) extWs.challenge = randomstring.generate(); //just in case...
    ws.send('{"act": "register", "challenge": "' + extWs.challenge + '"}');
    ws.send(feeRateMessage());

    //send current books
    books.ask.array.forEach(a => { ws.send(JSON.stringify(a));});
        books.bid.array.forEach(b => { ws.send(JSON.stringify(b));});

    } catch (err) {
        logErr({err: err, msg: 'fatal error during connection'});
    }
});

function readyTrade(obj, ws) {
    //get trade from list
    var trade = maps.trade[obj._id];

    if(!trade)
        return;

    var key1 = trade.act;
    var key2 = oppoAct[key1];

    var address1 = maps[key1][trade.id1];
    var address2 = maps[key2][trade.id2];

    if(challengeMap[key1][ws.challenge] == address1)
        socks[key2][address2].send('{"act": "readyTrade", "_id": ' + trade._id + '}');
    else if(challengeMap[key2][ws.challenge] == address2)
        socks[key1][address1].send('{"act": "readyTrade", "_id": ' + trade._id + '}');
}

function getHistory(obj, ws) {
    //TODO: 
}

function register(obj, ws) {
    verifyRegistration(obj, ws, function() {
        socks.bid[obj.baseAddress] = ws;
        socks.ask[obj.coinAddress] = ws;
        challengeMap.bid[ws.challenge] = obj.baseAddress;
        challengeMap.ask[ws.challenge] = obj.coinAddress;

        getNonce(ws);
    }, function(err) {
        logErr(err);
        ws.send('{"act": "err", "err": "error registering"}');
    });
}

var oppoAct = {bid: 'ask', ask: 'bid'};
function getBook(entry, opposite)
{
    var key = opposite ? oppoAct[entry.act] : entry.act;
    return books[key];
}

function getPeers(ws) {
    var result = {
        act: 'getPeers',
        ask: Object.keys(socks.ask),
        bid: Object.keys(socks.bid)
    };
}

function getColl(entry, opposite?)
{
    var key = opposite ? oppoAct[entry.act] : entry.act;
    return mongo[key];
}

function restoreEntryToMaps(entry) {
    entry.online = 0;
    addEntryToMaps(entry);
}

function addEntryToMaps(entry) {
    books[entry.act].insert(entry);
    maps[entry.act][entry._id] = entry;

    var bal = entry.act == 'bid' ? entry.price * entry.amount + baseNode.getInitFee() : entry.amount + coinNode.getInitFee();
    balanceMap[entry.act][entry.address] = bal + (balanceMap[entry.act][entry.address] || 0);

    var rbal = entry.act == 'bid' ? coinNode.getRedeemFee() : baseNode.getRedeemFee();
    balanceMap[oppoAct[entry.act]][entry.redeemAddress] = Math.max((balanceMap[oppoAct[entry.act]][entry.redeemAddress] || 0) - rbal, 0);
}

function addTrade(t) {
    maps.trade[t._id] = t;
}

function enableEntry(obj, ws) {
    //ensure ws is owner of entry id
    var entry = maps[obj.entryType][obj._id];
    if(challengeMap[obj.entryType][ws.challenge] == entry.address)
    {
        entry.online = 1;
        broadcast('{"act": "update", "entryType": "' + entry.act + '", "_id": ' + entry._id + ', "prop": "online", "val": 1}');
    } else {
        logErr({msg: 'attempt to enable entry by non-owner', ws: ws, obj: obj, entry: entry});
    }
}

function disconnect(ws)
{
    var coinAddress = challengeMap.ask[ws.challenge];
    var asks = books.ask.array;
    for(var i = 0; i < asks.length; i++) {
        if(asks[i].address == coinAddress)
            asks[i].online = 0;
    }

    var baseAddress = challengeMap.bid[ws.challenge];
    var bids = books.bid.array;
    for(var i = 0; i < bids.length; i++) {
        if(bids[i].address == baseAddress)
            bids[i].online = 0;
    }

    delete socks.bid[challengeMap.bid[ws.challenge]]  
    delete socks.ask[challengeMap.ask[ws.challenge]]  
    delete challengeMap.bid[ws.challenge];
    delete challengeMap.ask[ws.challenge];

    broadcast('{"act": "disconnect", coinAddress: "'+coinAddress+'", baseAddress: "'+baseAddress+'"}');
}

///
//obj.entryType: bid or ask
//obj._id: id of bid or ask
//obj.price: price of bid or ask
//
function cancel(obj, ws, broadcast?: any) {
    if(challengeMap[obj.entryType][ws.challenge] == maps[obj.entryType][obj._id].address) //ensure this connection owns this entry
    {
        delete maps[obj.entryType][obj._id];
        var book = books[obj.entryType];
        removeFromBook(book, obj);

        mongo[obj.entryType].find().update({_id: obj._id}, {$set: {state: 'cancel'}}, function(err, count, stat) { 
            if (err) {
                logErr(err);
                ws.send('{"act": "err", "err": "error updating entry"}');
            }
        });
        broadcast(obj);
    }
}

function removeFromBook(book, obj)
{
    //sorted-array search find one item with the same price, but we need 
    //to search up and down from there to check them all in case there are multiple entries at the same price
    var i: number = book.search(obj.price); 
    var j: number;
    if(i >= 0) {
        //search up
        for(j = i; j < book.array.length; j++) {
            if(book.array[j].price != obj.price)
                break;
            if(book.array[j]._id == obj._id) {
                book.array.splice(j, 1);
                i = -1; //skip down search loop since we found our id 
                break;
            }
        }

        //search down
        for(j = i-1; j >= 0; j--) {
            if(book.array[j].price != obj.price)
                break;
            if(book.array[j]._id == obj._id) {
                book.array.splice(j, 1);
                break;
            }
        }
    }

    //subtract book balance
    var bal = obj.act == 'bid' ? obj.price * obj.amount + baseNode.getInitFee() : obj.amount + coinNode.getInitFee();
    balanceMap[obj.act][obj.address] = Math.max((balanceMap[obj.act][obj.address] || 0) - bal, 0);

    //subtrace book redeem balance
    var rbal = obj.act == 'bid' ? coinNode.getRedeemFee() : baseNode.getRedeemFee();
    balanceMap[oppoAct[obj.act]][obj.redeemAddress] = Math.max((balanceMap[oppoAct[obj.act]][obj.redeemAddress] || 0) - rbal, 0);
}

function newEntry(entry, ws) {
    verify(entry, ws, function success() {
        entry.state = 'active';
        entry.timestamp = new Date();
        entry.tradeAmount = 0;
        entry.online = 1;

        var newTrades = findMatches(entry);

        getColl(entry).insertOne(clean(entry), function(err, result) {
            if(err) {
                logErr(err);
                ws.send('{"act": "err", "err": "error inserting entry"}');
            } else {
                entry._id = result.insertedId
                addEntryToMaps(entry);
                broadcast(JSON.stringify(entry));

                for(var i = 0; i < newTrades.length; i++)
                {
                    var trade = newTrades[i];
                    trade.id1 = entry._id;
                    mongo.trade.insertOne(trade, function(err, result) {
                        if(err) {
                            logErr(err);
                            ws.send('{"act": "err", "err": "error inserting trade"}');
                        } else {
                            trade._id = result.insertedId;
                            addTrade(trade);
                            broadcast(JSON.stringify({"act": 'trade', trade: trade}));
                        }
                    });
                }
            }
        });

        var otherColl = getColl(entry, true);
        for(var i = 0; i < newTrades.length; i++)
        {
            var trade = newTrades[i];
            otherColl.update({_id: trade.id2}, {$set: {tradeAmount: trade.amount}}, function(err, count, stat) {
                if(err)
                    logErr(err);
            });
            broadcast('{"act": "update", "entryType": "' + oppoAct[entry.act] + '", "_id": ' + trade.id2 + ', "prop": "tradeAmount", "val": ' + trade.amount+ '}');
        }
    }, function failure(err) {
        if(typeof err === 'string')
            ws.send(JSON.stringify({"act": "err", "err": err}));
        logErr(err);
        //log ip depending on type of failure
        //consider banning repeat offenders
    });
}

function compareBids(a, b) {
    return a <= b;
}

function compareAsks(a, b) {
    return b <= a;
}

function findMatches(initiator) {
    var book = getBook(initiator, true); 
    var compare = (initiator.act == 'bid' ? compareBids : compareAsks);
    var matches: any = [];
    for(var i = 0; i < book.length; i++) {
        var receiver = book[i];
        if(receiver.online == 1 && compare(receiver.price, initiator.price))
        {
            var receiverSize = (receiver.amount - receiver.tradeAmount) * receiver.price;
            var initiatorSize = (initiator.amount - initiator.tradeAmount) * receiver.price;
            if(receiverSize >= initiator.min && initiatorSize >= receiver.min)
            {
                //add match
                var tradeAmount = Math.min(initiator.amount - initiator.tradeAmount, receiver.amount - receiver.tradeAmount);
                initiator.tradeAmount += tradeAmount;
                receiver.tradeAmount += tradeAmount;
                matches.push({
                    act: initiator.act,
                    id2: receiver._id,
                    amount: tradeAmount,
                    timestamp: new Date(),
                    state: 'active',
                    step: 0
                });
            }
        }
        else
            break;
    }

    return matches; 
}

function logErr(err) {
    console.log(typeof err);
    console.log(err);
    mongo.err.insertOne({err: err}, function() {});
    console.log(JSON.stringify(Object.keys(err)));
}

function verify(entry, ws, success, fail) {

    //verify registry
    if(challengeMap[entry.act][ws.challenge] != entry.address)
    {
        fail('unregistered');
        return;
    }

    //verify global min 
    if(globalBaseMin[entry.act] > entry.amount * entry.price) {
        fail('globalBaseMin ' + globalBaseMin[entry.act] + ' is > than total size ' + entry.amount + ' * ' + entry.price );
        return;
    }

    var node = getNode(entry);

    var bookBalance = balanceMap[entry.act][entry.address];

    //verify nonce 
    getMaxNonce(getColl(entry), entry.address, n => {
        if(n != entry.nonce - 1)
            fail('invalid nonce expecting ' + (n+1) + ' got ' + entry.nonce);
        else {
            DexUtils.verifyEntry(entry, node, bookBalance, success, fail);
        }
    }, err => {
        fail(err);
    });
}

function getFee(entry): number {
    return entry.act == 'bid' ? baseFeeRate : coinFeeRate;
}

function getBooks(ws) {
    var result = {
        act: 'books',
        ask: books.ask.array,
        bid: books.bid.array
    };
    ws.send(JSON.stringify(result));
}

function getNonce(ws: ExtWebSocket) {
    var coinAddress = challengeMap.ask[ws.challenge];
    getMaxNonce(mongo.ask, coinAddress, function(n) { 
        ws.send('{"act": "nonce", "entryType": "ask", "val": ' + n + '}'); 
    }, function (err) {
        logErr(err);
        ws.send('{"act": "err", "err": "error getting ask nonce"}');
    });

    var baseAddress = challengeMap.bid[ws.challenge];
    getMaxNonce(mongo.bid, baseAddress, function(n) { 
        ws.send('{"act": "nonce", "entryType": "bid", "val": ' + n + '}'); 
    }, function (err) {
        logErr(err);
        ws.send('{"act": "err", "err": "error getting bid nonce"}');
    });
}

function getMaxNonce(coll, address, cb, err) {
    coll.find({address: address}).sort({nonce:-1}).limit(1).next((e,r) => {
        if(e) err(e);
        else if(r) cb(r.nonce);
        else cb(-1);
    });
}

function getNode(entry): INode {
    if(entry.act == 'bid')
        return baseNode;
    return coinNode;
}

function verifyRegistration(obj, ws, success, fail) {
    var msg = ws.challenge;
    var baseAddress = baseNode.recover(msg, obj.baseSig);
    if(baseAddress != obj.baseAddress) {
        fail('invalid base signature');
        return;
    }

    var coinAddress = coinNode.recover(msg, obj.coinSig);
    if(coinAddress != obj.coinAddress) {
        fail('invalid coin signature');
        return;
    }

    success();
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


function createIndexes(obj) {
    if(obj.adminKey == config.adminKey)
    {
        mongo.ask.createIndex({address: 1, nonce: -1});
        mongo.ask.createIndex({address: 1, state: 1});
        mongo.ask.createIndex({state: 1}, {partialFilterExpression: {state: 'active'}});

        mongo.bid.createIndex({address: 1, nonce: -1});
        mongo.bid.createIndex({address: 1, state: 1});
        mongo.bid.createIndex({state: 1}, {partialFilterExpression: {state: 'active'}});

        mongo.trade.createIndex({state: 1}, {partialFilterExpression: {state: 'active'}});
    }
}

//return new object with only the fields we care about for the database insertion
function clean(entry) {
    return {
        act: entry.act, 
        address: entry.address, 
        redeemAddress: entry.redeemAddress, 
        amount: entry.amount, 
        price: entry.price, 
        min: entry.min,
        nonce: entry.nonce, 
        sig: entry.sig, 
        state: entry.state, 
        timestamp: entry.timestamp,
        tradeAmount: entry.tradeAmount 
    }
}

//bid/ask definition
//{
//  act: action 'bid' or 'ask',
//  address: address (coin for ask, base for bid),
//  amount: amount of coin buying/selling,
//  price: price in base,
//  min: minimum base amount to match this trade
//  nonce: incremental number to prevent replay attacks
//  sig: signature proving legitimacy of offer
//
//  added by server
//  state: status 'active', 'complete', 'cancel'
//  online: 0 or 1
//  timestamp: timestamp
//  tradeAmount: amount trading or already traded
//  _id: db id
//}

//trade def
//{
//  act: 'bid' or 'ask' - action that initiated the match
//  id1: bid or ask _id of trade initiator 
//  id2: bid or ask _id of trade receiver 
//  state: status 'active', 'complete', 'cancel'
//  step: 0-3
//  timestamp: timestamp
//  amount: trade amount 
//  _id: db id
//}


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
