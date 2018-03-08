import { NodeInterface } from './nodeInterface';
const Web3 = require('web3');

export class EtherNode implements NodeInterface {
    web3: any;

    constructor(config: any) {
        this.web3 = new Web3(config.rpc_url);
    }

    getBalance(address: string, handler: any) {
        this.web3.eth.getBalance(address, function(err, r) {
            if(err)
                handler(err);
            else
                handler(null, Web3.utils.fromWei(r, 'ether'));
        });
    }

    recover(msg: string, sig: string): string {
        return this.web3.eth.accounts.recover(msg, sig);
    }
}
