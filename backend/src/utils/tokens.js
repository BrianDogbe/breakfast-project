function makeToken(byteLen = 16) {
  // Hex token (32 chars at byteLen=16)
  const { randomBytes } = require("crypto");
  return randomBytes(byteLen).toString("hex");
}

module.exports = { makeToken };

