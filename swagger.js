const swaggerJsdoc = require('swagger-jsdoc');

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'OTA Firmware Management API',
      version: '1.0.0',
      description: 'API for managing and distributing firmware for ESP32 via OTA updates',
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
      "/api/sensor": {
        post: {
          tags: ["Sensor"],
          summary: "Send sensor data from device to server",
          description: "ESP32 sends sensor data (temperature, humidity, light) to server.",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    device_id: { type: "string", description: "Device ID" },
                    temp: { type: "number", description: "Temperature (Celsius)" },
                    humidity: { type: "number", description: "Humidity (%)" },
                    light: { type: "number", description: "Light intensity" }
                  },
                  required: ["device_id"]
                }
              }
            }
          },
          responses: {
            200: { 
              description: "Sensor data recorded successfully",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      success: { type: "boolean" },
                      message: { type: "string" }
                    }
                  }
                }
              }
            },
            400: { description: "Missing device_id or no sensor values" },
            500: { description: "Internal server error" }
          }
        },
        get: {
          tags: ["Sensor"],
          summary: "Get sensor data from database",
          description: "Get stored sensor data (authentication required).",
          security: [
            {
              bearerAuth: []
            }
          ],
          parameters: [
            {
              in: "query",
              name: "device_id",
              schema: { type: "string" },
              description: "Filter by specific device_id"
            },
            {
              in: "query",
              name: "limit",
              schema: { type: "integer", default: 100 },
              description: "Maximum number of records to return"
            },
            {
              in: "query",
              name: "offset",
              schema: { type: "integer", default: 0 },
              description: "Number of records to skip (for pagination)"
            }
          ],
          responses: {
            200: { 
              description: "Sensor data retrieved successfully",
              content: {
                "application/json": {
                  schema: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        id: { type: "integer" },
                        device_id: { type: "string" },
                        temperature: { type: "number" },
                        humidity: { type: "number" },
                        light: { type: "number" },
                        timestamp: { type: "string", format: "date-time" }
                      }
                    }
                  }
                }
              }
            },
            401: { description: "No token" },
            403: { description: "Invalid token" },
            500: { description: "Internal server error" }
          }
        }
      },
      "/api/log": {
        post: {
          tags: ["Device"],
          summary: "Send OTA log from device to server",
          description: "Device sends update status (success/failure, latency, error...) to server.",
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
          summary: "Device sends heartbeat (operational status) to server",
          description: "Device periodically sends to indicate it is still operating after update.",
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