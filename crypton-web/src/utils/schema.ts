import { z } from "zod";

export const WasmResultData = z.union([
  z.object({ type: z.literal("string"), data: z.string() }),
  z.object({ type: z.literal("base64"), data: z.string() }),
]);

export const WasmReturnValue = z.union([
  z.object({ result: z.literal("ok"), value: WasmResultData.nullish() }),
  z.object({ result: z.literal("error"), message: z.string() }),
]);

export const WorkerResultCallList = {
  generate: "generate",
  export_public_keys: "export_public_keys",
  encrypt: "encrypt",
  decrypt: "decrypt",
} as const;
export type WorkerResultCall =
  (typeof WorkerResultCallList)[keyof typeof WorkerResultCallList];

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
    keys: z.string(),
    payload: z.base64(),
  }),
  z.object({
    call: z.literal(WorkerResultCallList["decrypt"]),
    keys: z.string(),
    passPhrase: z.string(),
    message: z.string(),
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
    result: WorkerResult(z.object({ payload: z.base64() })),
  }),
]);
