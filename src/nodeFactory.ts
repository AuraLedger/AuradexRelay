import { NodeInterface } from './nodeInterface'
import { EtherNode } from './etherNode'

interface NodeConfig {
    type: string;
}

export class NodeFactory {
    static Create(config: NodeConfig): NodeInterface {
        switch(config.type) {
            case 'Ether': return new EtherNode(config);
            default: throw 'Unknown node config type ' + config.type;
        }
    }
}
