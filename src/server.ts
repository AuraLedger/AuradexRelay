import * as express from 'express';
import * as http from 'http';
import * as WebSocket from 'ws';
import * as mongodb from 'mongodb';
import * as SortedArray from 'sorted-array';
import * as randomstring from 'randomstring';

import * as config from './config.js';

import { NodeInterface } from './nodeInterface';
import { NodeFactory } from './nodeFactory';

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });
const mongoClient = mongodb.MongoClient;

const coinNode: NodeInterface = NodeFactory.Create(config.coinNodeConfig); 
const baseNode: NodeInterface = NodeFactory.Create(config.baseNodeConfig); 

var globalBaseMin = 0; //minimum order size of base, should be based on avg transaction fee of network

//TODO: create rest api to pull market history data 
//TODO: don't allow sending greater than active trades/bids/asks from the wallet
//consider ipc connection if nodes are local

//local/active bids/asks/trades
function priceSelector(x) { return x.price; }
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
var challs = {
  bid: {},
  ask: {}
};

wss.on('connection', (ws: WebSocket) => {

  ws.isAlive = true;

  ws.on('pong', () => {
    ws.isAlive = true;
  });

  //connection is up 
  ws.on('message', (message: string) => {
    var json = JSON.parse(message);

    //route actions
    switch(json.act)
    {
      case 'register': register(json, ws); break; 
      case 'disconnect': disconnect(ws); break; 
     
      case 'getBooks': getBooks(ws); break;
      case 'getNonce': getNonce(json, ws); break;
      case 'getPeers': getPeers(ws); break;
      
      case 'bid': newEntry(json, ws); break;
      case 'ask': newEntry(json, ws); break;
      case 'cancel': cancel(json, ws); break; 
      
      case 'readyTrade': readyTrade(json, ws); break;
      case 'initTrade': initTrade(json, ws); break;
      case 'cancelTrade': cancelTrace(json, ws); break;

      case 'createIndexes': createIndexes(json, ws); break;
    }
  });

  //request client to register their addresses
  ws.challenge = randomstring.generate();
  while(challs.hasOwnKey(ws.challenge)) ws.challenge = randomstring.generate(); //just in case...
  ws.send('{act: "register", challenge: "' + ws.challenge + '"}');
});

function readyTrade(obj, ws) {
  //get trade from list
  var trade = maps.trade[obj._id]; 


}

function initTrade(obj, ws) {
  //get trade from list
  var trade = maps.trade[obj._id]; 
  //TODO: verify trade transaction
  //verify tran sender address
  //verify tran amount
  //verify tran contract address or contract
  //verify tran hash secret

}

function register(obj, ws) {
  verifyRegistration(obj, ws, function() {
    socks.bid[obj.baseAddress] = ws;
    socks.ask[obj.coinAddress] = ws;
    challs.bid[ws.challange] = obj.baseAddress;
    challs.ask[ws.challange] = obj.coinAddress;
  
    getMaxNonce(mongo.bid, obj.baseAddress, function(n) {
      ws.send('{act: "nonce", type: "bid", val: '+n+'}');
    }, function(err) {
      logErr(err);
      ws.send('{act: "err", err: "error getting bid nonce"}');
    });

    getMaxNonce(mongo.ask, obj.coinAddress, function(n) {
      ws.send('{act: "nonce", type: "ask", val: '+n+'}');
    }, function(err) {
      logErr(err);
      ws.send('{act: "err", err: "error getting ask nonce"}');
    });
  }, function(err) {
    logErr(err);
    ws.send('{act: "err", err: "error registering"}');
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

function getColl(entry, opposite)
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
}

function addTrade(t) {
  maps.trade[t._id] = t;
}

function enableEntry(obj, ws) {
  
}

function disconnect(ws)
{
  var coinAddress = challs.ask[ws.challenge];
  var asks = books.ask.array;
  for(var i = 0; i < asks.length; i++) {
    if(asks[i].address == coinAddress)
      asks[i].online = 0;
  }

  var baseAddress = challs.bid[ws.challenge];
  var bids = books.bid.array;
  for(var i = 0; i < bids.length; i++)
    if(bids[i].address == baseAddress)
      bids[i].online = 0;

  delete socks.bid[challs.bid[ws.challenge]]  
  delete socks.ask[challs.ask[ws.challenge]]  
  delete challs.bid[ws.challenge];
  delete challs.ask[ws.challenge];

  wss.broadcast('{act: "disconnect", coinAddress: "'+coinAddress+'", baseAddress: "'+baseAddress+'"}');
}

///
//obj.entryType: bid or ask
//obj._id: id of bid or ask
//obj.price: price of bid or ask
//
function cancel(obj, ws, broadcast?: any) {
  if(challs[obj.entryType][ws.challenge] == maps[obj.entryType][obj._id].address) //ensure this connection owns this entry
  {
    delete maps[obj.entryType][obj._id];
    var book = books[obj.entryType];
    removeFromBook(book, obj);

    mongo[obj.entryType].find().update({_id: obj._id}, {$set: {state: 'cancel'}}, function(err, count, stat) { 
      if (err) {
        logErr(err);
        ws.send('{act: "err", err: "error deleting entry"}');
      }
    });
    wss.broadcast(obj);
  }
}

function removeFromBook(book, obj)
{
  //sorted-array search find one item with the same price, but we need 
  //to search up and down from there to check them all in case there are multiple entries at the same price
  var i = book.search(obj.price); 
  if(i > 0) {
    //search up
    for(var j = i; j < book.array.length; j++) {
      if(book.array[j].price != obj.price)
        break;
      if(book.array[j]._id == obj._id) {
        book.array.splice(j, 1);
        i = -1; //skip down search loop since we found our id 
        break;
      }
    }

    //search down
    for(var j = i-1; j >= 0; j--) {
      if(book.array[j].price != obj.price)
        break;
      if(book.array[j]._id == obj._id) {
        book.array.splice(j, 1);
        break;
      }
    }
  }
}

function newEntry(entry, ws) {
  verify(entry, function success() {
    entry.state = 'active';
    entry.timestamp = new Date();
    entry.tradeAmount = 0;
    entry.online = 1;

    var trades = findMatches(entry);

    getColl(entry).insertOne(prepareInsert(entry), function(err, result) {
      if(err) {
        logErr(err);
        ws.send('{act: "err", err: "error inserting entry"}');
      } else {
        entry._id = result.insertedId
        addEntryToMaps(entry);
        wss.broadcast(JSON.stringify(entry));

        for(var i = 0; i < trades.length; i++)
        {
          var trade = trades[i];
          trade.id1 = entry._id;
          mongo.trade.insertOne(trade, function(err, result) {
            if(err) {
              logErr(err);
              ws.send('{act: "err", err: "error inserting trade"}');
            } else {
              trade._id = result.insertedId;
              addTrade(trade);
              wss.broadcast(JSON.stringify({act: 'trade', trade: trade}));
            }
          });
        }
      }
    });

    var otherColl = getColl(entry, true);
    for(var i = 0; i < trades.length; i++)
    {
      var trade= trades[i];
      otherColl.update({_id: trade.id2}, {$set: {tradeAmount: trade.amount}}, function(err, count, stat) {
        if(err)
          logErr(err);
      });
      wss.broadcast('{act: "upd", typ: "' + oppoAct[entry.act] + '", _id: ' + trade.id2 + ', prp: "tradeAmount", val: ' + trade.amount+ '}');
    }
  }, function failure(err) {
    logErr(err);
    //log ip depending on type of failure
    //consider banning repeat offenders
  });
}

function findMatches(initiator) {
  var book = getBook(initiator, true); 
  var compare = (initiator.act == 'bid' ? (a, b)  => { return a <= b; } : (a, b) => { return b <= a; });
  var matches = [];
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
          amount: tradeAmdount,
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
  console.log(err);
  mongo.err.insertOne({err: err}, function() {});
}

function verify(entry, success, fail) {
  //verify min
  if(entry.min > entry.amount * entry.price) {
    fail('min ' + entry.min + ' is > than total size ' + entry.amount + ' * ' + entry.price );
    return;
  }

  //verify global min 
  if(globalMin > entry.amount * entry.price) {
    fail('globalMin ' + globalMin + ' is > than total size ' + entry.amount + ' * ' + entry.price );
    return;
  }

  //verify nonce 
  getMaxNonce(getColl(entry), entry.address, n => {
    if(n != entry.nonce - 1)
      fail('invalid nonce expecting ' + (n+1) + ' got ' + entry.nonce);
    else
      verifySig(entry, success, fail);
  }, err => {
    fail(err);
  });
}

function getBooks(ws) {
  var result = {
    act: 'books',
    ask: books.ask.array,
    bid: books.bid.array
  };
  ws.send(JSON.stringify(result));
}

function getNonce(obj, ws) {
  var coinAddress = challs.ask[ws.challenge];
  getMaxNonce(mongo.ask, coinAddress, function(n) { 
    ws.send('{act: "nonce", type: "ask", val: ' + n + '}'); 
  }, function (err) {
    logErr(err);
    ws.send('{act: "err", err: "error getting ask nonce"}');
  });
  
  var baseAddress = challs.bid[ws.challenge];
  getMaxNonce(mongo.bid, baseAddress, function(n) { 
    ws.send('{act: "nonce", type: "bid", val: ' + n + '}'); 
  }, function (err) {
    logErr(err);
    ws.send('{act: "err", err: "error getting bid nonce"}');
  });
}

function getMaxNonce(coll, address, cb, err) {
  coll.find({address: address}).sort({nonce:-1}).limit(1).next((e,r) => {
    if(e) err(e);
    else cb(r.nonce);
  });
}

function getNode(entry) {
  if(entry.act == 'bid')
    return baseNode;
  return coinNode;
}

function verifySig(entry, success, fail) {
  var msg = JSON.stringify({
    act: entry.act,
    address: entry.address,
    amount: entry.amount,
    price: entry.price,
    min: entry.min,
    nonce: entry.nonce
  });
  var nod = getNode(entry);
  var expected = nod.recover(msg, entry.sig); 
  if(expected == entry.address)
    verifyAmt(entry, success, fail)
}

function verifyRegistration(obj, ws, success, fail) {
  var msg = ws.challenge;
  var baseAddress = baseNode.recover(msg, obj.sigBase);
  if(baseAddress != obj.baseAddress) {
    fail('invalid base signature');
    return;
  }

  var coinAddress = coinNode.recover(msg, obj.sigCoin);
  if(coinAddress != obj.coinAddress) {
    fail('invalid coin signature');
    return;
  }

  success();
}

function verifyAmt(entry, success, fail)
{
  var nod = getNode(entry);
  nod.getBalance(entry.address, function(err, r) {
    if(err)
      fail(err)
    else {
      if(r > entry.amount * entry.price)
        success();
      else
        fail('address balance ' + r + ' is less than total size ' + entry.amount + ' * ' + entry.price );
    }
  });
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
function prepareInsert(entry) {
  return {
    act: entry.act, 
    address: entry.address, 
    amount: entry.amount, 
    price: entry.price, 
    min: entry.min, 
    nonce: entry.nonce, 
    sig: entry.sig, 
    state: entry.state, 
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
  wss.clients.forEach((ws: ExtWebSocket) => {

    if (!ws.isAlive) {
      disconnect(ws);
      return ws.terminate();
    }

    ws.isAlive = false;
    ws.ping(null, false, true);
  });
}, 30000);

//start our server
server.listen(8999, () => {
  console.log(`Server started on port ${server.address().port} :)`);
});
