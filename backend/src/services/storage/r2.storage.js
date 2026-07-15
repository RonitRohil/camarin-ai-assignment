const {
    S3Client,
    PutObjectCommand,
    GetObjectCommand,
} = require("@aws-sdk/client-s3");
const { getSignedUrl: getPresignedUrl } = require("@aws-sdk/s3-request-presigner");
const env = require("../../config/env");

const SIGNED_URL_EXPIRY_SECONDS = 3600;

const s3_client = new S3Client({
    region: "auto",
    endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
        accessKeyId: env.R2_ACCESS_KEY_ID,
        secretAccessKey: env.R2_SECRET_ACCESS_KEY,
    },
});

const putObject = async (storage_key, buffer, mime_type) => {
    await s3_client.send(
        new PutObjectCommand({
            Bucket: env.R2_BUCKET_NAME,
            Key: storage_key,
            Body: buffer,
            ContentType: mime_type,
        })
    );
};

const getObject = async (storage_key) => {
    const response = await s3_client.send(
        new GetObjectCommand({ Bucket: env.R2_BUCKET_NAME, Key: storage_key })
    );
    return Buffer.from(await response.Body.transformToByteArray());
};

const getSignedUrl = async (storage_key) => {
    return getPresignedUrl(
        s3_client,
        new GetObjectCommand({ Bucket: env.R2_BUCKET_NAME, Key: storage_key }),
        { expiresIn: SIGNED_URL_EXPIRY_SECONDS }
    );
};

module.exports = { putObject, getObject, getSignedUrl };
