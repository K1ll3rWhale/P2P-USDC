import { getAddress, parseAbiItem, parseEventLogs, TransactionReceiptNotFoundError } from 'viem';
import { publicClient, USDC_ADDRESS } from '../chain';
import type { ChainReader } from './types';

const TRANSFER_EVENT = parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 value)');
const TOKEN = USDC_ADDRESS.toLowerCase();

// ERC-4337 EntryPoint v0.7. Address confirmed from the eth-infinitism v0.7.0 release notes; the event signature
// hashes to topic0 0x49628fd1... which matches the UserOperationEvent logs seen in our real receipts.
export const ENTRYPOINT_V07 = '0x0000000071727De22E5E9d8BAf0edAc6f37da032' as const;
const USER_OP_EVENT = parseAbiItem(
  'event UserOperationEvent(bytes32 indexed userOpHash, address indexed sender, address indexed paymaster, uint256 nonce, bool success, uint256 actualGasCost, uint256 actualGasUsed)',
);

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

    async getUserOperationEvents({ userOpHash, fromBlock, toBlock }) {
      const logs = await publicClient.getLogs({
        address: ENTRYPOINT_V07,
        event: USER_OP_EVENT,
        args: { userOpHash: userOpHash as `0x${string}` },
        fromBlock: BigInt(fromBlock),
        toBlock: BigInt(toBlock),
      });
      return logs
        .filter((l) => l.transactionHash && l.blockNumber !== null && !l.removed)
        .map((l) => ({ txHash: l.transactionHash!.toLowerCase(), blockNumber: Number(l.blockNumber), success: Boolean(l.args.success) }));
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
