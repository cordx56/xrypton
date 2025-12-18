import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
} from "@aws-sdk/client-s3";

const endpoint = process.env.S3_ENDPOINT!;
const region = process.env.REGION!;
const accessKeyId = process.env.AWS_ACCESS_KEY_ID!;
const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY!;
const Bucket = process.env.BUCKET!;

const S3 = new S3Client({
  endpoint,
  region,
  credentials: {
    accessKeyId,
    secretAccessKey,
  },
});

export const put = async (path: string, data: string) => {
  const _result = await S3.send(
    new PutObjectCommand({
      Bucket,
      Key: path,
      Body: data,
    }),
  );
};

export const get = async (path: string) => {
  const result = await S3.send(
    new GetObjectCommand({
      Bucket,
      Key: path,
    }),
  );
  const body = result.Body;
  return await body?.transformToString();
};
