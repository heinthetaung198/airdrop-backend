require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { Connection, PublicKey, Transaction } = require('@solana/web3.js');
const {
  getAssociatedTokenAddress,
  getOrCreateAssociatedTokenAccount,
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
const mint = new PublicKey('5B7gEKg5jSKEhHwAdXn3MkAGGHAfMfDQyamVXBnMVJN5');

// ✅ Load whitelist from CSV (lowercase & trimmed)
let whitelist = {};
fs.createReadStream('whitelist.csv')
  .pipe(csv())
  .on('data', (row) => {
    const wallet = row.wallet_address?.trim().toLowerCase();
    const amount = parseFloat(row.claim_amount);
    if (wallet && !isNaN(amount)) {
      whitelist[wallet] = amount;
    }
  })
  .on('end', () => {
    console.log('✅ Whitelist loaded:', Object.keys(whitelist).length, 'wallet(s)');
  });

// ✅ Claim Endpoint
app.post('/generate-claim-tx', async (req, res) => {
  let wallet = req.body.userAddress;

  // Basic validation
  if (!wallet || typeof wallet !== 'string') {
    return res.status(400).json({ error: 'Invalid wallet address format.' });
  }

  wallet = wallet.trim().toLowerCase();

  // Base58 address format check (length: 32-44, only base58 chars)
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(wallet)) {
    return res.status(400).json({ error: 'Wallet address is not valid base58.' });
  }

  if (!whitelist[wallet]) {
    return res.status(403).json({ error: 'You are not eligible or already claimed.' });
  }

  try {
    const toPubkey = new PublicKey(wallet);
    const amount = whitelist[wallet];
    const amountInSmallestUnit = amount * 1e9; // Assuming 9 decimals

    // Token accounts
    const fromTokenAccount = await getAssociatedTokenAddress(mint, fromPubkey);
    const toTokenAccount = await getOrCreateAssociatedTokenAccount(
      connection,
      fromPubkey, // payer
      mint,
      toPubkey
    );

    // Transfer instruction
    const ix = createTransferInstruction(
      fromTokenAccount,
      toTokenAccount.address,
      fromPubkey,
      amountInSmallestUnit,
      [],
      TOKEN_PROGRAM_ID
    );

    const { blockhash } = await connection.getLatestBlockhash();
    const tx = new Transaction({
      feePayer: toPubkey,
      recentBlockhash: blockhash,
    }).add(ix);

    // Serialize transaction
    const serialized = tx.serialize({
      requireAllSignatures: false,
      verifySignatures: false,
    }).toString('base64');

    // ✅ Remove from whitelist after successful tx generation
    delete whitelist[wallet];

    let csvData = 'wallet_address,claim_amount\n';
    for (const [addr, amt] of Object.entries(whitelist)) {
      csvData += `${addr},${amt}\n`;
    }
    fs.writeFileSync('whitelist.csv', csvData);

    res.json({ tx: serialized, amount });
  } catch (err) {
    console.error('❌ Error in generating claim tx:', err);
    res.status(500).json({ error: 'Failed to generate token transfer.' });
  }
});

// ✅ Server Ready
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
