"use client";

import { useState, useEffect } from "react";

export default function Home() {
  const [userId, setUserId] = useState("");
  const [passPhrase, setPassPhrase] = useState("");

  const [publicKey, setPublicKey] = useState("");

  const [encryptText, setEncryptText] = useState("");
  const [encrypted, setEncrypted] = useState("");

  const [decrypted, setDecrypted] = useState("");

  return (
    <div className="centered">
      <div className="m-4">
        <p className="m-2">
          User ID:{" "}
          <input type="text" onChange={(e) => setUserId(e.target.value)} />
        </p>
        <p className="m-2">
          Pass phrase:{" "}
          <input
            type="password"
            onChange={(e) => setPassPhrase(e.target.value)}
          />
        </p>
        <p className="m-2">
          <button
            onClick={() => {
              generate_and_save_private_keys(userId, passPhrase, passPhrase);
              setPublicKey(export_encryption_public_key().value);
            }}
          >
            generate
          </button>
        </p>
      </div>
      <div className="m-4">
        <h3 className="m-2">Public key</h3>
        <pre>
          <code>{publicKey}</code>
        </pre>
      </div>
      <div className="m-4">
        <h3 className="m-2">Encrypt</h3>
        <p className="m-2">
          <textarea onChange={(e) => setEncryptText(e.target.value)}></textarea>
        </p>
        <p className="m-2">
          <button
            onClick={() => {
              setEncrypted(
                encrypt(publicKey, new TextEncoder().encode(encryptText)).value,
              );
            }}
          >
            Encrypt
          </button>
        </p>
        <pre className="m-2">
          <code>{encrypted}</code>
        </pre>
      </div>
      <div className="m-4">
        <h3 className="m-2">Decrypt</h3>
        <p>
          <button
            onClick={() => {
              const result = decrypt(passPhrase, encrypted);
              console.log(result);
              setDecrypted(new TextDecoder().decode(result.value.buffer));
            }}
          >
            Decrypt
          </button>
        </p>

        <pre className="m-2">
          <code>{decrypted}</code>
        </pre>
      </div>
    </div>
  );
}
