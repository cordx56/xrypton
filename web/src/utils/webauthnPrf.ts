import { bytesToBase64 } from "@/utils/base64";

export type WebAuthnPrfResult = {
  credentialIdB64: string;
  prfOutputB64: string;
};

const PRF_CONTEXT = new TextEncoder().encode("xrypton-backup-prf-v1");

function randomChallenge(): Uint8Array {
  const challenge = new Uint8Array(new ArrayBuffer(32));
  crypto.getRandomValues(challenge);
  return challenge;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const view = new Uint8Array(new ArrayBuffer(bytes.length));
  view.set(bytes);
  return view.buffer;
}

function ensureBrowserSupport(): void {
  if (typeof window === "undefined" || !("PublicKeyCredential" in window)) {
    throw new Error("WebAuthn is not supported");
  }
}

export async function getWebAuthnPrfResult(
  expectedCredentialIdB64?: string,
): Promise<WebAuthnPrfResult> {
  ensureBrowserSupport();

  const challenge = randomChallenge();
  const options: PublicKeyCredentialRequestOptions = {
    challenge: toArrayBuffer(challenge),
    timeout: 60_000,
    userVerification: "required",
    extensions: {
      prf: {
        eval: {
          first: toArrayBuffer(PRF_CONTEXT),
        },
      },
    },
  };

  if (expectedCredentialIdB64) {
    options.allowCredentials = [
      {
        type: "public-key",
        id: toArrayBuffer(
          Uint8Array.from(atob(expectedCredentialIdB64), (c) =>
            c.charCodeAt(0),
          ),
        ),
      },
    ];
  }

  const credential = await navigator.credentials.get({ publicKey: options });
  if (!(credential instanceof PublicKeyCredential)) {
    throw new Error("WebAuthn credential was not returned");
  }

  const extensionResult = credential.getClientExtensionResults();
  const prf = extensionResult.prf;
  const outputs = prf?.results;
  const firstOutput = outputs?.first;
  if (!(firstOutput instanceof ArrayBuffer) || firstOutput.byteLength === 0) {
    throw new Error("WebAuthn PRF output is unavailable");
  }

  const credentialIdB64 = bytesToBase64(new Uint8Array(credential.rawId));
  if (expectedCredentialIdB64 && credentialIdB64 !== expectedCredentialIdB64) {
    throw new Error("WebAuthn credential mismatch");
  }

  return {
    credentialIdB64,
    prfOutputB64: bytesToBase64(new Uint8Array(firstOutput)),
  };
}
