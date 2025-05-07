// server.js - Web Server cho việc lưu trữ và cập nhật firmware
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { exec } = require('child_process');
const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./firmware.db');

const app = express();
const port = process.env.PORT || 3000;

// Thiết lập middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

// Thiết lập storage cho multer để upload firmware
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, 'firmware');
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    // Tạo tên file dựa trên phiên bản và loại thiết bị
    const version = req.body.version || 'unknown';
    const device = req.body.device || 'esp32';
    cb(null, `${device}-firmware-v${version}${path.extname(file.originalname)}`);
  }
});

const upload = multer({
  storage: storage,
  fileFilter: (req, file, cb) => {
    // Chỉ chấp nhận các file .bin
    if (path.extname(file.originalname) !== '.bin') {
      return cb(new Error('Chỉ chấp nhận file firmware .bin!'));
    }
    cb(null, true);
  }
});

// Route để lấy thông tin phiên bản mới nhất
app.get('/api/firmware/version', (req, res) => {
  try {
    const versionFilePath = path.join(__dirname, 'firmware', 'version.json');
    if (fs.existsSync(versionFilePath)) {
      const fileContent = fs.readFileSync(versionFilePath, 'utf8');
      if (fileContent.trim() === '') {
        console.error('File version.json rỗng hoặc không hợp lệ tại:', versionFilePath);
        return res.status(404).json({ error: 'Thông tin phiên bản rỗng hoặc không hợp lệ' });
      }
      const versionData = JSON.parse(fileContent);
      res.json(versionData);
    } else {
      console.error('Không tìm thấy file version.json tại:', versionFilePath);
      res.status(404).json({ error: 'Không tìm thấy file version.json' });
    }
  } catch (error) {
    console.error('Lỗi khi đọc hoặc parse file version.json:', error);
    res.status(500).json({ error: 'Lỗi máy chủ nội bộ khi xử lý file phiên bản' });
  }
});

// Route để tải firmware
app.get('/api/firmware/download', (req, res) => {
  try {
    const device = req.query.device || 'esp32';
    const version = req.query.version;
    
    if (!version) {
      return res.status(400).json({ error: 'Thiếu thông tin phiên bản' });
    }
    
    const firmwareDir = path.join(__dirname, 'firmware');
    const firmwarePath = path.join(firmwareDir, `${device}-firmware-v${version}.bin`);
    
    if (!fs.existsSync(firmwarePath)) {
      return res.status(404).json({ error: 'Không tìm thấy firmware cho phiên bản và thiết bị yêu cầu' });
    }
    
    res.download(firmwarePath);
  } catch (error) {
    console.error('Lỗi khi tải firmware:', error);
    res.status(500).json({ error: 'Lỗi máy chủ nội bộ' });
  }
});

// Route để upload firmware mới
app.post('/api/firmware/upload', upload.single('firmware'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Không có file được upload' });
    }
    
    const { version, device, notes } = req.body;
    
    if (!version) {
      return res.status(400).json({ error: 'Thiếu thông tin phiên bản' });
    }
    
    // Cập nhật thông tin phiên bản trong file version.json
    const versionPath = path.join(__dirname, 'firmware', 'version.json');
    const versionData = {
      version: version,
      device: device || 'esp32',
      notes: notes || '',
      uploadDate: new Date().toISOString()
    };
    
    fs.writeFileSync(versionPath, JSON.stringify(versionData, null, 2));
    
    // Sau khi upload file thành công:
    const stmt = db.prepare(`INSERT INTO firmware_versions (version, device, notes, upload_date, file_name) VALUES (?, ?, ?, ?, ?)`);
    stmt.run(version, device, notes, new Date().toISOString(), req.file.filename);
    stmt.finalize();
    
    res.json({
      success: true,
      message: 'Upload firmware thành công',
      file: req.file.filename,
      version: version
    });
  } catch (error) {
    console.error('Lỗi khi upload firmware:', error);
    res.status(500).json({ error: 'Lỗi máy chủ nội bộ' });
  }
});

// Route để webhook từ GitHub
app.post('/api/github/webhook', express.json(), (req, res) => {
  try {
    // Kiểm tra xem webhook có đúng không (nên thêm secret để xác thực)
    const event = req.headers['x-github-event'];
    const payload = req.body;
    
    if (event === 'push' && payload.ref === 'refs/heads/main') {
      console.log('Nhận được push từ GitHub, bắt đầu cập nhật...');
      
      // Đường dẫn đến thư mục dự án
      const projectDir = path.join(__dirname, 'project');
      
      // Kiểm tra nếu repo đã tồn tại
      if (fs.existsSync(projectDir)) {
        // Pull các thay đổi mới nhất
        exec('cd ' + projectDir + ' && git pull', (error, stdout, stderr) => {
          if (error) {
            console.error(`Lỗi khi pull code: ${error.message}`);
            return res.status(500).json({ error: 'Lỗi khi cập nhật code' });
          }
          
          // Chạy script build để tạo firmware mới
          exec('cd ' + projectDir + ' && npm run build', (error, stdout, stderr) => {
            if (error) {
              console.error(`Lỗi khi build firmware: ${error.message}`);
              return res.status(500).json({ error: 'Lỗi khi build firmware' });
            }
            
            // Sao chép firmware mới vào thư mục firmware
            const buildOutput = path.join(projectDir, 'build', 'firmware.bin');
            const firmwareDir = path.join(__dirname, 'firmware');
            const newVersion = new Date().toISOString().replace(/[:.]/g, '-');
            const newFirmwarePath = path.join(firmwareDir, `esp32-firmware-v${newVersion}.bin`);
            
            fs.copyFileSync(buildOutput, newFirmwarePath);
            
            // Cập nhật thông tin phiên bản
            const versionPath = path.join(firmwareDir, 'version.json');
            const versionData = {
              version: newVersion,
              device: 'esp32',
              notes: `Auto build từ commit: ${payload.after}`,
              uploadDate: new Date().toISOString()
            };
            
            fs.writeFileSync(versionPath, JSON.stringify(versionData, null, 2));
            
            res.json({
              success: true,
              message: 'Cập nhật firmware từ GitHub thành công',
              version: newVersion
            });
          });
        });
      } else {
        // Clone repo nếu chưa tồn tại
        exec(`git clone ${payload.repository.clone_url} ${projectDir}`, (error, stdout, stderr) => {
          if (error) {
            console.error(`Lỗi khi clone repo: ${error.message}`);
            return res.status(500).json({ error: 'Lỗi khi clone repo' });
          }
          
          res.json({
            success: true,
            message: 'Đã clone repo thành công, sẽ build firmware ở lần push tiếp theo'
          });
        });
      }
    } else {
      res.json({
        success: true,
        message: 'Webhook nhận thành công nhưng không thực hiện hành động'
      });
    }
  } catch (error) {
    console.error('Lỗi khi xử lý webhook:', error);
    res.status(500).json({ error: 'Lỗi máy chủ nội bộ' });
  }
});

// Route để lấy lịch sử các phiên bản
app.get('/api/firmware/history', (req, res) => {
  db.all('SELECT * FROM firmware_versions ORDER BY upload_date DESC', [], (err, rows) => {
    if (err) {
      return res.status(500).json({ error: 'Lỗi truy vấn database' });
    }
    res.json(rows);
  });
});

// Route để xóa firmware và dữ liệu tương ứng
app.delete('/api/firmware/:version', (req, res) => {
  try {
    const version = req.params.version;
    const device = req.query.device || 'esp32';
    
    // Xóa file firmware
    const firmwarePath = path.join(__dirname, 'firmware', `${device}-firmware-v${version}.bin`);
    if (fs.existsSync(firmwarePath)) {
      fs.unlinkSync(firmwarePath);
    }
    
    // Xóa dữ liệu trong database
    db.run('DELETE FROM firmware_versions WHERE version = ? AND device = ?', [version, device], function(err) {
      if (err) {
        return res.status(500).json({ error: 'Lỗi khi xóa dữ liệu từ database' });
      }
      
      // Nếu đây là phiên bản hiện tại, cập nhật version.json
      const versionPath = path.join(__dirname, 'firmware', 'version.json');
      if (fs.existsSync(versionPath)) {
        const versionData = JSON.parse(fs.readFileSync(versionPath, 'utf8'));
        if (versionData.version === version && versionData.device === device) {
          // Lấy phiên bản mới nhất từ database
          db.get('SELECT * FROM firmware_versions ORDER BY upload_date DESC LIMIT 1', [], (err, row) => {
            if (err || !row) {
              // Nếu không còn phiên bản nào, xóa file version.json
              fs.unlinkSync(versionPath);
            } else {
              // Cập nhật version.json với phiên bản mới nhất
              const newVersionData = {
                version: row.version,
                device: row.device,
                notes: row.notes,
                uploadDate: row.upload_date
              };
              fs.writeFileSync(versionPath, JSON.stringify(newVersionData, null, 2));
            }
          });
        }
      }
      
      res.json({
        success: true,
        message: 'Đã xóa firmware và dữ liệu tương ứng'
      });
    });
  } catch (error) {
    console.error('Lỗi khi xóa firmware:', error);
    res.status(500).json({ error: 'Lỗi máy chủ nội bộ' });
  }
});

// Giao diện người dùng
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Khởi động server
app.listen(port, () => {
  console.log(`Server đang chạy tại http://localhost:${port}`);
});

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS firmware_versions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    version TEXT NOT NULL,
    device TEXT NOT NULL,
    notes TEXT,
    upload_date TEXT NOT NULL,
    file_name TEXT NOT NULL
  )`);
});