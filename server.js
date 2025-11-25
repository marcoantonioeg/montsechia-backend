var stream = require('stream');
var express = require('express');
var Stripe = require('stripe');
var cors = require('cors');
var fileUpload = require('express-fileupload');
var cloudinary = require('cloudinary').v2;
var app = express();
var stripe = Stripe(process.env.STRIPE_SECRET_KEY);

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true
});

app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json());
app.use(fileUpload({
  useTempFiles: false,
  limits: { fileSize: 20 * 1024 * 1024 },
  abortOnLimit: true,
  createParentPath: true
}));

app.get('/products', function(req, res) {
  try {
    var allProducts = [];
    var allPrices = [];
    var hasMore = true;
    var startingAfter = null;

    (function loopProducts() {
      if (!hasMore) {
        hasMore = true;
        startingAfter = null;

        (function loopPrices() {
          if (!hasMore) {

            var formattedProducts = allProducts.map(function(product) {
              var price = allPrices.find(function(p) {
                return p.product === product.id;
              });
              return {
                id: product.id,
                name: product.name,
                description: product.description || 'Sin descripción',
                images: product.images,
                price: price ? price.unit_amount / 100 : 0,
                priceId: price ? price.id : null,
                metadata: product.metadata
              };
            });

            return res.json(formattedProducts);
          }

          var params2 = { limit: 100 };
          if (startingAfter) params2.starting_after = startingAfter;

          stripe.prices.list(params2).then(function(pricesResponse) {
            allPrices = allPrices.concat(pricesResponse.data);
            hasMore = pricesResponse.has_more;
            if (hasMore) startingAfter = pricesResponse.data[pricesResponse.data.length - 1].id;
            loopPrices();
          }).catch(function(error) {
            res.status(500).send({ error: error.message });
          });
        })();

        return;
      }

      var params = { limit: 100 };
      if (startingAfter) params.starting_after = startingAfter;

      stripe.products.list(params).then(function(productsResponse) {
        allProducts = allProducts.concat(productsResponse.data);
        hasMore = productsResponse.has_more;
        if (hasMore) startingAfter = productsResponse.data[productsResponse.data.length - 1].id;
        loopProducts();
      }).catch(function(error) {
        res.status(500).send({ error: error.message });
      });
    })();

  } catch (error) {
    console.log('Error al obtener productos:', error);
    res.status(500).send({ error: error.message });
  }
});

app.get('/products/:id', function(req, res) {
  stripe.products.retrieve(req.params.id).then(function(product) {
    stripe.prices.list({ product: product.id, limit: 1 }).then(function(price) {
      var formattedProduct = Object.assign({}, product, {
        price: price.data[0] ? price.data[0].unit_amount / 100 : 0,
        priceId: price.data[0] ? price.data[0].id : null
      });
      res.json(formattedProduct);
    });
  }).catch(function(error) {
    res.status(404).json({ error: 'Producto no encontrado' });
  });
});

app.post('/create-ephemeral-key', function(req, res) {
  try {
    var customer_id = req.body.customer_id;
    stripe.ephemeralKeys.create(
      { customer: customer_id },
      { apiVersion: '2023-08-16' }
    ).then(function(key) {
      res.json(key);
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/upload-image', function(req, res) {
  console.log('Accediendo a /upload-image');
  
  try {
    if (!req.files || Object.keys(req.files).length === 0) {
      console.log('No se recibieron archivos en la solicitud');
      return res.status(400).json({
        success: false,
        error: 'No se subió ningún archivo'
      });
    }

    var image = req.files.image;
    if (!image) {
      return res.status(400).json({
        success: false,
        error: 'Debes enviar un archivo con el campo "image"'
      });
    }

    var allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
    if (allowedTypes.indexOf(image.mimetype) === -1) {
      return res.status(400).json({
        success: false,
        error: 'Solo se permiten imágenes JPEG, PNG o WEBP'
      });
    }

    if (image.size > 20 * 1024 * 1024) {
      return res.status(400).json({
        success: false,
        error: 'La imagen no puede exceder los 20MB'
      });
    }

    var tipoImagen = req.body.tipo || 'postal';
    var folderName = tipoImagen === 'enmarcar' ? 'fotos_enmarcar' : 'postales_personalizadas';

    var uploadOptions = {
      folder: folderName,
      resource_type: 'auto',
      transformation: [
        { width: 1200, height: 1200, crop: 'limit' },
        { quality: 'auto:best' },
        { fetch_format: 'auto' }
      ],
      allowed_formats: ['jpg', 'png', 'webp'],
      context: 'tipo=' + tipoImagen + '|nota=' + (tipoImagen === 'enmarcar' ? 'Foto para enmarcar' : 'Foto postal')
    };

    var uploadStream = cloudinary.uploader.upload_stream(
      uploadOptions,
      function(error, result) {
        if (error) {
          return res.status(500).json({
            success: false,
            error: 'Error al procesar la imagen'
          });
        }

        var optimizedUrl = "https://res.cloudinary.com/" +
          cloudinary.config().cloud_name +
          "/image/upload/c_limit,w_1200/" +
          result.public_id + "." + result.format;

        res.json({
          success: true,
          url: optimizedUrl,
          public_id: result.public_id,
          format: result.format,
          width: result.width,
          height: result.height,
          tipo: tipoImagen,
          nota: tipoImagen === 'enmarcar' ? 'Foto para enmarcar' : 'Foto postal'
        });
      }
    );

    var bufferStream = new stream.PassThrough();
    bufferStream.end(image.data);
    bufferStream.pipe(uploadStream);

  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Error al procesar la imagen'
    });
  }
});

app.get('/image-proxy/:fileId', function(req, res) {
  stripe.files.retrieve(req.params.fileId).then(function(file) {
    stripe.files.download(req.params.fileId).then(function(fileContent) {
      res.set('Content-Type', file.type);
      res.send(fileContent);
    });
  }).catch(function() {
    res.status(404).send('Imagen no encontrada');
  });
});

app.post('/create-checkout-session', function(req, res) {
  try {
    var cart = req.body.cart;

    var lineItems = cart.map(function(item) {
      function getFinalPrice(item) {
        if (item.isUnframed || item.molduraNota === 'Sin Marco') {
          return 899;
        }
        return item.price;
      }

      var finalPrice = getFinalPrice(item);
      var descriptionParts = [];

      if (item.molduraNota) descriptionParts.push("Moldura: " + item.molduraNota);
      if (item.postalNota) descriptionParts.push("Postal: " + item.postalNota);

      var description = descriptionParts.length > 0
        ? descriptionParts.join(" | ")
        : item.description || item.name;

      return {
        price_data: {
          currency: 'mxn',
          product_data: {
            name: item.name,
            description: description,
            images: item.image ? [item.image] : ['/images/default.png'],
            metadata: item.metadata
          },
          unit_amount: Math.round(finalPrice * 100)
        },
        quantity: item.quantity || 1
      };
    });

    stripe.checkout.sessions.create({
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
            maximum: { unit: 'business_day', value: 3 }
          }
        }
      }],
      line_items: lineItems,
      mode: 'payment',
      allow_promotion_codes: true,
      success_url: req.headers.origin + '/success?session_id={CHECKOUT_SESSION_ID}',
      cancel_url: req.headers.origin + '/cancel'
    }).then(function(session) {
      res.json({ sessionId: session.id });
    });

  } catch (error) {
    res.status(500).json({ 
      error: error.message,
      details: 'StripeError'
    });
  }
});

app.post('/webhook', express.raw({type: 'application/json'}), function(req, res) {
  var sig = req.headers['stripe-signature'];
  var event;

  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      'whsec_your_webhook_secret'
    );
  } catch (err) {
    return res.status(400).send('Webhook Error: ' + err.message);
  }

  switch (event.type) {
    case 'checkout.session.completed':
      var session = event.data.object;
      console.log('Pago exitoso');
      break;
    case 'payment_intent.payment_failed':
      console.log('Pago fallido');
      break;
    default:
      console.log('Evento no manejado: ' + event.type);
  }

  res.json({ received: true });
});

var PORT = process.env.PORT || 3001;
app.listen(PORT, function() {
  console.log("Servidor corriendo en " + PORT);
});
