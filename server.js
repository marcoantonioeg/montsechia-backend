const express = require('express');
const Stripe = require('stripe');
const cors = require('cors');

const app = express();
const stripe = Stripe('sk_test_51QLrGR00HjbbLtoKeFrgy8SbOwk7jDO0rhzdM1ipalrsmmKrQXuTmWDSWZR6v8TZiVZ5oy9bs2GhDkHIC8LJOWgI00FiWgmspc'); // Usa tu clave privada

app.use(cors());
app.use(express.json());

/**
 * Ruta para obtener todos los productos desde Stripe con paginación.
 */
app.get('/products', async (req, res) => {
  try {
    let allProducts = [];
    let allPrices = [];
    let hasMore = true;
    let startingAfter = null;

    // Obtener todos los productos paginados
    while (hasMore) {
      const params = { limit: 100 };
      if (startingAfter) params.starting_after = startingAfter; // Solo incluir si tiene valor

      const response = await stripe.products.list(params);
      allProducts = [...allProducts, ...response.data];
      hasMore = response.has_more;
      if (hasMore) {
        startingAfter = response.data[response.data.length - 1].id;
      }
    }

    // Obtener todos los precios paginados
    hasMore = true;
    startingAfter = null;
    while (hasMore) {
      const params = { limit: 100 };
      if (startingAfter) params.starting_after = startingAfter; // Solo incluir si tiene valor

      const response = await stripe.prices.list(params);
      allPrices = [...allPrices, ...response.data];
      hasMore = response.has_more;
      if (hasMore) {
        startingAfter = response.data[response.data.length - 1].id;
      }
    }

    // Formatear la respuesta combinando productos con sus respectivos precios
    const formattedProducts = allProducts.map((product) => {
      const price = allPrices.find((p) => p.product === product.id);
      return {
        id: product.id,
        name: product.name,
        title: product.name,
        description: product.description || 'Sin descripción',
        image: product.images[0] || '/images/default.png',
        price: price?.unit_amount / 100 || 0,
        priceId: price?.id || null,
      };
    });

    res.json(formattedProducts);
  } catch (error) {
    console.error('Error al obtener productos:', error);
    res.status(500).send({ error: error.message });
  }
});

/**
 * Ruta para obtener un producto específico por su ID.
 */
app.get('/products/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const product = await stripe.products.retrieve(id);
    res.json(product);
  } catch (error) {
    res.status(404).json({ error: 'Producto no encontrado' });
  }
});

/**
 * Ruta para crear una sesión de checkout en Stripe con dirección de envío.
 */
app.post('/create-checkout-session', async (req, res) => {
  const { cart } = req.body;

  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      shipping_address_collection: {
        allowed_countries: ['MX', 'US', 'CA'], // Países permitidos para envío
      },
      shipping_options: [
        {
          shipping_rate_data: {
            type: 'fixed_amount',
            fixed_amount: { amount: 5000, currency: 'mxn' }, // Costo de envío en centavos
            display_name: 'Envío estándar',
            delivery_estimate: {
              minimum: { unit: 'business_day', value: 3 },
              maximum: { unit: 'business_day', value: 7 },
            },
          },
        },
      ],
      line_items: cart.map((item) => ({
        price_data: {
          currency: 'mxn',
          product_data: {
            name: item.name,
            images: [item.image],
          },
          unit_amount: item.price * 100, // Convertir pesos a centavos
        },
        quantity: item.quantity || 1,
      })),
      mode: 'payment',
      success_url: `${req.headers.origin}/success`,
      cancel_url: `${req.headers.origin}/cancel`,
    });

    res.send({ sessionId: session.id });
  } catch (error) {
    console.error('Error al crear sesión de checkout:', error);
    res.status(500).send({ error: error.message });
  }
});


// 🔹 Usa el puerto de Railway o 3001 en local
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Servidor backend corriendo en el puerto ${PORT}`);
});
