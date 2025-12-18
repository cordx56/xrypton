import { z } from "zod";

export const WorkerResultCallList = {
  generate: "generate",
  export_public_keys: "export_public_keys",
  encrypt: "encrypt",
  decrypt: "decrypt",
  verify: "verify",
  get_key_id: "get_key_id",
} as const;
export type WorkerResultCall =
  (typeof WorkerResultCallList)[keyof typeof WorkerResultCallList];

export const Contacts = z.record(
  z.string(),
  z.object({ name: z.string(), publicKeys: z.string() }),
);

export const WorkerCallMessage = z.union([
  z.object({
    call: z.literal("init"),
    wasmUrl: z.string().nullish(),
  }),
  z.object({
    call: z.literal(WorkerResultCallList["generate"]),
    userId: z.string(),
    mainPassphrase: z.string(),
    subPassphrase: z.string(),
  }),
  z.object({
    call: z.literal(WorkerResultCallList["export_public_keys"]),
    keys: z.string(),
  }),
  z.object({
    call: z.literal(WorkerResultCallList["encrypt"]),
    passphrase: z.string(),
    privateKeys: z.string(),
    publicKeys: z.string(),
    payload: z.base64(),
  }),
  z.object({
    call: z.literal(WorkerResultCallList["decrypt"]),
    passphrase: z.string(),
    privateKeys: z.string(),
    knownPublicKeys: Contacts,
    message: z.string(),
  }),
  z.object({
    call: z.literal(WorkerResultCallList["verify"]),
    passphrase: z.string(),
    publicKeys: z.string(),
    message: z.string(),
  }),
  z.object({
    call: z.literal(WorkerResultCallList["get_key_id"]),
    publicKeys: z.string(),
  }),
]);

export const WorkerResult = <T>(schema: T) =>
  z.union([
    z.object({
      success: z.literal(true),
      data: schema,
    }),
    z.object({
      success: z.literal(false),
      message: z.string(),
    }),
  ]);
export const WorkerResultMessage = z.union([
  z.object({
    call: z.literal(WorkerResultCallList["generate"]),
    result: WorkerResult(z.object({ keys: z.string() })),
  }),
  z.object({
    call: z.literal(WorkerResultCallList["export_public_keys"]),
    result: WorkerResult(z.object({ keys: z.string() })),
  }),
  z.object({
    call: z.literal(WorkerResultCallList["encrypt"]),
    result: WorkerResult(z.object({ message: z.string() })),
  }),
  z.object({
    call: z.literal(WorkerResultCallList["decrypt"]),
    result: WorkerResult(
      z.object({ key_ids: z.string().array(), payload: z.base64url() }),
    ),
  }),
  z.object({
    call: z.literal(WorkerResultCallList["get_key_id"]),
    result: WorkerResult(z.object({ key_id: z.string() })),
  }),
]);
