const path = require("path");
const swaggerJSDoc = require("swagger-jsdoc");

const options = {
  definition: {
    openapi: "3.0.0",
    info: {
      title: "Procurement API",
      version: "1.0.0",
      description: "Auto-generated API documentation using swagger-jsdoc and swagger-ui-express.",
    },
    servers: [
      {
        url: process.env.API_BASE_URL || "http://localhost:5000",
      },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "JWT",
        },
      },
    },
  },
  apis: [
    path.join(__dirname, "../routes/**/*.js"),
    path.join(__dirname, "../controllers/**/*.js"),
    path.join(__dirname, "../models/**/*.js"),
  ],
};

const swaggerSpec = swaggerJSDoc(options);

module.exports = swaggerSpec;
