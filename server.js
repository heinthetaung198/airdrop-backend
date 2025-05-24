require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { Connection, PublicKey, SystemProgram, Transaction } = require('@solana/web3.js');
const fs = require('fs');
const csv = require('csv-parser');
const bodyParser = require('body-parser');

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(bodyParser.json());

const connection = new Connection(process.env.SOLANA_RPC_URL);
const fromPubkey = new PublicKey(process.env.AIRDROP_WALLET_PUBLIC_KEY);

// ✅ Load whitelist from CSV
let whitelist = {};
fs.createReadStream('whitelist.csv')  // ✅ lowercase filename
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
  })
  .on('error', (err) => {
    console.error('❌ Failed to load whitelist.csv:', err.message);
  });

// ✅ Claim Transaction Generator
app.post('/generate-claim-tx', async (req, res) => {
  const { userAddress } = req.body;

  if (!userAddress || !whitelist[userAddress]) {
    return res.status(403).json({ error: 'You are not eligible or already claimed.' });
  }

  const toPubkey = new PublicKey(userAddress);
  const amount = whitelist[userAddress];
  const lamports = amount * 1e9;

  try {
    const { blockhash } = await connection.getLatestBlockhash();

    const transaction = new Transaction({
      feePayer: toPubkey,
      recentBlockhash: blockhash
    }).add(
      SystemProgram.transfer({
        fromPubkey,
        toPubkey,
        lamports
      })
    );

    const txSerialized = transaction.serialize({
      requireAllSignatures: false,
      verifySignatures: false
    }).toString('base64');

    // ✅ Remove from whitelist
    delete whitelist[userAddress];

    // ✅ Save updated whitelist.csv
    let csvData = 'wallet_address,claim_amount\n';
    for (const [addr, amt] of Object.entries(whitelist)) {
      csvData += `${addr},${amt}\n`;
    }
    fs.writeFileSync('whitelist.csv', csvData);

    // ✅ Respond with transaction + amount
    res.json({ tx: txSerialized, amount });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create transaction' });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
