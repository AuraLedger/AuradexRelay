import { NodeInterface } from './NodeInterface'
import { EtherNode } from './EtherNode';
import { NodeConfig, EtherConfig } from './NodeConfig';

export class NodeFactory {
    static Create(config: NodeConfig): NodeInterface {
        switch(config.type) {
            case 'Ether': return new EtherNode(<EtherConfig>config);
            default: throw 'Unknown node config type ' + config.type;
        }
    }
}
