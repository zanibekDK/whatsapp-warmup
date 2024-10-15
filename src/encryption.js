const CryptoJS = require('crypto-js');

const SECRET_KEY = process.env.ENCRYPTION_KEY;

function encrypt(data) {
  return CryptoJS.AES.encrypt(JSON.stringify(data), SECRET_KEY).toString();
}

function decrypt(ciphertext) {
  const bytes = CryptoJS.AES.decrypt(ciphertext, SECRET_KEY);
  return JSON.parse(bytes.toString(CryptoJS.enc.Utf8));
}

module.exports = { encrypt, decrypt };
