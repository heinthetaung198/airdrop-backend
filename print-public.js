const { Keypair } = require('@solana/web3.js');
const fs = require('fs');

const secret = Uint8Array.from(JSON.parse(fs.readFileSync('airdrop-keypair.json', 'utf8')));
const keypair = Keypair.fromSecretKey(secret);
console.log('✅ Public Key:', keypair.publicKey.toBase58());
