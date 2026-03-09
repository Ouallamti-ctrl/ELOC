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
      // PDFs must use 'raw' - Cloudinary cannot process PDFs as 'image' type
      // Images use 'image', everything else uses 'raw'
      resource_type:   'auto', // auto = Cloudinary picks correct type (image/raw/video)
      allowed_formats: ['pdf', 'jpg', 'jpeg', 'png', 'docx', 'doc', 'mp4', 'mp3', 'gif', 'webp', 'ppt', 'pptx'],
      // For PDFs: keep .pdf extension in public_id so URL ends with .pdf
      // This lets browsers detect content type from URL
      public_id: isPdf
        ? `${Date.now()}_${file.originalname.replace(/\s+/g, '_').replace(/[^a-zA-Z0-9._-]/g, '')}`
        : undefined,
      // Add Content-Disposition: inline for PDFs so browsers preview instead of download
      type: 'upload',
    };
  },
});

const fileFilter = (req, file, cb) => {
  const allowed = [
    'application/pdf',
    'image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'audio/mpeg', 'audio/mp3', 'video/mp4',
  ];
  const ext = file.originalname?.split('.').pop()?.toLowerCase();
  const allowedExt = ['pdf','jpg','jpeg','png','gif','webp','doc','docx','ppt','pptx','mp3','mp4'];
  if (allowed.includes(file.mimetype) || allowedExt.includes(ext)) {
    cb(null, true);
  } else {
    cb(new Error(`File type not allowed: ${file.mimetype}`), false);
  }
};

export const upload = multer({ storage, fileFilter, limits: { fileSize: 20 * 1024 * 1024 } }); // 20MB
export { cloudinary };
