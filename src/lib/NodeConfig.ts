export interface NodeConfig {
    type: string;
}

export interface EtherConfig extends NodeConfig {
    rpcUrl: string;
}
