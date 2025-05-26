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

// Enhanced CORS configuration
app.use(cors({
  origin: '*',
  methods: ['POST', 'GET'],
  allowedHeaders: ['Content-Type']
}));
app.use(bodyParser.json());

// Initialize Solana connection
const connection = new Connection(
  process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com',
  'confirmed'
);
const fromPubkey = new PublicKey(process.env.AIRDROP_WALLET_PUBLIC_KEY);
const mint = new PublicKey(process.env.TOKEN_MINT_ADDRESS || '5B7gEKg5jSKEhHwAdXn3MkAGGHAfMfDQyamVXBnMVJN5');

// Whitelist management
let whitelist = {};

// Load whitelist with robust error handling
function loadWhitelist() {
  return new Promise((resolve, reject) => {
    const stream = fs.createReadStream('whitelist.csv')
      .pipe(csv({
        mapHeaders: ({ header }) => header?.trim(),
        mapValues: ({ value }) => value?.trim()
      }))
      .on('data', (row) => {
        try {
          const wallet = row.wallet_address || row['wallet_address'];
          const amount = parseFloat(row.claim_amount || row['claim_amount']);
          
          if (wallet && !isNaN(amount)) {
            const pubkey = new PublicKey(wallet).toString();
            whitelist[pubkey.toLowerCase()] = {
              original: pubkey,
              amount: amount,
              claimed: false
            };
          }
        } catch (err) {
          console.log('Skipped invalid row:', row, err.message);
        }
      })
      .on('end', () => {
        console.log(`✅ Whitelist loaded. Total: ${Object.keys(whitelist).length} addresses`);
        resolve();
      })
      .on('error', (err) => {
        console.error('Error loading whitelist:', err);
        reject(err);
      });
  });
}

// Generate claim transaction
app.post('/generate-claim-tx', async (req, res) => {
  try {
    const wallet = req.body.userAddress?.trim();
    if (!wallet) {
      return res.status(400).json({ 
        success: false,
        error: 'Wallet address is required' 
      });
    }

    // Validate and normalize address
    let userPubkey, normalizedWallet;
    try {
      userPubkey = new PublicKey(wallet);
      normalizedWallet = userPubkey.toString().toLowerCase();
    } catch (err) {
      return res.status(400).json({ 
        success: false,
        error: 'Invalid Solana wallet address' 
      });
    }

    // Check whitelist status
    const entry = whitelist[normalizedWallet];
    if (!entry || entry.claimed) {
      return res.status(403).json({ 
        success: false,
        error: 'Not eligible or already claimed',
        debug: {
          input: wallet,
          normalized: normalizedWallet,
          whitelistSample: Object.keys(whitelist).slice(0, 3)
        }
      });
    }

    // Check token accounts
    const fromTokenAccount = await getAssociatedTokenAddress(mint, fromPubkey);
    const toTokenAccount = await getAssociatedTokenAddress(mint, userPubkey);

    // Create transfer instruction
    const amountInLamports = Math.floor(entry.amount * 1e9);
    const transferIx = createTransferInstruction(
      fromTokenAccount,
      toTokenAccount,
      fromPubkey,
      amountInLamports,
      [],
      TOKEN_PROGRAM_ID
    );

    // Build transaction
    const { blockhash } = await connection.getLatestBlockhash();
    const tx = new Transaction({
      feePayer: userPubkey, // User pays fee
      recentBlockhash: blockhash,
    }).add(transferIx);

    const serializedTx = tx.serialize({
      requireAllSignatures: false,
      verifySignatures: false
    });

    res.json({ 
      success: true,
      tx: serializedTx.toString('base64'),
      amount: entry.amount,
      message: 'Please sign this transaction to claim your tokens'
    });

  } catch (err) {
    console.error('❌ Transaction generation error:', err);
    res.status(500).json({ 
      success: false,
      error: 'Failed to generate transaction',
      details: err.message 
    });
  }
});

// Confirm claim and update whitelist
app.post('/confirm-claim', async (req, res) => {
  try {
    const wallet = req.body.userAddress?.trim();
    if (!wallet) {
      return res.status(400).json({ success: false, error: 'Wallet address required' });
    }

    // Validate address
    let normalizedWallet;
    try {
      normalizedWallet = new PublicKey(wallet).toString().toLowerCase();
    } catch (err) {
      return res.status(400).json({ success: false, error: 'Invalid wallet address' });
    }

    // Update whitelist
    if (whitelist[normalizedWallet]) {
      whitelist[normalizedWallet].claimed = true;
      updateWhitelistFile();
    }

    res.json({ success: true });

  } catch (err) {
    console.error('Confirm claim error:', err);
    res.status(500).json({ success: false, error: 'Failed to confirm claim' });
  }
});

// Update whitelist file
function updateWhitelistFile() {
  try {
    let csvData = 'wallet_address,claim_amount\n';
    for (const [_, entry] of Object.entries(whitelist)) {
      if (!entry.claimed) {
        csvData += `${entry.original},${entry.amount}\n`;
      }
    }
    fs.writeFileSync('whitelist.csv', csvData);
    console.log('📝 Whitelist file updated');
  } catch (err) {
    console.error('Error updating whitelist file:', err);
  }
}

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy',
    whitelistCount: Object.keys(whitelist).length,
    tokenMint: mint.toString(),
    airdropWallet: fromPubkey.toString()
  });
});

// Initialize server
async function startServer() {
  try {
    await loadWhitelist();
    
    // Check token account balance
    const tokenAccount = await getAssociatedTokenAddress(mint, fromPubkey);
    const balance = await connection.getTokenAccountBalance(tokenAccount);
    console.log(`💰 Token balance: ${balance.value.uiAmount} ${balance.value.symbol}`);
    
    app.listen(PORT, () => {
      console.log(`🚀 Server running on port ${PORT}`);
      console.log(`🔗 Token Mint: ${mint.toString()}`);
      console.log(`📌 Airdrop Wallet: ${fromPubkey.toString()}`);
    });
  } catch (err) {
    console.error('❌ Failed to start server:', err);
    process.exit(1);
  }
}

startServer();
