export interface NodeInterface {
    getBalance(address: string, handler: any);
    recover(msg: string, sig: string): string;
}
