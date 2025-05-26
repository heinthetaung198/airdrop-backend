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

const connection = new Connection(process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com');
const fromPubkey = new PublicKey(process.env.AIRDROP_WALLET_PUBLIC_KEY);
const mint = new PublicKey(process.env.TOKEN_MINT_ADDRESS || '5B7gEKg5jSKEhHwAdXn3MkAGGHAfMfDQyamVXBnMVJN5');

let whitelist = {};

// Enhanced CSV loading with error handling
fs.createReadStream('whitelist.csv')
  .pipe(csv({
    mapHeaders: ({ header }) => header.trim(),
    mapValues: ({ value }) => value.trim()
  }))
  .on('data', (row) => {
    try {
      const wallet = row.wallet_address;
      const amount = parseFloat(row.claim_amount);
      
      if (wallet && !isNaN(amount)) {
        const pubkey = new PublicKey(wallet).toString();
        whitelist[pubkey.toLowerCase()] = {
          original: pubkey,
          amount: amount,
          claimed: false
        };
      }
    } catch (err) {
      console.log('Skipped invalid row:', row);
    }
  })
  .on('end', () => {
    console.log(`✅ Whitelist loaded. Total: ${Object.keys(whitelist).length} addresses`);
  });

// Generate unsigned transaction
app.post('/generate-claim-tx', async (req, res) => {
  try {
    const wallet = req.body.userAddress?.trim();
    if (!wallet) {
      return res.status(400).json({ error: 'Wallet address required' });
    }

    // Normalize address
    let userPubkey, normalizedWallet;
    try {
      userPubkey = new PublicKey(wallet);
      normalizedWallet = userPubkey.toString().toLowerCase();
    } catch (err) {
      return res.status(400).json({ error: 'Invalid Solana address' });
    }

    // Check eligibility
    const entry = whitelist[normalizedWallet];
    if (!entry || entry.claimed) {
      return res.status(403).json({ error: 'Not eligible or already claimed' });
    }

    // Prepare transfer
    const amount = entry.amount;
    const amountInLamports = Math.floor(amount * 1e9);

    const fromTokenAccount = await getAssociatedTokenAddress(mint, fromPubkey);
    const toTokenAccount = await getAssociatedTokenAddress(mint, userPubkey);

    // Create transfer instruction
    const transferIx = createTransferInstruction(
      fromTokenAccount,
      toTokenAccount,
      fromPubkey,
      amountInLamports
    );

    // Build unsigned transaction (user will sign and pay fee)
    const { blockhash } = await connection.getLatestBlockhash();
    const tx = new Transaction({
      feePayer: userPubkey, // User pays fee
      recentBlockhash: blockhash,
    }).add(transferIx);

    const serializedTx = tx.serialize({
      requireAllSignatures: false, // Unsigned
      verifySignatures: false
    }).toString('base64');

    res.json({ 
      success: true,
      tx: serializedTx,
      amount: amount,
      message: 'Please sign the transaction to claim your tokens'
    });

  } catch (err) {
    console.error('Claim error:', err);
    res.status(500).json({ 
      error: 'Transaction failed',
      details: err.message 
    });
  }
});

// Confirm claim (optional - for tracking)
app.post('/confirm-claim', (req, res) => {
  const wallet = req.body.userAddress?.trim();
  if (!wallet) {
    return res.status(400).json({ error: 'Wallet address required' });
  }

  try {
    const normalizedWallet = new PublicKey(wallet).toString().toLowerCase();
    if (whitelist[normalizedWallet]) {
      whitelist[normalizedWallet].claimed = true;
      updateWhitelistFile();
    }
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: 'Invalid wallet address' });
  }
});

// Update whitelist file
function updateWhitelistFile() {
  let csvData = 'wallet_address,claim_amount\n';
  for (const [_, entry] of Object.entries(whitelist)) {
    if (!entry.claimed) {
      csvData += `${entry.original},${entry.amount}\n`;
    }
  }
  fs.writeFileSync('whitelist.csv', csvData);
}

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`🔗 Token Mint: ${mint.toString()}`);
  console.log(`💰 Airdrop Wallet: ${fromPubkey.toString()}`);
});
