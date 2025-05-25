const bs58 = require('bs58'); // ✅ correct way for CommonJS

const secretKeyBase58 = 'N3AUTWN7GYLL5tN7PAVScWLQDfkUtjbjYkA24ac8en1XpcCXRHEdyah2VuVDS4rTYSHsRNQv7ADkg4DPM7m4vr9'; // Phantom export key
const decoded = bs58.default.decode(secretKeyBase58); // ✅ Fix here

console.log(JSON.stringify([...decoded]));
