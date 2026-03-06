import { v2 as cloudinary } from 'cloudinary';
import { CloudinaryStorage } from 'multer-storage-cloudinary';
import multer from 'multer';

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key:    process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const storage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder: 'eloc-files',
    resource_type: 'auto',   // allows PDFs, images, etc.
    allowed_formats: ['pdf', 'jpg', 'jpeg', 'png', 'docx', 'mp4', 'mp3'],
  },
});

export const upload = multer({ storage, limits: { fileSize: 20 * 1024 * 1024 } }); // 20MB
export { cloudinary };
