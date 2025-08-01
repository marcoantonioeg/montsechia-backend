const stream = require('stream');
const express = require('express');
const Stripe = require('stripe');
const cors = require('cors');
const fileUpload = require('express-fileupload');
const cloudinary = require('cloudinary').v2;
const app = express();
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

// Configuración de Cloudinary mejorada
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true
});

// Middlewares con configuración mejorada
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json());
app.use(fileUpload({
  useTempFiles: false,
  limits: { fileSize: 20 * 1024 * 1024 }, // MODIFICADO: 5MB → 20MB
  abortOnLimit: true,
  createParentPath: true
}));

// Endpoint: Obtener todos los productos
app.get('/products', async (req, res) => {
  try {
    let allProducts = [];
    let allPrices = [];
    let hasMore = true;
    let startingAfter = null;

    while (hasMore) {
      const params = { limit: 100 };
      if (startingAfter) params.starting_after = startingAfter;

      const productsResponse = await stripe.products.list(params);
      allProducts = [...allProducts, ...productsResponse.data];
      hasMore = productsResponse.has_more;
      if (hasMore) startingAfter = productsResponse.data[productsResponse.data.length - 1].id;
    }

    hasMore = true;
    startingAfter = null;
    while (hasMore) {
      const params = { limit: 100 };
      if (startingAfter) params.starting_after = startingAfter;

      const pricesResponse = await stripe.prices.list(params);
      allPrices = [...allPrices, ...pricesResponse.data];
      hasMore = pricesResponse.has_more;
      if (hasMore) startingAfter = pricesResponse.data[pricesResponse.data.length - 1].id;
    }

    const formattedProducts = allProducts.map((product) => {
      const price = allPrices.find((p) => p.product === product.id);
      return {
        id: product.id,
        name: product.name,
        description: product.description || 'Sin descripción',
        images: product.images,
        price: price?.unit_amount / 100 || 0,
        priceId: price?.id || null,
        metadata: product.metadata
      };
    });

    res.json(formattedProducts);
  } catch (error) {
    console.error('Error al obtener productos:', error);
    res.status(500).send({ error: error.message });
  }
});

// Endpoint: Obtener un producto específico
app.get('/products/:id', async (req, res) => {
  try {
    const product = await stripe.products.retrieve(req.params.id);
    const price = await stripe.prices.list({ product: product.id, limit: 1 });
    
    const formattedProduct = {
      ...product,
      price: price.data[0]?.unit_amount / 100 || 0,
      priceId: price.data[0]?.id || null
    };
    
    res.json(formattedProduct);
  } catch (error) {
    res.status(404).json({ error: 'Producto no encontrado' });
  }
});

// Endpoint para crear ephemeral key
app.post('/create-ephemeral-key', async (req, res) => {
  try {
    const { customer_id } = req.body;
    const key = await stripe.ephemeralKeys.create(
      { customer: customer_id },
      { apiVersion: '2023-08-16' }
    );
    res.json(key);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Endpoint para subir imágenes - Versión mejorada para ambos tipos
app.post('/upload-image', async (req, res) => {
  console.log('Accediendo a /upload-image');
  
  try {
    // Verificación más robusta de archivos
    if (!req.files || Object.keys(req.files).length === 0) {
      console.warn('No se recibieron archivos en la solicitud');
      return res.status(400).json({
        success: false,
        error: 'No se subió ningún archivo'
      });
    }

    const image = req.files.image;
    if (!image) {
      console.warn('El campo "image" no está presente en la solicitud');
      return res.status(400).json({
        success: false,
        error: 'Debes enviar un archivo con el campo "image"'
      });
    }

    console.log(`Recibida imagen: ${image.name}, ${image.mimetype}, ${image.size} bytes`);

    // Validaciones mejoradas
    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
    if (!allowedTypes.includes(image.mimetype)) {
      console.warn(`Tipo de archivo no permitido: ${image.mimetype}`);
      return res.status(400).json({
        success: false,
        error: 'Solo se permiten imágenes JPEG, PNG o WEBP'
      });
    }

    if (image.size > 20 * 1024 * 1024) { // MODIFICADO: 5MB → 20MB
      console.warn(`Imagen demasiado grande: ${image.size} bytes`);
      return res.status(400).json({
        success: false,
        error: 'La imagen no puede exceder los 20MB'
      });
    }

    // Determinar tipo de imagen (postal o enmarcar)
    const tipoImagen = req.body.tipo || 'postal';
    const folderName = tipoImagen === 'enmarcar' ? 'fotos_enmarcar' : 'postales_personalizadas';

    // Configuración optimizada para Cloudinary
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

    // Usamos una promesa para manejar mejor el stream
    const uploadResult = await new Promise((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        uploadOptions,
        (error, result) => {
          if (error) {
            console.error('Error en Cloudinary:', error);
            reject(error);
          } else {
            console.log('Imagen subida exitosamente a Cloudinary');
            resolve(result);
          }
        }
      );

      // Manejo mejorado del stream
      const bufferStream = new stream.PassThrough();
      bufferStream.on('error', (error) => {
        console.error('Error en el stream:', error);
        reject(error);
      });
      
      bufferStream.end(image.data);
      bufferStream.pipe(uploadStream);
    });

    // URL optimizada
    const optimizedUrl = `https://res.cloudinary.com/${cloudinary.config().cloud_name}/image/upload/c_limit,w_1200/${uploadResult.public_id}.${uploadResult.format}`;

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
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Endpoint proxy de imágenes
app.get('/image-proxy/:fileId', async (req, res) => {
  try {
    const file = await stripe.files.retrieve(req.params.fileId);
    const fileContent = await stripe.files.download(req.params.fileId);
    res.set('Content-Type', file.type);
    res.send(fileContent);
  } catch (error) {
    res.status(404).send('Imagen no encontrada');
  }
});

// Endpoint: Crear sesión de checkout con teléfono obligatorio y soporte para códigos de descuento
app.post('/create-checkout-session', async (req, res) => {
  try {
    const { cart, discountCode } = req.body;

    const lineItems = cart.map(item => {
      // Construir la descripción
      let descriptionParts = [
        item.molduraNota ? `Moldura: ${item.molduraNota}` : null,
        item.postalNota ? `Postal: ${item.postalNota}` : null,
        (item.floresSeleccionadas && item.floresSeleccionadas.length > 0) ? 
          `Flores: ${item.floresSeleccionadas.map(f => f.alt || f.color || 'Flor').join(', ')}` : null,
        item.notaPersonalizada ? `Nota: ${item.notaPersonalizada}` : null,
        item.nombrePersonalizado ? `Nombre: ${item.nombrePersonalizado}` : null,
        item.fotoId ? `Foto Instax: ${item.fotoId}` : null,
        item.enmarcarFotoId ? `Foto Enmarcar: ${item.enmarcarFotoId}` : null,
        item.imageUrl ? ` ${item.imageUrl}` : null,
        item.enmarcarImageUrl ? ` ${item.enmarcarImageUrl}` : null
      ].filter(Boolean);

      // Si no hay partes de descripción, usar la descripción del producto o su nombre
      const description = descriptionParts.length > 0 
        ? descriptionParts.join(' | ')
        : item.description || item.name;

      return {
        price_data: {
          currency: 'mxn',
          product_data: {
            name: item.name,
            description: description, // Asegurarse de que nunca esté vacío
            images: item.image ? [item.image] : ['/images/default.png'],
          },
          unit_amount: Math.round(item.price * 100),
        },
        quantity: item.quantity || 1,
      };
    });

    // Configuración base de la sesión
    const sessionParams = {
      payment_method_types: ['card'],
      phone_number_collection: {
        enabled: true
      },
      shipping_address_collection: { 
        allowed_countries: ['MX', 'US', 'CA'] 
      },
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
    };

    // Si hay un código de descuento, aplicarlo
    if (discountCode) {
      try {
        // Verificar y aplicar el código de descuento
        const coupon = await stripe.coupons.retrieve(discountCode);
        
        // Si el cupón existe, agregarlo a la sesión
        sessionParams.discounts = [{
          coupon: discountCode
        }];
      } catch (error) {
        // Si el cupón no es válido, continuar sin descuento
        console.warn(`Código de descuento no válido: ${discountCode}`);
      }
    }

    const session = await stripe.checkout.sessions.create(sessionParams);
    res.json({ sessionId: session.id });
  } catch (error) {
    console.error('Error en checkout:', error);
    res.status(500).json({ 
      error: error.message,
      details: error.type || 'StripeError' 
    });
  }
});

// Webhook
app.post('/webhook', express.raw({type: 'application/json'}), (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      'whsec_your_webhook_secret'
    );
  } catch (err) {
    console.error('⚠️ Firma del webhook inválida:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  switch (event.type) {
    case 'checkout.session.completed':
      const session = event.data.object;
      console.log(`✅ Pago exitoso para: ${session.customer_email || 'Anónimo'}`);
      // Acceder al teléfono recolectado:
      console.log(`📞 Teléfono del cliente: ${session.customer_details.phone}`);
      break;
    case 'payment_intent.payment_failed':
      const paymentIntent = event.data.object;
      console.error(`❌ Pago fallido: ${paymentIntent.last_payment_error?.message || 'Sin detalles'}`);
      break;
    default:
      console.log(`🔔 Evento no manejado: ${event.type}`);
  }

  res.json({ received: true });
});

// Iniciar servidor
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`🟢 Servidor corriendo en ${PORT}`);
});
