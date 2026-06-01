import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { env } from "../config/env.js";

const algorithm = "aes-256-gcm";

function getKey() {
  return createHash("sha256").update(env.APP_SECRET).digest();
}

export function encryptText(plainText: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv(algorithm, getKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plainText, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString("base64"), tag.toString("base64"), encrypted.toString("base64")].join(":");
}

export function decryptText(cipherText: string) {
  const [ivText, tagText, encryptedText] = cipherText.split(":");
  if (!ivText || !tagText || !encryptedText) {
    throw new Error("加密文本格式无效");
  }
  const decipher = createDecipheriv(algorithm, getKey(), Buffer.from(ivText, "base64"));
  decipher.setAuthTag(Buffer.from(tagText, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedText, "base64")),
    decipher.final()
  ]).toString("utf8");
}
