# OTA Firmware Management Server

Web server để quản lý và phân phối firmware cho ESP32 thông qua OTA (Over-The-Air) updates.

## 🚀 Tính năng

- **Upload Firmware**: CI/CD pipeline có thể upload firmware mới
- **Download Firmware**: ESP32 có thể tải firmware về
- **Version Management**: Quản lý phiên bản firmware
- **Authentication**: Bảo mật API với token
- **Logging**: Theo dõi quá trình update của ESP32
- **Web UI**: Giao diện quản lý trực quan

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
```bash
node server.js
```

Server sẽ chạy tại `http://localhost:3000`

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
