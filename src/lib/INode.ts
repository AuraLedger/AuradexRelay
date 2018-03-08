export interface INode {
    getBalance(address: string, handler: any): void;
    recover(msg: string, sig: string): string;
}
