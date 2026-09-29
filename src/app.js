const express = require('express');
const cors = require('cors');
const swaggerUi = require('swagger-ui-express');
const config = require('./config');
const eventosRouter = require('./eventos.routes');
const tareasRouter = require('./tareas.routes');
const openapiDocument = require('../docs/openapi.json');

const app = express();

app.use(
  cors({
    origin: config.corsOrigins,
  })
);

app.use(express.json());

app.get('/health', (req, res) => {
  res.status(200).json({
    estado: 'ok',
    mensaje: 'Backend funcionando',
  });
});

app.use(
  '/api-docs',
  swaggerUi.serve,
  swaggerUi.setup(openapiDocument, {
    customSiteTitle: 'EventApp API - Sprint 1',
  })
);

app.use('/api/eventos', eventosRouter);
app.use('/api/tareas', tareasRouter);

app.use((error, req, res, next) => {
  if (error instanceof SyntaxError && error.status === 400 && 'body' in error) {
    return res.status(400).json({
      error: {
        code: 'INVALID_JSON',
        message: 'El cuerpo debe ser JSON válido.',
      },
    });
  }

  if (error.status && error.status !== 500) {
    return next(error);
  }

  console.error('Error interno no controlado:', error.message);

  return res.status(500).json({
    error: {
      code: 'INTERNAL_ERROR',
      message: 'No fue posible completar la operación.',
    },
  });
});

app.use((req, res) => {
  res.status(404).json({
    error: {
      code: 'ROUTE_NOT_FOUND',
      message: 'Ruta API no encontrada.',
    },
  });
});

module.exports = app;
