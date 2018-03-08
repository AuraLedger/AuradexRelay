import { INode } from './INode';
import { EtherConfig } from './NodeConfig';

import Web3 from 'web3';

export class EtherNode implements INode {
    web3: any;

    constructor(config: EtherConfig) {
        this.web3 = new Web3(config.rpcUrl);
    }

    getBalance(address: string, handler: any) {
        var that = this;
        this.web3.eth.getBalance(address, function(err: any, r: any) {
            if(err)
                handler(err);
            else
                handler(null, that.web3.utils.fromWei(r, 'ether'));
        });
    }

    recover(msg: string, sig: string): string {
        return this.web3.eth.accounts.recover(msg, sig);
    }
}
