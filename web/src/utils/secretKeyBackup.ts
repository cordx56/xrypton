import { apiClient, authApiClient } from "@/api/client";
import type { WorkerEventWaiter } from "@/hooks/useWorker";
import { WorkerCallMessage } from "@/utils/schema";
import { z } from "zod";
import { getWebAuthnPrfResult } from "@/utils/webauthnPrf";

type WorkerBridge = {
  eventWaiter: WorkerEventWaiter;
  postMessage: (msg: z.infer<typeof WorkerCallMessage>) => void;
};

type BackupPayload = {
  subpassphrase: string;
  secret_key: string;
};

type SignedAuth = {
  signedMessage: string;
  userId: string;
};

async function workerEncryptBackup(
  worker: WorkerBridge,
  payloadJson: string,
  mainPassphrase: string,
  prfOutputB64: string,
  credentialIdB64: string,
): Promise<string> {
  return new Promise((resolve, reject) => {
    worker.eventWaiter("backup_encrypt", (result) => {
      if (result.success) {
        resolve(result.data.armored);
      } else {
        reject(new Error(result.message));
      }
    });
    worker.postMessage({
      call: "backup_encrypt",
      payloadJson,
      mainPassphrase,
      prfOutputB64,
      credentialIdB64,
    });
  });
}

async function workerDecryptBackup(
  worker: WorkerBridge,
  armored: string,
  mainPassphrase: string,
  prfOutputB64: string,
  credentialIdB64: string,
): Promise<BackupPayload> {
  const payloadJson = await new Promise<string>((resolve, reject) => {
    worker.eventWaiter("backup_decrypt", (result) => {
      if (result.success) {
        resolve(result.data.payloadJson);
      } else {
        reject(new Error(result.message));
      }
    });
    worker.postMessage({
      call: "backup_decrypt",
      armored,
      mainPassphrase,
      prfOutputB64,
      credentialIdB64,
    });
  });

  const parsed = JSON.parse(payloadJson) as BackupPayload;
  if (!parsed.secret_key || !parsed.subpassphrase) {
    throw new Error("Invalid backup payload");
  }
  return parsed;
}

export async function saveSecretKeyBackup(params: {
  worker: WorkerBridge;
  signed: SignedAuth;
  secretKey: string;
  subpassphrase: string;
  mainPassphrase: string;
}): Promise<void> {
  const prf = await getWebAuthnPrfResult();
  const payloadJson = JSON.stringify({
    secret_key: params.secretKey,
    subpassphrase: params.subpassphrase,
  });

  const armored = await workerEncryptBackup(
    params.worker,
    payloadJson,
    params.mainPassphrase,
    prf.prfOutputB64,
    prf.credentialIdB64,
  );

  await authApiClient(params.signed.signedMessage).user.putSecretKeyBackup(
    params.signed.userId,
    {
      armor: armored,
      version: 1,
      webauthn_credential_id_b64: prf.credentialIdB64,
    },
  );
}

export async function restoreSecretKeyBackup(params: {
  worker: WorkerBridge;
  userId: string;
  mainPassphrase: string;
}): Promise<BackupPayload> {
  const backup = await apiClient().user.getSecretKeyBackup(params.userId);
  const prf = await getWebAuthnPrfResult(backup.webauthn_credential_id_b64);
  return workerDecryptBackup(
    params.worker,
    backup.armor,
    params.mainPassphrase,
    prf.prfOutputB64,
    prf.credentialIdB64,
  );
}
