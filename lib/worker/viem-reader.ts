import { getAddress, parseAbiItem, parseEventLogs, TransactionReceiptNotFoundError } from 'viem';
import { publicClient, USDC_ADDRESS } from '../chain';
import type { ChainReader } from './types';

const TRANSFER_EVENT = parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 value)');
const TOKEN = USDC_ADDRESS.toLowerCase();

export function createViemReader(): ChainReader {
  return {
    async getBlockNumber() {
      return Number(await publicClient.getBlockNumber());
    },

    async getTransferLogs({ fromBlock, toBlock, recipients }) {
      const logs = await publicClient.getLogs({
        address: USDC_ADDRESS,
        event: TRANSFER_EVENT,
        args: { to: recipients.map((a) => getAddress(a)) },
        fromBlock: BigInt(fromBlock),
        toBlock: BigInt(toBlock),
      });
      return logs
        .filter((l) => l.transactionHash && l.logIndex !== null && l.blockNumber !== null && !l.removed)
        .map((l) => ({
          token: TOKEN,
          txHash: l.transactionHash!.toLowerCase(),
          logIndex: l.logIndex!,
          blockNumber: Number(l.blockNumber),
          blockHash: l.blockHash!.toLowerCase(),
          from: l.args.from!.toLowerCase(),
          to: l.args.to!.toLowerCase(),
          value: l.args.value!,
        }));
    },

    async getBlockTimestamp(blockNumber) {
      return Number((await publicClient.getBlock({ blockNumber: BigInt(blockNumber) })).timestamp);
    },

    async getReceipt(txHash) {
      try {
        const r = await publicClient.getTransactionReceipt({ hash: txHash as `0x${string}` });
        const decoded = parseEventLogs({ abi: [TRANSFER_EVENT], logs: r.logs, strict: false });
        return {
          status: r.status,
          blockNumber: Number(r.blockNumber),
          blockHash: r.blockHash.toLowerCase(),
          transfers: decoded.map((l) => ({
            token: l.address.toLowerCase(),
            logIndex: l.logIndex,
            from: String(l.args.from).toLowerCase(),
            to: String(l.args.to).toLowerCase(),
            value: l.args.value as bigint,
          })),
        };
      } catch (e) {
        if (e instanceof TransactionReceiptNotFoundError) return null;
        throw e;
      }
    },
  };
}
