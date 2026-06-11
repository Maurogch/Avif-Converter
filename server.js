const express = require('express');
const multer = require('multer');
const sharp = require('sharp');
const path = require('path');
const fs = require('fs');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

// Temp upload dir
const uploadDir = process.env.UPLOAD_DIR || '/tmp/avif-uploads';
const outputDir = process.env.OUTPUT_DIR || '/tmp/avif-outputs';
[uploadDir, outputDir].forEach(d => fs.mkdirSync(d, { recursive: true }));

app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

// Auto-clean files older than 10 minutes
function cleanOldFiles(dir) {
  const now = Date.now();
  fs.readdirSync(dir).forEach(file => {
    const fp = path.join(dir, file);
    const age = now - fs.statSync(fp).mtimeMs;
    if (age > 10 * 60 * 1000) fs.unlinkSync(fp);
  });
}

const storage = multer.diskStorage({
  destination: uploadDir,
  filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`)
});

const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
  fileFilter: (req, file, cb) => {
    const ok = file.mimetype === 'image/avif' || file.originalname.toLowerCase().endsWith('.avif');
    cb(ok ? null : new Error('Only AVIF files are accepted'), ok);
  }
});

app.post('/convert', upload.array('files', 20), async (req, res) => {
  cleanOldFiles(uploadDir);
  cleanOldFiles(outputDir);

  const format = (req.body.format || 'jpg').toLowerCase();
  if (!['jpg', 'png'].includes(format)) {
    return res.status(400).json({ error: 'Format must be jpg or png' });
  }

  const quality = parseInt(req.body.quality) || 85;
  const results = [];

  for (const file of req.files) {
    try {
      const baseName = path.basename(file.originalname, path.extname(file.originalname));
      const outName = `${Date.now()}-${baseName}.${format}`;
      const outPath = path.join(outputDir, outName);

      let pipeline = sharp(file.path);

      if (format === 'jpg') {
        pipeline = pipeline.jpeg({ quality, mozjpeg: true });
      } else {
        pipeline = pipeline.png({ compressionLevel: 9, adaptiveFiltering: true });
      }

      const info = await pipeline.toFile(outPath);

      results.push({
        originalName: file.originalname,
        outputName: outName,
        originalSize: file.size,
        outputSize: info.size,
        width: info.width,
        height: info.height,
        format: info.format,
        downloadUrl: `/download/${outName}`
      });

      fs.unlinkSync(file.path);
    } catch (err) {
      results.push({ originalName: file.originalname, error: err.message });
      try { fs.unlinkSync(file.path); } catch {}
    }
  }

  res.json({ results });
});

app.get('/download/:filename', (req, res) => {
  const filename = path.basename(req.params.filename); // prevent path traversal
  const filePath = path.join(outputDir, filename);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found or expired' });
  res.download(filePath);
});

app.listen(PORT, () => {
  console.log(`AVIF Converter running at http://localhost:${PORT}`);
});
