require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const csv = require('csv-parser');
const {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  clusterApiUrl,
} = require('@solana/web3.js');
const {
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
  createTransferInstruction,
  TOKEN_PROGRAM_ID,
} = require('@solana/spl-token');

const app = express();
app.use(cors());
app.use(express.json());

const connection = new Connection(process.env.SOLANA_RPC_URL);
const fromWallet = Keypair.fromSecretKey(
  Uint8Array.from(JSON.parse(process.env.AIRDROP_WALLET_PRIVATE_KEY))
);
const mint = new PublicKey(process.env.TOKEN_MINT_ADDRESS);

let whitelist = {};
fs.createReadStream('whitelist.csv')
  .pipe(csv())
  .on('data', (row) => {
    const wallet = row.wallet_address.trim();
    const amount = parseFloat(row.claim_amount);
    if (wallet && !isNaN(amount)) {
      whitelist[wallet] = amount;
    }
  })
  .on('end', () => {
    console.log(`✅ Whitelist loaded: ${Object.keys(whitelist).length}`);
  });

app.post('/generate-claim-tx', async (req, res) => {
  const wallet = req.body.userAddress?.trim();
  if (!wallet || !whitelist[wallet]) {
    return res.status(403).json({ error: '❌ Not eligible or already claimed' });
  }

  try {
    const toPubkey = new PublicKey(wallet);
    const amount = whitelist[wallet];
    const amountInSmallestUnit = BigInt(amount * 1e9);

    const fromTokenAccount = await getAssociatedTokenAddress(mint, fromWallet.publicKey);
    const toTokenAccount = await getAssociatedTokenAddress(mint, toPubkey);

    const instructions = [];

    const toTokenInfo = await connection.getAccountInfo(toTokenAccount);
    if (!toTokenInfo) {
      instructions.push(
        createAssociatedTokenAccountInstruction(
          toPubkey,
          toTokenAccount,
          toPubkey,
          mint
        )
      );
    }

    instructions.push(
      createTransferInstruction(
        fromTokenAccount,
        toTokenAccount,
        fromWallet.publicKey,
        amountInSmallestUnit
      )
    );

    const { blockhash } = await connection.getLatestBlockhash();
    const tx = new Transaction({
      feePayer: toPubkey,
      recentBlockhash: blockhash,
    }).add(...instructions);

    tx.partialSign(fromWallet);

    const serialized = tx.serialize({
      requireAllSignatures: false,
      verifySignatures: false,
    }).toString('base64');

    res.json({ tx: serialized, amount });
  } catch (err) {
    console.error('❌ Backend Error:', err);
    res.status(500).json({ error: '❌ Failed to generate transaction' });
  }
});

app.post('/confirm-claim', (req, res) => {
  const wallet = req.body.userAddress?.trim();
  if (!wallet || !whitelist[wallet]) {
    return res.status(400).json({ error: 'Invalid or already claimed.' });
  }

  delete whitelist[wallet];
  let csvData = 'wallet_address,claim_amount\n';
  for (const [addr, amt] of Object.entries(whitelist)) {
    csvData += `${addr},${amt}\n`;
  }
  fs.writeFileSync('whitelist.csv', csvData);
  res.json({ success: true });
});

app.listen(5000, () => {
  console.log('🚀 Backend running on port 5000');
});
