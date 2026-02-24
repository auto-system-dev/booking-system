const { S3Client, PutObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const path = require('path');
const fs = require('fs');

const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID;
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID;
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY;
const R2_BUCKET_NAME = process.env.R2_BUCKET_NAME;
const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL; // e.g. https://images.yourdomain.com
const STORAGE_PREFIX = (process.env.STORAGE_PREFIX || '')
    .trim()
    .replace(/^\/+|\/+$/g, '');

const isCloudStorage = !!(R2_ACCOUNT_ID && R2_ACCESS_KEY_ID && R2_SECRET_ACCESS_KEY && R2_BUCKET_NAME);

let s3Client = null;

if (isCloudStorage) {
    s3Client = new S3Client({
        region: 'auto',
        endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
        credentials: {
            accessKeyId: R2_ACCESS_KEY_ID,
            secretAccessKey: R2_SECRET_ACCESS_KEY,
        },
    });
    console.log('☁️  圖片儲存模式: Cloudflare R2');
} else {
    console.log('💾 圖片儲存模式: 本地磁碟（未設定 R2 環境變數）');
}

if (STORAGE_PREFIX) {
    console.log(`🗂️  圖片路徑前綴: ${STORAGE_PREFIX}`);
}

function getSafePathSegments(objectKey = '') {
    return String(objectKey)
        .split('/')
        .map(part => part.trim())
        .filter(part => part && part !== '.' && part !== '..');
}

function buildObjectKey(fileName) {
    const safeFileName = path.basename(fileName);
    return STORAGE_PREFIX ? `${STORAGE_PREFIX}/${safeFileName}` : safeFileName;
}

function extractObjectKey(imageUrl = '') {
    const normalized = String(imageUrl || '').trim();
    if (!normalized) return '';

    if (R2_PUBLIC_URL && normalized.startsWith(`${R2_PUBLIC_URL}/`)) {
        return decodeURIComponent(normalized.slice(R2_PUBLIC_URL.length + 1).split('?')[0]);
    }

    if (normalized.startsWith('/uploads/')) {
        return decodeURIComponent(normalized.slice('/uploads/'.length).split('?')[0]);
    }

    try {
        const parsed = new URL(normalized);
        return decodeURIComponent(parsed.pathname.replace(/^\/+/, '')).split('?')[0];
    } catch (_) {
        return path.basename(normalized.split('?')[0]);
    }
}

function generateFileName(originalName, prefix = 'room') {
    const ext = path.extname(originalName).toLowerCase();
    return `${prefix}_${Date.now()}_${Math.random().toString(36).substring(2, 8)}${ext}`;
}

async function uploadFile(fileBuffer, fileName, mimeType) {
    const objectKey = buildObjectKey(fileName);

    if (!isCloudStorage) {
        const uploadsDir = process.env.UPLOADS_DIR || path.join(__dirname, 'uploads');
        if (!fs.existsSync(uploadsDir)) {
            fs.mkdirSync(uploadsDir, { recursive: true });
        }
        const filePath = path.join(uploadsDir, ...getSafePathSegments(objectKey));
        const parentDir = path.dirname(filePath);
        if (!fs.existsSync(parentDir)) {
            fs.mkdirSync(parentDir, { recursive: true });
        }
        fs.writeFileSync(filePath, fileBuffer);
        return `/uploads/${objectKey}`;
    }

    await s3Client.send(new PutObjectCommand({
        Bucket: R2_BUCKET_NAME,
        Key: objectKey,
        Body: fileBuffer,
        ContentType: mimeType,
    }));

    return getPublicUrl(objectKey);
}

async function deleteFile(imageUrl) {
    if (!imageUrl) return;
    const objectKey = extractObjectKey(imageUrl);
    if (!objectKey) return;

    if (!isCloudStorage) {
        const uploadsDir = process.env.UPLOADS_DIR || path.join(__dirname, 'uploads');
        const filePath = path.join(uploadsDir, ...getSafePathSegments(objectKey));
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
        }
        return;
    }

    await s3Client.send(new DeleteObjectCommand({
        Bucket: R2_BUCKET_NAME,
        Key: objectKey,
    }));
}

function getPublicUrl(objectKey) {
    if (R2_PUBLIC_URL) {
        return `${R2_PUBLIC_URL}/${objectKey}`;
    }
    return `/uploads/${objectKey}`;
}

module.exports = {
    isCloudStorage,
    generateFileName,
    uploadFile,
    deleteFile,
    getPublicUrl,
};
