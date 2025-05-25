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

// 1. Solana Connection Setup
const connection = new Connection(process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com');
const fromPubkey = new PublicKey(process.env.AIRDROP_WALLET_PUBLIC_KEY);
const mint = new PublicKey(process.env.TOKEN_MINT_ADDRESS || '5B7gEKg5jSKEhHwAdXn3MkAGGHAfMfDQyamVXBnMVJN5');

// 2. Whitelist Loading with Enhanced Debugging
let whitelist = {};
console.log('⏳ Loading whitelist...');
fs.createReadStream('whitelist.csv')
  .pipe(csv({
    mapHeaders: ({ header }) => header.trim(),
    mapValues: ({ value }) => value.trim()
  }))
  .on('data', (row) => {
    try {
      const wallet = (row.wallet_address || row['wallet_address'] || '').trim();
      const amount = parseFloat(row.claim_amount || row['claim_amount']);
      
      if (!wallet) {
        console.log('⚠️ Empty wallet in row:', JSON.stringify(row));
        return;
      }

      // Validate Solana address format
      try {
        const pubkey = new PublicKey(wallet).toString();
        whitelist[pubkey.toLowerCase()] = {
          original: pubkey, // Store original case
          amount: amount
        };
        console.log(`✅ Loaded: ${pubkey} - ${amount} tokens`);
      } catch (err) {
        console.log(`❌ Invalid Solana address: ${wallet}`);
      }
    } catch (err) {
      console.error('Error processing row:', row, 'Error:', err);
    }
  })
  .on('end', () => {
    console.log(`🎉 Whitelist loaded successfully. Total: ${Object.keys(whitelist).length} addresses`);
    console.log('Sample addresses:');
    console.table(Object.entries(whitelist).slice(0, 3));
  });

// 3. Claim Endpoint with Comprehensive Logging
app.post('/generate-claim-tx', async (req, res) => {
  console.log('\n=== New Claim Request ===');
  console.log('Timestamp:', new Date().toISOString());

  try {
    // Input validation
    let wallet = req.body.userAddress?.trim();
    console.log('Input wallet:', wallet);

    if (!wallet) {
      console.log('❌ Empty wallet address provided');
      return res.status(400).json({ error: 'Wallet address is required' });
    }

    // Address normalization
    let pubkey;
    try {
      pubkey = new PublicKey(wallet).toString();
      console.log('Normalized pubkey:', pubkey);
    } catch (err) {
      console.log('❌ Invalid Solana address:', wallet);
      return res.status(400).json({ 
        error: 'Invalid wallet address',
        details: 'Must be a valid Solana base58 address'
      });
    }

    // Whitelist check
    const walletLower = pubkey.toLowerCase();
    const eligibleEntry = whitelist[walletLower];
    
    if (!eligibleEntry) {
      console.log('❌ Address not in whitelist');
      console.log('Whitelist addresses sample:', Object.keys(whitelist).slice(0, 5));
      return res.status(403).json({ 
        error: 'Not eligible for airdrop',
        your_wallet: pubkey,
        whitelist_sample: Object.keys(whitelist).slice(0, 5).map(a => whitelist[a].original)
      });
    }

    console.log('✅ Eligible wallet found:', eligibleEntry);

    // Transaction preparation
    const amount = eligibleEntry.amount;
    const amountInSmallestUnit = Math.floor(amount * 1e9);
    console.log(`💸 Preparing to send ${amount} tokens (${amountInSmallestUnit} lamports)`);

    // Token account handling
    console.log('🔍 Setting up token accounts...');
    const fromTokenAccount = await getAssociatedTokenAddress(mint, fromPubkey);
    const toTokenAccount = await getOrCreateAssociatedTokenAccount(
      connection,
      fromPubkey,
      mint,
      new PublicKey(pubkey),
      true
    );
    console.log('✔️ Token accounts ready');

    // Create transfer instruction
    console.log('📝 Creating transaction...');
    const transferIx = createTransferInstruction(
      fromTokenAccount,
      toTokenAccount.address,
      fromPubkey,
      amountInSmallestUnit
    );

    // Build transaction
    const { blockhash } = await connection.getLatestBlockhash();
    const tx = new Transaction({
      feePayer: fromPubkey,
      recentBlockhash: blockhash,
    }).add(transferIx);

    // Serialize transaction
    const serializedTx = tx.serialize({
      requireAllSignatures: false,
      verifySignatures: false,
    }).toString('base64');
    console.log('📦 Transaction serialized');

    // Update whitelist
    delete whitelist[walletLower];
    updateWhitelistFile();
    console.log('🔄 Whitelist updated');

    // Response
    res.json({ 
      success: true,
      tx: serializedTx, 
      amount: amount,
      message: 'Claim successful!'
    });

  } catch (err) {
    console.error('💥 Claim processing error:', err);
    res.status(500).json({ 
      error: 'Transaction failed',
      details: err.message 
    });
  }
});

// 4. Whitelist Update Helper
function updateWhitelistFile() {
  let csvData = 'wallet_address,claim_amount\n';
  for (const [_, entry] of Object.entries(whitelist)) {
    csvData += `${entry.original},${entry.amount}\n`;
  }
  fs.writeFileSync('whitelist.csv', csvData);
  console.log('📄 Whitelist file updated');
}

// 5. Server Startup
app.listen(PORT, () => {
  console.log(`\n🚀 Server ready at http://localhost:${PORT}`);
  console.log(`🔗 RPC: ${connection.rpcEndpoint}`);
  console.log(`💰 Airdrop Wallet: ${fromPubkey.toString()}`);
  console.log(`🪙 Token Mint: ${mint.toString()}\n`);
});
