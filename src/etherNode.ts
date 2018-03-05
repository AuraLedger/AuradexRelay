import * as Web3 from 'web3';
import { NodeInterface } from './nodeInterface';

declare var Web3: any;

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
    return this.web3.eth.account.recover(msg, sig);
  }
}
