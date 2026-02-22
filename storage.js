const { S3Client, PutObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const path = require('path');
const fs = require('fs');

const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID;
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID;
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY;
const R2_BUCKET_NAME = process.env.R2_BUCKET_NAME;
const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL; // e.g. https://images.yourdomain.com

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

function generateFileName(originalName, prefix = 'room') {
    const ext = path.extname(originalName).toLowerCase();
    return `${prefix}_${Date.now()}_${Math.random().toString(36).substring(2, 8)}${ext}`;
}

async function uploadFile(fileBuffer, fileName, mimeType) {
    if (!isCloudStorage) {
        const uploadsDir = process.env.UPLOADS_DIR || path.join(__dirname, 'uploads');
        if (!fs.existsSync(uploadsDir)) {
            fs.mkdirSync(uploadsDir, { recursive: true });
        }
        const filePath = path.join(uploadsDir, fileName);
        fs.writeFileSync(filePath, fileBuffer);
        return `/uploads/${fileName}`;
    }

    await s3Client.send(new PutObjectCommand({
        Bucket: R2_BUCKET_NAME,
        Key: fileName,
        Body: fileBuffer,
        ContentType: mimeType,
    }));

    return getPublicUrl(fileName);
}

async function deleteFile(imageUrl) {
    if (!imageUrl) return;

    if (!isCloudStorage) {
        const uploadsDir = process.env.UPLOADS_DIR || path.join(__dirname, 'uploads');
        const fileName = path.basename(imageUrl);
        const filePath = path.join(uploadsDir, fileName);
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
        }
        return;
    }

    let key;
    if (R2_PUBLIC_URL && imageUrl.startsWith(R2_PUBLIC_URL)) {
        key = imageUrl.replace(R2_PUBLIC_URL + '/', '');
    } else if (imageUrl.startsWith('/uploads/')) {
        key = imageUrl.replace('/uploads/', '');
    } else {
        key = path.basename(imageUrl);
    }

    await s3Client.send(new DeleteObjectCommand({
        Bucket: R2_BUCKET_NAME,
        Key: key,
    }));
}

function getPublicUrl(fileName) {
    if (R2_PUBLIC_URL) {
        return `${R2_PUBLIC_URL}/${fileName}`;
    }
    return `/uploads/${fileName}`;
}

module.exports = {
    isCloudStorage,
    generateFileName,
    uploadFile,
    deleteFile,
    getPublicUrl,
};
