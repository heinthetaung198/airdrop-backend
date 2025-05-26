require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { Connection, PublicKey, Transaction } = require('@solana/web3.js');
const {
  getAssociatedTokenAddress,
  createTransferInstruction,
  TOKEN_PROGRAM_ID,
} = require('@solana/spl-token');
const fs = require('fs');
const csv = require('csv-parser');
const bodyParser = require('body-parser');

const app = express();
const PORT = process.env.PORT || 5000;
app.use(cors());
app.use(bodyParser.json());

const connection = new Connection(process.env.SOLANA_RPC_URL);
const fromPubkey = new PublicKey(process.env.AIRDROP_WALLET_PUBLIC_KEY);
const mint = new PublicKey(process.env.TOKEN_MINT_ADDRESS);

let whitelist = {};

fs.createReadStream('whitelist.csv')
  .pipe(csv())
  .on('data', (row) => {
    const wallet = row.wallet_address?.trim();
    const amount = parseFloat(row.claim_amount);
    if (wallet && !isNaN(amount)) {
      whitelist[wallet] = amount;
    }
  })
  .on('end', () => {
    console.log('✅ Whitelist loaded:', Object.keys(whitelist).length, 'wallet(s)');
  });

app.post('/generate-claim-tx', async (req, res) => {
  const wallet = req.body.userAddress?.trim();
  if (!wallet || !whitelist[wallet]) {
    return res.status(403).json({ error: 'You are not eligible or already claimed.' });
  }

  try {
    const toPubkey = new PublicKey(wallet);
    const amount = whitelist[wallet];
    const amountInSmallestUnit = amount * 1e9;

    const fromTokenAccount = await getAssociatedTokenAddress(mint, fromPubkey);
    const toTokenAccount = await getAssociatedTokenAddress(mint, toPubkey);

    const ix = createTransferInstruction(
      fromTokenAccount,
      toTokenAccount,
      fromPubkey,
      amountInSmallestUnit,
      [],
      TOKEN_PROGRAM_ID
    );

    const blockhash = (await connection.getLatestBlockhash()).blockhash;
    const tx = new Transaction({
      feePayer: toPubkey,
      recentBlockhash: blockhash,
    }).add(ix);

    const serialized = tx.serialize({
      requireAllSignatures: false,
      verifySignatures: false,
    }).toString('base64');

    res.json({ tx: serialized, amount });
  } catch (err) {
    console.error('❌ Error:', err);
    res.status(500).json({ error: 'Failed to generate transaction' });
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

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
