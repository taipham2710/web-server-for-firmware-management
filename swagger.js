const swaggerJsdoc = require('swagger-jsdoc');

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'OTA Firmware Management API',
      version: '1.0.0',
      description: 'API để quản lý và phân phối firmware cho ESP32 thông qua OTA updates',
      contact: {
        name: 'API Support',
        email: 'support@example.com'
      },
      license: {
        name: 'MIT',
        url: 'https://opensource.org/licenses/MIT'
      }
    },
    servers: [
      {
        url: 'http://localhost:3000',
        description: 'Development server'
      }
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'Enter your API token in the format: Bearer <token>'
        }
      }
    },
    security: [
      {
        bearerAuth: []
      }
    ],
    paths: {
      "/api/log": {
        post: {
          tags: ["Device"],
          summary: "Gửi log OTA từ thiết bị về server",
          description: "Thiết bị gửi trạng thái update (thành công/thất bại, latency, lỗi...) về server.",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    device_id: { type: "string" },
                    status: { type: "string", enum: ["update_success", "update_failed"] },
                    version: { type: "string" },
                    error_message: { type: "string" },
                    latency_ms: { type: "integer" }
                  },
                  required: ["device_id", "status", "version"]
                }
              }
            }
          },
          responses: {
            200: { description: "Log recorded successfully" },
            400: { description: "Missing required information" },
            500: { description: "Internal server error" }
          }
        }
      },
      "/api/heartbeat": {
        post: {
          tags: ["Device"],
          summary: "Thiết bị gửi heartbeat (trạng thái hoạt động) về server",
          description: "Thiết bị gửi định kỳ để báo hiệu vẫn hoạt động sau update.",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    device_id: { type: "string" },
                    status: { type: "string", enum: ["online", "error"] },
                    firmware_version: { type: "string" }
                  },
                  required: ["device_id"]
                }
              }
            }
          },
          responses: {
            200: { description: "Heartbeat recorded successfully" },
            400: { description: "Missing device_id" },
            500: { description: "DB error" }
          }
        }
      }
    }
  },
  apis: ['./server.js'], // Path to the API docs
};

const specs = swaggerJsdoc(options);

module.exports = specs; 