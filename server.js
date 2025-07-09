// server.js - Web Server for OTA Firmware Updates
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const sqlite3 = require('sqlite3').verbose();
const rateLimit = require('express-rate-limit');
const { Parser } = require('json2csv');
const swaggerUi = require('swagger-ui-express');
const swaggerSpecs = require('./swagger');
const logger = require('./logger'); // Import the logger

// Load environment variables
require('dotenv').config();

// Define the data directory, configurable via environment variable
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname);
const FIRMWARE_DIR = path.join(DATA_DIR, 'firmware');
const DB_PATH = path.join(DATA_DIR, 'firmware.db');

// Ensure data directories exist
if (!fs.existsSync(FIRMWARE_DIR)) {
  fs.mkdirSync(FIRMWARE_DIR, { recursive: true });
}

const db = new sqlite3.Database(DB_PATH);
const app = express();
app.set('trust proxy', 1);
app.disable('etag');
const port = process.env.PORT || 3000;

// Rate Limiting Configuration
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: {
    error: 'Too many requests from this IP, please try again later.',
    retryAfter: '15 minutes'
  },
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
  handler: (req, res) => {
    logger.warn(`Rate limit exceeded for IP: ${req.ip}`);
    res.status(429).json({
      error: 'Too many requests from this IP, please try again later.',
      retryAfter: '15 minutes'
    });
  }
});

// Apply rate limiting to all routes
app.use(limiter);

// Stricter rate limiting for upload endpoint
const uploadLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10, // limit each IP to 10 uploads per hour
  message: {
    error: 'Too many upload attempts, please try again later.',
    retryAfter: '1 hour'
  },
  handler: (req, res) => {
    logger.warn(`Upload rate limit exceeded for IP: ${req.ip}`);
    res.status(429).json({
      error: 'Too many upload attempts, please try again later.',
      retryAfter: '1 hour'
    });
  }
});

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

// Request Logging Middleware
app.use((req, res, next) => {
  logger.info(`${req.method} ${req.originalUrl}`, { ip: req.ip });
  next();
});

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
    cb(null, FIRMWARE_DIR);
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

// Swagger Documentation
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpecs, {
  customCss: '.swagger-ui .topbar { display: none }',
  customSiteTitle: 'OTA Firmware Management API Documentation'
}));

/**
 * @swagger
 * /api/firmware/version:
 *   get:
 *     summary: Get the latest firmware version information
 *     description: ESP32 uses this endpoint to check for the latest firmware version
 *     tags: [Firmware]
 *     parameters:
 *       - in: query
 *         name: device
 *         schema:
 *           type: string
 *           default: esp32
 *         description: Device type (esp32, esp8266)
 *     responses:
 *       200:
 *         description: Latest version information
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 id:
 *                   type: integer
 *                   description: Firmware ID
 *                 version:
 *                   type: string
 *                   example: "v1.0.3"
 *                 device:
 *                   type: string
 *                   example: "esp32"
 *                 url:
 *                   type: string
 *                   description: URL to download firmware
 *                 checksum:
 *                   type: string
 *                   description: MD5 checksum of the file
 *                 notes:
 *                   type: string
 *                   description: Version notes
 *                 uploadDate:
 *                   type: string
 *                   format: date-time
 *       404:
 *         description: Firmware not found for device
 *       500:
 *         description: Server error
 */
// Route to get the latest version information (ESP32 compatible format)
app.get('/api/firmware/version', (req, res) => {
  try {
    const device = req.query.device || 'esp32';

    // Get latest version from database
    db.get('SELECT * FROM firmware_versions WHERE device = ? ORDER BY upload_date DESC LIMIT 1', [device], (err, row) => {
      if (err) {
        logger.error('Database error while fetching latest version', { error: err.message });
        return res.status(500).json({ error: 'Database error' });
      }
      
      if (!row) {
        return res.status(404).json({ error: 'No firmware found for device' });
      }

      // Format for ESP32
      const versionData = {
        id: row.id,
        version: `v${row.version}`,
        device: row.device,
        url: `${req.protocol}://${req.get('host')}/api/firmware/download?device=${device}&version=v${row.version}`,
        checksum: row.checksum || 'unknown',
        notes: row.notes || '',
        uploadDate: row.upload_date
      };
      
      res.json(versionData);
    });
  } catch (error) {
    logger.error('Error in /api/firmware/version route', { error: error.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * @swagger
 * /api/firmware/download:
 *   get:
 *     summary: Download firmware
 *     description: ESP32 uses this endpoint to download firmware file
 *     tags: [Firmware]
 *     parameters:
 *       - in: query
 *         name: device
 *         schema:
 *           type: string
 *           default: esp32
 *         description: Device type
 *         required: true
 *       - in: query
 *         name: version
 *         schema:
 *           type: string
 *         description: Firmware version (may have prefix 'v')
 *         required: true
 *     responses:
 *       200:
 *         description: Firmware file downloaded
 *         content:
 *           application/octet-stream:
 *             schema:
 *               type: string
 *               format: binary
 *       400:
 *         description: Missing version information
 *       404:
 *         description: Firmware not found
 *       500:
 *         description: Server error
 */
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
    
    const firmwarePath = path.join(FIRMWARE_DIR, `${device}-firmware-v${cleanVersion}.bin`);
    
    if (!fs.existsSync(firmwarePath)) {
      return res.status(404).json({ error: 'Firmware not found for the requested version and device' });
    }

    // Set headers for download
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${path.basename(firmwarePath)}"`);
    
    res.download(firmwarePath);
  } catch (error) {
    logger.error('Error downloading firmware', { error: error.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * @swagger
 * /api/firmware/upload:
 *   post:
 *     summary: Upload new firmware
 *     description: Upload new firmware to server (authentication required)
 *     tags: [Firmware Management]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required:
 *               - firmware
 *               - version
 *             properties:
 *               firmware:
 *                 type: string
 *                 format: binary
 *                 description: Firmware file (.bin)
 *               version:
 *                 type: string
 *                 description: Firmware version
 *                 example: "1.0.0"
 *               device:
 *                 type: string
 *                 description: Device type
 *                 example: "esp32"
 *               notes:
 *                 type: string
 *                 description: Version notes
 *     responses:
 *       200:
 *         description: Upload successful
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                 file:
 *                   type: string
 *                 version:
 *                   type: string
 *                 checksum:
 *                   type: string
 *       400:
 *         description: Invalid data
 *       401:
 *         description: No token
 *       403:
 *         description: Invalid token
 *       429:
 *         description: Too many requests
 *       500:
 *         description: Server error
 */
// Route to upload new firmware (authentication required)
app.post('/api/firmware/upload', uploadLimiter, authenticateToken, upload.single('firmware'), (req, res) => {
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
    
    logger.info(`Firmware uploaded: ${req.file.filename}`, { version, device, checksum });
    
    res.json({
      success: true,
      message: 'Upload firmware successful',
      file: req.file.filename,
      version: version,
      checksum: checksum
    });
  } catch (error) {
    logger.error('Error uploading firmware', { error: error.message, file: req.file });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Route for ESP32 to report update results
app.post('/api/log', (req, res) => {
  try {
    const { device_id, status, version, error_message, latency_ms } = req.body;
    
    if (!device_id || !status || !version) {
      return res.status(400).json({ error: 'Missing required information' });
    }

    // Save log to database
    const stmt = db.prepare(`INSERT INTO update_logs (device_id, status, version, error_message, timestamp, latency_ms) VALUES (?, ?, ?, ?, ?, ?)`);
    stmt.run(device_id, status, version, error_message || null, new Date().toISOString(), latency_ms || null);
    stmt.finalize();
    
    logger.info(`Update log received from device ${device_id}`, { status, version, latency_ms });
    
    res.json({
      success: true,
      message: 'Log recorded successfully'
    });
  } catch (error) {
    logger.error('Error recording log', { error: error.message, body: req.body });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Route to get firmware version history (authentication required)
app.get('/api/firmware/history', authenticateToken, (req, res) => {
  db.all('SELECT * FROM firmware_versions ORDER BY upload_date DESC', [], (err, rows) => {
    if (err) {
      logger.error('Database query error on history', { error: err.message });
      return res.status(500).json({ error: 'Database query error' });
    }
    res.json(rows);
  });
});

// Route to delete firmware and associated data (authentication required)
app.delete('/api/firmware/:id', authenticateToken, (req, res) => {
  try {
    const { id } = req.params;

    if (!id) {
      return res.status(400).json({ error: 'Firmware ID is required' });
    }

    // First, get the file name from the database to delete it from the file system
    db.get('SELECT file_name, version, device FROM firmware_versions WHERE id = ?', [id], (err, row) => {
      if (err) {
        logger.error(`Database error while finding firmware with ID: ${id}`, { error: err.message });
        return res.status(500).json({ error: 'Database query error while finding firmware' });
      }

      if (!row) {
        logger.warn(`Attempted to delete non-existent firmware with ID: ${id}`);
        return res.status(404).json({ error: 'Firmware not found with the given ID' });
      }

      // Delete the actual firmware file
      const firmwarePath = path.join(FIRMWARE_DIR, row.file_name);
      if (fs.existsSync(firmwarePath)) {
        fs.unlinkSync(firmwarePath);
        logger.info(`Firmware file deleted from filesystem: ${row.file_name}`);
      }

      // Now, delete the record from the database
      db.run('DELETE FROM firmware_versions WHERE id = ?', [id], function(err) {
        if (err) {
          logger.error(`Database error while deleting firmware record with ID: ${id}`, { error: err.message });
          return res.status(500).json({ error: 'Database deletion error' });
        }
        
        logger.info(`Firmware record deleted from database: ID ${id}`, { version: row.version, device: row.device });
        
        res.json({
          success: true,
          message: 'Firmware and associated data deleted successfully'
        });
      });
    });
  } catch (error) {
    logger.error(`Error deleting firmware with ID: ${req.params.id}`, { error: error.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Route to get logs (authentication required)
app.get('/api/logs', authenticateToken, (req, res) => {
  const limit = req.query.limit || 100;
  db.all('SELECT * FROM update_logs ORDER BY timestamp DESC LIMIT ?', [limit], (err, rows) => {
    if (err) {
      logger.error('Database query error on logs', { error: err.message });
      return res.status(500).json({ error: 'Database query error' });
    }
    res.json(rows);
  });
});

/**
 * @swagger
 * /api/export/firmware:
 *   get:
 *     summary: Export firmware list to CSV
 *     description: Export all firmware versions to CSV file
 *     tags: [Export]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: CSV file downloaded
 *         content:
 *           text/csv:
 *             schema:
 *               type: string
 *       401:
 *         description: No token
 *       403:
 *         description: Invalid token
 *       404:
 *         description: No data to export
 *       500:
 *         description: Server error
 */
// Route to export firmware versions as CSV (authentication required)
app.get('/api/export/firmware', authenticateToken, (req, res) => {
  try {
    db.all('SELECT * FROM firmware_versions ORDER BY upload_date DESC', [], (err, rows) => {
      if (err) {
        logger.error('Database query error on firmware export', { error: err.message });
        return res.status(500).json({ error: 'Database query error' });
      }

      if (!rows || rows.length === 0) {
        return res.status(404).json({ error: 'No firmware data to export' });
      }

      // Transform data for CSV
      const csvData = rows.map(row => ({
        ID: row.id,
        Version: row.version,
        Device: row.device,
        Notes: row.notes || '',
        UploadDate: new Date(row.upload_date).toLocaleString(),
        FileName: row.file_name,
        Checksum: row.checksum || ''
      }));

      const fields = ['ID', 'Version', 'Device', 'Notes', 'UploadDate', 'FileName', 'Checksum'];
      const parser = new Parser({ fields });
      const csv = parser.parse(csvData);

      // Set headers for CSV download
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="firmware_versions_${new Date().toISOString().split('T')[0]}.csv"`);
      
      logger.info('Firmware versions exported to CSV', { count: rows.length });
      res.send(csv);
    });
  } catch (error) {
    logger.error('Error exporting firmware CSV', { error: error.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * @swagger
 * /api/export/logs:
 *   get:
 *     summary: Export logs to CSV
 *     description: Export update logs to CSV file
 *     tags: [Export]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 1000
 *         description: Maximum number of logs to export
 *     responses:
 *       200:
 *         description: CSV file downloaded
 *         content:
 *           text/csv:
 *             schema:
 *               type: string
 *       401:
 *         description: No token
 *       403:
 *         description: Invalid token
 *       404:
 *         description: No data to export
 *       500:
 *         description: Server error
 */
// Route to export update logs as CSV (authentication required)
app.get('/api/export/logs', authenticateToken, (req, res) => {
  try {
    const limit = req.query.limit || 1000;
    db.all('SELECT * FROM update_logs ORDER BY timestamp DESC LIMIT ?', [limit], (err, rows) => {
      if (err) {
        logger.error('Database query error on logs export', { error: err.message });
        return res.status(500).json({ error: 'Database query error' });
      }

      if (!rows || rows.length === 0) {
        return res.status(404).json({ error: 'No log data to export' });
      }

      // Transform data for CSV
      const csvData = rows.map(row => ({
        ID: row.id,
        DeviceID: row.device_id,
        Status: row.status,
        Version: row.version,
        ErrorMessage: row.error_message || '',
        Timestamp: new Date(row.timestamp).toLocaleString(),
        Latency: row.latency_ms || ''
      }));

      const fields = ['ID', 'DeviceID', 'Status', 'Version', 'ErrorMessage', 'Timestamp', 'Latency'];
      const parser = new Parser({ fields });
      const csv = parser.parse(csvData);

      // Set headers for CSV download
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="update_logs_${new Date().toISOString().split('T')[0]}.csv"`);
      
      logger.info('Update logs exported to CSV', { count: rows.length });
      res.send(csv);
    });
  } catch (error) {
    logger.error('Error exporting logs CSV', { error: error.message });
    res.status(500).json({ error: 'Internal server error' });
  }
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

// Centralized Error Handling Middleware
app.use((err, req, res, next) => {
  logger.error('Unhandled error caught', { error: err.message, stack: err.stack });
  res.status(500).send({ error: 'Something broke!', message: err.message });
});

// Start server
app.listen(port, '0.0.0.0', () => {
  logger.info(`🚀 OTA Server is running at http://localhost:${port}`);
  logger.info(`📊 Health check: http://localhost:${port}/health`);
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
    timestamp TEXT NOT NULL,
    latency_ms INTEGER
  )`);
  
  // Device status table for heartbeat
  db.run(`CREATE TABLE IF NOT EXISTS device_status (
    device_id TEXT PRIMARY KEY,
    last_seen TEXT,
    status TEXT,
    firmware_version TEXT
  )`);

  // Sensor data table
  db.run(`CREATE TABLE IF NOT EXISTS sensor_data (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    device_id TEXT NOT NULL,
    temperature REAL,
    humidity REAL,
    light REAL,
    timestamp TEXT NOT NULL
  )`);
  
  logger.info('✅ Database initialized successfully');
});

// Endpoint nhận heartbeat từ thiết bị
app.post('/api/heartbeat', (req, res) => {
  const { device_id, status, firmware_version } = req.body;
  if (!device_id) return res.status(400).json({ error: 'Missing device_id' });

  const now = new Date().toISOString();
  db.run(
    `INSERT INTO device_status (device_id, last_seen, status, firmware_version)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(device_id) DO UPDATE SET last_seen=excluded.last_seen, status=excluded.status, firmware_version=excluded.firmware_version`,
    [device_id, now, status || 'online', firmware_version || null],
    (err) => {
      if (err) return res.status(500).json({ error: 'DB error' });
      res.json({ success: true });
    }
  );
});

// Endpoint to get device list and status
app.get('/api/devices', authenticateToken, (req, res) => {
  db.all('SELECT * FROM device_status', [], (err, rows) => {
    if (err) return res.status(500).json({ error: 'DB error' });
    res.json(rows);
  });
});

/**
 * @swagger
 * /api/sensor:
 *   post:
 *     summary: Send sensor data from device to server
 *     description: ESP32 sends sensor data (temperature, humidity, light) to server
 *     tags: [Sensor]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               device_id:
 *                 type: string
 *                 description: Device ID
 *               temp:
 *                 type: number
 *                 description: Temperature (Celsius)
 *               humidity:
 *                 type: number
 *                 description: Humidity (%)
 *               light:
 *                 type: number
 *                 description: Light intensity
 *             required:
 *               - device_id
 *     responses:
 *       200:
 *         description: Sensor data recorded successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *       400:
 *         description: Missing device_id or no sensor values
 *       500:
 *         description: Internal server error
 */
// Endpoint receives sensor data from ESP32
app.post('/api/sensor', (req, res) => {
  try {
    const { device_id, temp } = req.body;
    
    if (!device_id) {
      return res.status(400).json({ error: 'Missing device_id' });
    }
    if (temp === undefined) {
      return res.status(400).json({ error: 'Missing temperature value' });
    }

    const now = new Date().toISOString();
    // Only save device_id and temperature, leave other fields null
    const stmt = db.prepare(`INSERT INTO sensor_data (device_id, temperature, humidity, light, timestamp) VALUES (?, ?, NULL, NULL, ?)`);
    stmt.run(device_id, temp, now);
    stmt.finalize();
    
    logger.info(`Sensor data received from device ${device_id}`, { temp });
    
    res.json({
      success: true,
      message: 'Sensor data recorded successfully'
    });
  } catch (error) {
    logger.error('Error recording sensor data', { error: error.message, body: req.body });
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * @swagger
 * /api/sensor:
 *   get:
 *     summary: Get sensor data from database
 *     description: Get stored sensor data (authentication required)
 *     tags: [Sensor]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: device_id
 *         schema:
 *           type: string
 *         description: Filter by specific device_id
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 100
 *         description: Maximum number of records to return
 *       - in: query
 *         name: offset
 *         schema:
 *           type: integer
 *           default: 0
 *         description: Number of records to skip (for pagination)
 *     responses:
 *       200:
 *         description: Sensor data retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   id:
 *                     type: integer
 *                   device_id:
 *                     type: string
 *                   temperature:
 *                     type: number
 *                   humidity:
 *                     type: number
 *                   light:
 *                     type: number
 *                   timestamp:
 *                     type: string
 *                     format: date-time
 *       401:
 *         description: No token
 *       403:
 *         description: Invalid token
 *       500:
 *         description: Internal server error
 */
// Endpoint to get sensor data (can be used for frontend)
app.get('/api/sensor', authenticateToken, (req, res) => {
  try {
    const { device_id, limit = 100, offset = 0 } = req.query;
    
    let query = 'SELECT * FROM sensor_data';
    let params = [];
    
    if (device_id) {
      query += ' WHERE device_id = ?';
      params.push(device_id);
    }
    
    query += ' ORDER BY timestamp DESC LIMIT ? OFFSET ?';
    params.push(parseInt(limit), parseInt(offset));
    
    db.all(query, params, (err, rows) => {
      if (err) {
        logger.error('Database query error on sensor data', { error: err.message });
        return res.status(500).json({ error: 'Database query error' });
      }
      
      res.json(rows);
    });
  } catch (error) {
    logger.error('Error fetching sensor data', { error: error.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});