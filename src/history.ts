import * as mongodb from 'mongodb';

import { Config, NodeConfig } from './config';
let config: Config = require('./config.json');

const mongoClient = mongodb.MongoClient;

var mongo: any = {};

var timers: any = {};

mongoClient.connect(config.mongo_conn_str, function (err: any, db) {
    if (err) {
        console.log(err)
    }
    else {
        mongo.min = db.db(config.market_db_name).collection('min');
        mongo.min5 = db.db(config.market_db_name).collection('5min');
        mongo.min15 = db.db(config.market_db_name).collection('15min');
        mongo.hour = db.db(config.market_db_name).collection('hour');
        mongo.hour6 = db.db(config.market_db_name).collection('6hour');
        mongo.day = db.db(config.market_db_name).collection('day');
        mongo.week = db.db(config.market_db_name).collection('week');
        mongo.month = db.db(config.market_db_name).collection('month');
        mongo.quarter = db.db(config.market_db_name).collection('quarter');
        mongo.year = db.db(config.market_db_name).collection('year');
        mongo.year5 = db.db(config.market_db_name).collection('5year');
        console.log('connected to mongo db ' + config.market_db_name);

        setInterval(heartBeat, 1000);
    }
});

function heartBeat() {

}
