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
  params: async (req, file) => {
    const isPdf   = file.mimetype === 'application/pdf' || file.originalname?.toLowerCase().endsWith('.pdf');
    const isImage = file.mimetype?.startsWith('image/');
    const isVideo = file.mimetype?.startsWith('video/');
    return {
      folder:          'eloc-files',
      resource_type:   isVideo ? 'video' : isImage ? 'image' : 'raw',
      allowed_formats: ['pdf', 'jpg', 'jpeg', 'png', 'docx', 'mp4', 'mp3', 'gif', 'webp'],
      public_id: isPdf
        ? `${Date.now()}_${file.originalname.replace(/\s+/g, '_').replace(/[^a-zA-Z0-9._-]/g, '')}`
        : undefined,
    };
  },
});

export const upload = multer({ storage, limits: { fileSize: 20 * 1024 * 1024 } }); // 20MB
export { cloudinary };
