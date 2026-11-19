export interface ObservedLog {
  token: string; // lowercase contract address
  txHash: string; // lowercase
  logIndex: number;
  blockNumber: number;
  blockHash: string;
  from: string; // lowercase
  to: string; // lowercase
  value: bigint;
}

export interface ReceiptInfo {
  status: 'success' | 'reverted';
  blockNumber: number;
  blockHash: string;
  /** Decoded ERC-20 Transfer logs in the receipt. */
  transfers: { token: string; logIndex: number; from: string; to: string; value: bigint }[];
}

/** Everything the scanner needs from the chain; faked in tests. */
export interface ChainReader {
  getBlockNumber(): Promise<number>;
  getTransferLogs(args: { fromBlock: number; toBlock: number; recipients: string[] }): Promise<ObservedLog[]>;
  getBlockTimestamp(blockNumber: number): Promise<number>;
  getReceipt(txHash: string): Promise<ReceiptInfo | null>;
}
