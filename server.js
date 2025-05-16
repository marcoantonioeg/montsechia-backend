const stream = require('stream');
const express = require('express');
const Stripe = require('stripe');
const cors = require('cors');
const fileUpload = require('express-fileupload');
const cloudinary = require('cloudinary').v2;
const app = express();

// Configuración directa (sin variables de entorno)
const stripe = Stripe('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');
const WEBHOOK_SECRET = 'whsec_your_webhook_secret';

// Configuración de Cloudinary
cloudinary.config({
  cloud_name: 'dme0lnsrj',
  api_key: '595832238468122',
  api_secret: 'LvfbjXaaeoBbsahM1cBEYztDLkY',
  secure: true
});

// Almacenamiento temporal de imágenes pendientes
const pendingImages = new Map();

// Middlewares
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json());
app.use(fileUpload({
  useTempFiles: false,
  limits: { fileSize: 5 * 1024 * 1024 },
  abortOnLimit: true,
  createParentPath: true
}));

// Middleware de logging
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

// Endpoint para subir imágenes
app.post('/upload-image', async (req, res) => {
  try {
    if (!req.files?.image) {
      return res.status(400).json({ success: false, error: 'Debes enviar un archivo con el campo "image"' });
    }

    const image = req.files.image;

    // Validaciones
    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
    if (!allowedTypes.includes(image.mimetype)) {
      return res.status(400).json({ success: false, error: 'Solo se permiten imágenes JPEG, PNG o WEBP' });
    }

    if (image.size > 5 * 1024 * 1024) {
      return res.status(400).json({ success: false, error: 'La imagen no puede exceder los 5MB' });
    }

    const tipoImagen = req.body.tipo || 'postal';
    const folderName = tipoImagen === 'enmarcar' ? 'fotos_enmarcar' : 'postales_personalizadas';
    const sessionId = req.body.sessionId;

    const uploadOptions = {
      folder: folderName,
      resource_type: 'auto',
      transformation: [
        { width: 1200, height: 1200, crop: 'limit' },
        { quality: 'auto:best' },
        { fetch_format: 'auto' }
      ],
      allowed_formats: ['jpg', 'png', 'webp'],
      context: `tipo=${tipoImagen}|nota=${tipoImagen === 'enmarcar' ? 'Foto para enmarcar' : 'Foto postal'}`
    };

    const uploadResult = await new Promise((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(uploadOptions, (error, result) => {
        if (error) reject(error);
        else resolve(result);
      });

      const bufferStream = new stream.PassThrough();
      bufferStream.end(image.data);
      bufferStream.pipe(uploadStream);
    });

    // Almacenar imagen como pendiente si hay sessionId
    if (sessionId) {
      if (!pendingImages.has(sessionId)) {
        pendingImages.set(sessionId, []);
      }
      pendingImages.get(sessionId).push(uploadResult.public_id);
      console.log(`📌 Imagen ${uploadResult.public_id} asociada a sesión ${sessionId}`);
    }

    const optimizedUrl = `https://res.cloudinary.com/dme0lnsrj/image/upload/c_limit,w_1200/${uploadResult.public_id}.${uploadResult.format}`;

    res.json({
      success: true,
      url: optimizedUrl,
      public_id: uploadResult.public_id,
      format: uploadResult.format,
      width: uploadResult.width,
      height: uploadResult.height,
      tipo: tipoImagen,
      nota: tipoImagen === 'enmarcar' ? 'Foto para enmarcar' : 'Foto postal'
    });

  } catch (error) {
    console.error('Error en el servidor:', error);
    res.status(500).json({
      success: false,
      error: 'Error al procesar la imagen',
      details: error.message
    });
  }
});

// Endpoint para verificar imágenes
app.get('/check-image/:public_id', async (req, res) => {
  try {
    const result = await cloudinary.api.resource(req.params.public_id);
    res.json({ exists: true, resource: result });
  } catch (error) {
    if (error.http_code === 404) {
      res.json({ exists: false });
    } else {
      res.status(500).json({ error: 'Error al verificar imagen' });
    }
  }
});

// Endpoint para crear sesión de checkout
app.post('/create-checkout-session', async (req, res) => {
  try {
    const { cart } = req.body;

    const lineItems = cart.map(item => {
      let descriptionParts = [
        item.molduraNota && `Moldura: ${item.molduraNota}`,
        item.postalNota && `Postal: ${item.postalNota}`,
        item.floresSeleccionadas?.length > 0 && 
          `Flores: ${item.floresSeleccionadas.map(f => f.alt || f.color || 'Flor').join(', ')}`,
        item.notaPersonalizada && `Nota: ${item.notaPersonalizada}`,
        item.nombrePersonalizado && `Nombre: ${item.nombrePersonalizado}`,
        item.fotoId && `Foto Instax: ${item.fotoId}`,
        item.enmarcarFotoId && `Foto Enmarcar: ${item.enmarcarFotoId}`,
      ].filter(Boolean);

      const description = descriptionParts.length > 0 
        ? descriptionParts.join(' | ')
        : item.description || item.name;

      return {
        price_data: {
          currency: 'mxn',
          product_data: {
            name: item.name,
            description: description,
            images: item.image ? [item.image] : ['/images/default.png'],
          },
          unit_amount: Math.round(item.price * 100),
        },
        quantity: item.quantity || 1,
      };
    });

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      phone_number_collection: { enabled: true },
      shipping_address_collection: { allowed_countries: ['MX', 'US', 'CA'] },
      shipping_options: [{
        shipping_rate_data: {
          type: 'fixed_amount',
          fixed_amount: { amount: 0, currency: 'mxn' },
          display_name: 'Envío estándar',
          delivery_estimate: {
            minimum: { unit: 'business_day', value: 1 },
            maximum: { unit: 'business_day', value: 3 },
          },
        },
      }],
      line_items: lineItems,
      mode: 'payment',
      success_url: `${req.headers.origin}/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${req.headers.origin}/cancel`,
    });

    res.json({ 
      sessionId: session.id,
      publicId: cart.find(item => item.fotoId || item.enmarcarFotoId)?.fotoId || 
               cart.find(item => item.enmarcarFotoId)?.enmarcarFotoId 
    });
  } catch (error) {
    console.error('Error en checkout:', error);
    res.status(500).json({ 
      error: error.message,
      details: error.type || 'StripeError' 
    });
  }
});

// Webhook para manejar eventos de pago
app.post('/webhook', express.raw({type: 'application/json'}), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, WEBHOOK_SECRET);
  } catch (err) {
    console.error('⚠️ Firma del webhook inválida:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  console.log(`🔔 Evento recibido: ${event.type}`);

  switch (event.type) {
    case 'checkout.session.completed':
      const session = event.data.object;
      console.log(`✅ Pago exitoso para sesión: ${session.id}`);
      
      if (pendingImages.has(session.id)) {
        console.log(`📌 Eliminando imágenes pendientes de la sesión: ${session.id}`);
        pendingImages.delete(session.id);
      }
      break;
      
    case 'checkout.session.expired':
    case 'payment_intent.payment_failed':
      const failedSession = event.data.object;
      console.error(`❌ Pago fallido para sesión: ${failedSession.id}`);
      
      if (pendingImages.has(failedSession.id)) {
        const publicIds = pendingImages.get(failedSession.id);
        console.log(`🖼️ Imágenes a eliminar: ${publicIds.join(', ')}`);
        
        for (const publicId of publicIds) {
          try {
            const result = await cloudinary.uploader.destroy(publicId);
            console.log(`🗑️ Resultado eliminación ${publicId}:`, result);
            
            if (result.result === 'ok') {
              console.log(`✅ Imagen ${publicId} eliminada correctamente`);
            } else {
              console.warn(`⚠️ No se pudo eliminar imagen ${publicId}:`, result);
            }
          } catch (error) {
            console.error(`🔥 Error eliminando imagen ${publicId}:`, error);
          }
        }
        
        pendingImages.delete(failedSession.id);
      }
      break;
      
    default:
      console.log(`🔔 Evento no manejado: ${event.type}`);
  }

  res.json({ received: true });
});

// Limpieza periódica de imágenes pendientes
setInterval(async () => {
  console.log('🔍 Verificando imágenes pendientes...');
  for (const [sessionId, publicIds] of pendingImages) {
    try {
      const session = await stripe.checkout.sessions.retrieve(sessionId);
      console.log(`Sesión ${sessionId} - Estado: ${session.status}`);
      
      if (session.status === 'expired') {
        console.log(`Eliminando imágenes de sesión expirada: ${sessionId}`);
        for (const publicId of publicIds) {
          await cloudinary.uploader.destroy(publicId);
        }
        pendingImages.delete(sessionId);
      }
    } catch (error) {
      console.error(`Error verificando sesión ${sessionId}:`, error);
    }
  }
}, 60 * 60 * 1000); // Cada hora

// Iniciar servidor
const PORT = 3001;
app.listen(PORT, () => {
  console.log(`🟢 Servidor corriendo en http://localhost:${PORT}`);
});
