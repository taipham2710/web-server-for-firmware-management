// server.js - Web Server for OTA Firmware Updates
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const sqlite3 = require('sqlite3').verbose();

// Load environment variables
require('dotenv').config();

const db = new sqlite3.Database(process.env.DATABASE_PATH || './firmware.db');
const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

// CORS middleware
app.use((req, res, next) => {
  const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:3000'];
  const origin = req.headers.origin;
  
  if (allowedOrigins.includes(origin)) {
    res.header('Access-Control-Allow-Origin', origin);
  }
  
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  next();
});

// Authentication middleware
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN
  
  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  // Check token for upload (CI/CD)
  if (req.path === '/api/firmware/upload' && token === process.env.UPLOAD_TOKEN) {
    return next();
  }

  // Check token for other operations
  if (token === process.env.API_TOKEN) {
    return next();
  }
  
  return res.status(403).json({ error: 'Invalid token' });
};

// Function to calculate checksum
const calculateChecksum = (filePath) => {
  const fileBuffer = fs.readFileSync(filePath);
  return crypto.createHash('md5').update(fileBuffer).digest('hex');
};

// Setup storage for multer to upload firmware
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, 'firmware');
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    // Create file name based on version and device type
    const version = req.body.version || 'unknown';
    const device = req.body.device || 'esp32';
    cb(null, `${device}-firmware-v${version}${path.extname(file.originalname)}`);
  }
});

const upload = multer({
  storage: storage,
  fileFilter: (req, file, cb) => {
    // Only accept .bin files
    if (path.extname(file.originalname) !== '.bin') {
      return cb(new Error('Only .bin firmware files are allowed!'));
    }
    cb(null, true);
  },
  limits: {
    fileSize: 10 * 1024 * 1024 // Limit to 10MB
  }
});

// Route to get the latest version information (ESP32 compatible format)
app.get('/api/firmware/version', (req, res) => {
  try {
    const device = req.query.device || 'esp32';

    // Get latest version from database
    db.get('SELECT * FROM firmware_versions WHERE device = ? ORDER BY upload_date DESC LIMIT 1', [device], (err, row) => {
      if (err) {
        console.error('Database error:', err);
        return res.status(500).json({ error: 'Database error' });
      }
      
      if (!row) {
        return res.status(404).json({ error: 'No firmware found for device' });
      }

      // Format for ESP32
      const versionData = {
        version: `v${row.version}`,
        url: `${req.protocol}://${req.get('host')}/api/firmware/download?device=${device}&version=v${row.version}`,
        checksum: row.checksum || 'unknown',
        notes: row.notes || '',
        uploadDate: row.upload_date
      };
      
      res.json(versionData);
    });
  } catch (error) {
    console.error('Error getting version:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Route to download firmware
app.get('/api/firmware/download', (req, res) => {
  try {
    const device = req.query.device || 'esp32';
    const version = req.query.version;
    
    if (!version) {
      return res.status(400).json({ error: 'Missing version information' });
    }

    // Remove 'v' prefix if present
    const cleanVersion = version.replace(/^v/, '');
    
    const firmwareDir = path.join(__dirname, 'firmware');
    const firmwarePath = path.join(firmwareDir, `${device}-firmware-v${cleanVersion}.bin`);
    
    if (!fs.existsSync(firmwarePath)) {
      return res.status(404).json({ error: 'Firmware not found for the requested version and device' });
    }

    // Set headers for download
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${path.basename(firmwarePath)}"`);
    
    res.download(firmwarePath);
  } catch (error) {
    console.error('Error downloading firmware:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Route to upload new firmware (authentication required)
app.post('/api/firmware/upload', authenticateToken, upload.single('firmware'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }
    
    const { version, device, notes } = req.body;
    
    if (!version) {
      return res.status(400).json({ error: 'Missing version information' });
    }

    // Calculate checksum for the file
    const checksum = calculateChecksum(req.file.path);

    // Save to database
    const stmt = db.prepare(`INSERT INTO firmware_versions (version, device, notes, upload_date, file_name, checksum) VALUES (?, ?, ?, ?, ?, ?)`);
    stmt.run(version, device || 'esp32', notes || '', new Date().toISOString(), req.file.filename, checksum);
    stmt.finalize();
    
    console.log(`Firmware uploaded: ${req.file.filename}, version: ${version}, checksum: ${checksum}`);
    
    res.json({
      success: true,
      message: 'Upload firmware successful',
      file: req.file.filename,
      version: version,
      checksum: checksum
    });
  } catch (error) {
    console.error('Error uploading firmware:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Route for ESP32 to report update results
app.post('/api/log', (req, res) => {
  try {
    const { device_id, status, version, error_message } = req.body;
    
    if (!device_id || !status || !version) {
      return res.status(400).json({ error: 'Missing required information' });
    }

    // Save log to database
    const stmt = db.prepare(`INSERT INTO update_logs (device_id, status, version, error_message, timestamp) VALUES (?, ?, ?, ?, ?)`);
    stmt.run(device_id, status, version, error_message || null, new Date().toISOString());
    stmt.finalize();
    
    console.log(`Update log: Device ${device_id}, Status: ${status}, Version: ${version}`);
    
    res.json({
      success: true,
      message: 'Log recorded successfully'
    });
  } catch (error) {
    console.error('Error recording log:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Route to get firmware version history (authentication required)
app.get('/api/firmware/history', authenticateToken, (req, res) => {
  db.all('SELECT * FROM firmware_versions ORDER BY upload_date DESC', [], (err, rows) => {
    if (err) {
      return res.status(500).json({ error: 'Database query error' });
    }
    res.json(rows);
  });
});

// Route to delete firmware and associated data (authentication required)
app.delete('/api/firmware/:version', authenticateToken, (req, res) => {
  try {
    const version = req.params.version;
    const device = req.query.device || 'esp32';

    // Remove 'v' prefix if present
    const cleanVersion = version.replace(/^v/, '');

    // Delete firmware file
    const firmwarePath = path.join(__dirname, 'firmware', `${device}-firmware-v${cleanVersion}.bin`);
    if (fs.existsSync(firmwarePath)) {
      fs.unlinkSync(firmwarePath);
    }

    // Delete data from database
    db.run('DELETE FROM firmware_versions WHERE version = ? AND device = ?', [cleanVersion, device], function(err) {
      if (err) {
        return res.status(500).json({ error: 'Database deletion error' });
      }
      
      console.log(`Firmware deleted: ${device}-firmware-v${cleanVersion}.bin`);
      
      res.json({
        success: true,
        message: 'Firmware and associated data deleted successfully'
      });
    });
  } catch (error) {
    console.error('Error deleting firmware:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Route to get logs (authentication required)
app.get('/api/logs', authenticateToken, (req, res) => {
  const limit = req.query.limit || 100;
  db.all('SELECT * FROM update_logs ORDER BY timestamp DESC LIMIT ?', [limit], (err, rows) => {
    if (err) {
      return res.status(500).json({ error: 'Database query error' });
    }
    res.json(rows);
  });
});

// User interface
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    version: '1.0.0'
  });
});

// Start server
app.listen(port, () => {
  console.log(`🚀 OTA Server is running at http://localhost:${port}`);
  console.log(`📊 Health check: http://localhost:${port}/health`);
});

// Initialize database
db.serialize(() => {
  // Firmware versions table
  db.run(`CREATE TABLE IF NOT EXISTS firmware_versions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    version TEXT NOT NULL,
    device TEXT NOT NULL,
    notes TEXT,
    upload_date TEXT NOT NULL,
    file_name TEXT NOT NULL,
    checksum TEXT
  )`);

  // Update logs table
  db.run(`CREATE TABLE IF NOT EXISTS update_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    device_id TEXT NOT NULL,
    status TEXT NOT NULL,
    version TEXT NOT NULL,
    error_message TEXT,
    timestamp TEXT NOT NULL
  )`);
  
  console.log('✅ Database initialized successfully');
});