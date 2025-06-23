# OTA Firmware Management Server

Web server để quản lý và phân phối firmware cho ESP32 thông qua OTA (Over-The-Air) updates.

## 🚀 Tính năng

- **Upload Firmware**: CI/CD pipeline có thể upload firmware mới
- **Download Firmware**: ESP32 có thể tải firmware về
- **Version Management**: Quản lý phiên bản firmware
- **Authentication**: Bảo mật API với token
- **Logging**: Theo dõi quá trình update của ESP32
- **Web UI**: Giao diện quản lý trực quan
- **Rate Limiting**: Bảo vệ chống spam và abuse
- **CSV Export**: Xuất dữ liệu ra file CSV
- **API Documentation**: Swagger UI documentation

## 🔐 Authentication

Server sử dụng **Bearer Token** để xác thực API:

### Cấu hình Token

Tạo file `.env` từ `env.example`:

```bash
cp env.example .env
```

Chỉnh sửa file `.env`:

```env
# API Authentication
API_TOKEN=your_super_secret_token_here_change_this_in_production
UPLOAD_TOKEN=ci_cd_upload_token_change_this_too
```

### Sử dụng Token

#### 1. Upload Firmware (CI/CD)
```bash
curl -X POST http://localhost:3000/api/firmware/upload \
  -H "Authorization: Bearer ci_cd_upload_token_change_this_too" \
  -F "firmware=@firmware.bin" \
  -F "version=1.0.0" \
  -F "device=esp32" \
  -F "notes=New features added"
```

#### 2. Quản lý Firmware (Admin)
```bash
# Lấy lịch sử firmware
curl -H "Authorization: Bearer your_super_secret_token_here_change_this_in_production" \
  http://localhost:3000/api/firmware/history

# Xóa firmware
curl -X DELETE \
  -H "Authorization: Bearer your_super_secret_token_here_change_this_in_production" \
  "http://localhost:3000/api/firmware/1.0.0?device=esp32"
```

## 📡 API Endpoints

### Public Endpoints (Không cần authentication)

#### `GET /api/firmware/version`
ESP32 kiểm tra phiên bản mới nhất.

**Response:**
```json
{
  "version": "v1.0.3",
  "url": "http://localhost:3000/api/firmware/download?device=esp32&version=v1.0.3",
  "checksum": "abcd1234",
  "notes": "Bug fixes",
  "uploadDate": "2024-01-01T00:00:00.000Z"
}
```

#### `GET /api/firmware/download`
ESP32 tải firmware về.

**Parameters:**
- `device`: Loại thiết bị (default: esp32)
- `version`: Phiên bản firmware

#### `POST /api/log`
ESP32 báo cáo kết quả update.

**Body:**
```json
{
  "device_id": "esp32-001",
  "status": "update_success",
  "version": "v1.0.3",
  "error_message": null
}
```

### Protected Endpoints (Cần authentication)

#### `POST /api/firmware/upload`
Upload firmware mới (cần `UPLOAD_TOKEN`).

#### `GET /api/firmware/history`
Lấy lịch sử firmware (cần `API_TOKEN`).

#### `DELETE /api/firmware/:version`
Xóa firmware (cần `API_TOKEN`).

#### `GET /api/logs`
Lấy logs update (cần `API_TOKEN`).

#### `GET /api/export/firmware`
Export danh sách firmware ra CSV (cần `API_TOKEN`).

#### `GET /api/export/logs`
Export logs ra CSV (cần `API_TOKEN`).

## 🛠️ Cài đặt và Chạy

### 1. Cài đặt dependencies
```bash
npm install
```

### 2. Cấu hình environment
```bash
cp env.example .env
# Chỉnh sửa file .env với token thực tế
```

### 3. Chạy server

#### Development Mode
```bash
node server.js
```

#### Production Mode với PM2 (Khuyến nghị)
```bash
# Cài đặt PM2 globally
npm install -g pm2

# Khởi động server với PM2
npm run pm2:start

# Kiểm tra trạng thái
npm run pm2:status

# Xem logs real-time
npm run pm2:logs

# Monitoring dashboard
npm run pm2:monit

# Restart server
npm run pm2:restart

# Dừng server
npm run pm2:stop
```

**Lợi ích của PM2:**
- ✅ Tự động khởi động lại khi gặp lỗi
- ✅ Quản lý log tập trung
- ✅ Monitoring hiệu suất real-time
- ✅ Zero-downtime deployment
- ✅ Process management chuyên nghiệp

Server sẽ chạy tại `http://localhost:3000`

## 🐳 Docker & Kubernetes Deployment

Ứng dụng này đã sẵn sàng để được đóng gói và triển khai trên các nền tảng container như Docker và Kubernetes (K3s).

### 1. Build Docker Image

Từ thư mục gốc của dự án, chạy lệnh sau:

```bash
docker build -t your-username/ota-server:latest .
```
*(Thay `your-username` bằng Docker Hub username của bạn)*

### 2. Chạy với Docker

Để chạy thử image vừa build:
```bash
docker run -p 3000:3000 \
  -v $(pwd)/data:/app/data \
  --env-file ./.env \
  -e "DATA_DIR=/app/data" \
  --name ota-server-container \
  your-username/ota-server:latest
```

Lệnh này sẽ:
- `-p 3000:3000`: Ánh xạ cổng 3000 của máy bạn vào cổng 3000 của container.
- `-v $(pwd)/data:/app/data`: Mount thư mục `data` ở máy bạn vào thư mục `/app/data` trong container để lưu trữ dữ liệu.
- `--env-file ./.env`: Tải các biến môi trường từ file `.env`.
- `-e "DATA_DIR=/app/data"`: Ghi đè biến `DATA_DIR` để trỏ vào volume đã mount.

### 3. Triển khai lên Kubernetes (K3s)

Việc triển khai lên K3s sẽ yêu cầu các file manifest (Deployment, Service, PersistentVolumeClaim, Ingress). Các file này cần được tạo riêng tùy theo cấu hình cluster của bạn.

**Điểm mấu chốt khi cấu hình manifest:**
- **Deployment**: Trỏ tới Docker image bạn đã build và push lên registry.
- **Environment Variables**: Sử dụng `ConfigMap` và `Secret` để cung cấp biến môi trường cho pod.
- **Persistent Storage**: Tạo `PersistentVolumeClaim` và mount nó vào đường dẫn `/app/data` của container.
- **Service & Ingress**: Tạo `Service` loại `ClusterIP` và `Ingress` để expose ứng dụng ra bên ngoài.

## 🔧 Cấu hình CI/CD

### GitHub Actions Example

```yaml
name: ESP32 CI/CD
on:
  push:
    branches: [main]
jobs:
  build-and-upload:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - name: Setup PlatformIO
        uses: platformio/setup-platformio@v2
      - name: Build firmware
        run: pio run
      - name: Upload to OTA server
        run: |
          curl -X POST ${{ secrets.OTA_UPLOAD_URL }} \
            -H "Authorization: Bearer ${{ secrets.UPLOAD_TOKEN }}" \
            -F "firmware=@.pio/build/esp32dev/firmware.bin" \
            -F "version=${{ github.sha }}" \
            -F "device=esp32" \
            -F "notes=Auto build from CI/CD"
```

### Secrets cần cấu hình:
- `OTA_UPLOAD_URL`: URL của OTA server
- `UPLOAD_TOKEN`: Token để upload firmware

## 📊 Database Schema

### firmware_versions
| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER | Primary key |
| version | TEXT | Phiên bản firmware |
| device | TEXT | Loại thiết bị |
| notes | TEXT | Ghi chú |
| upload_date | TEXT | Ngày upload |
| file_name | TEXT | Tên file |
| checksum | TEXT | MD5 checksum |

### update_logs
| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER | Primary key |
| device_id | TEXT | ID thiết bị |
| status | TEXT | Trạng thái update |
| version | TEXT | Phiên bản |
| error_message | TEXT | Lỗi (nếu có) |
| timestamp | TEXT | Thời gian |

## 🔍 Health Check

```bash
curl http://localhost:3000/health
```

Response:
```json
{
  "status": "OK",
  "timestamp": "2024-01-01T00:00:00.000Z",
  "version": "1.0.0"
}
```

## 🛡️ Security

- **API Token**: Bảo vệ các endpoint quản lý
- **Upload Token**: Token riêng cho CI/CD upload
- **File Validation**: Chỉ chấp nhận file .bin
- **File Size Limit**: Giới hạn 10MB
- **CORS**: Chỉ cho phép origin được cấu hình
- **Rate Limiting**: Giới hạn 100 requests/15 phút, 10 uploads/giờ

## 📝 Logs

Server tự động log các hoạt động:
- Upload firmware
- Download firmware
- Update logs từ ESP32
- Lỗi hệ thống

## 🤝 Tích hợp với ESP32

ESP32 cần implement logic OTA để:
1. Gọi `GET /api/firmware/version` định kỳ
2. So sánh version với firmware hiện tại
3. Tải firmware từ URL trong response
4. Verify checksum
5. Thực hiện OTA update
6. Báo cáo kết quả qua `POST /api/log`

## 📚 API Documentation

Server cung cấp Swagger UI documentation tại:

```
http://localhost:3000/api-docs
```

Tại đây bạn có thể:
- Xem tất cả API endpoints
- Test API trực tiếp
- Xem schema và examples
- Tìm hiểu parameters và responses

## 📊 Export Data

### Export Firmware Versions
```bash
curl -H "Authorization: Bearer your_token" \
  http://localhost:3000/api/export/firmware \
  -o firmware_versions.csv
```

### Export Update Logs
```bash
curl -H "Authorization: Bearer your_token" \
  "http://localhost:3000/api/export/logs?limit=1000" \
  -o update_logs.csv
```
