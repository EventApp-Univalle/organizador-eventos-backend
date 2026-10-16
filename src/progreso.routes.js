const express = require('express');
const { ownedProgress } = require('./execution.utils');
const router = express.Router();
router.get('/', async (req, res) => {
  if (new URL(req.originalUrl, 'http://localhost').search) return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'El resumen no admite filtros.' } });
  try { return res.status(200).json(await ownedProgress(req.user.id)); }
  catch { return res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'No fue posible consultar el progreso.' } }); }
});
module.exports = router;
