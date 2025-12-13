import { z } from "zod";

export const WasmResultData = z.union([
  z.object({ type: z.literal("string"), data: z.string() }),
  z.object({ type: z.literal("base64"), data: z.string() }),
]);

export const WasmReturnValue = z.union([
  z.object({ result: z.literal("ok"), value: WasmResultData.nullish() }),
  z.object({ result: z.literal("error"), message: z.string() }),
]);

export const WorkerCallMessage = z.union([
  z.object({
    call: z.literal("init"),
    wasmUrl: z.string().nullish(),
  }),
  z.object({
    call: z.literal("generate"),
    userId: z.string(),
    mainPassphrase: z.string(),
    subPassphrase: z.string(),
  }),
  z.object({
    call: z.literal("export_public_keys"),
    keys: z.string(),
  }),
]);

const CommonResult = (schema: unknown) =>
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
    call: z.literal("generate"),
    ...CommonResult(z.object({ keys: z.string() })),
  }),
  z.object({
    call: z.literal("export_public_keys"),
    ...CommonResult(z.object({ keys: z.string() })),
  }),
]);
