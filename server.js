const express = require('express');
const Stripe = require('stripe');
const cors = require('cors');

const app = express();
const stripe = Stripe('sk_test_51QLrGR00HjbbLtoKeFrgy8SbOwk7jDO0rhzdM1ipalrsmmKrQXuTmWDSWZR6v8TZiVZ5oy9bs2GhDkHIC8LJOWgI00FiWgmspc'); // Clave en texto plano

app.use(cors());
app.use(express.json());

app.post('/create-checkout-session', async (req, res) => {
  const { cart } = req.body;

  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: cart.map((item) => ({
        price_data: {
          currency: 'usd',
          product_data: {
            name: item.name,
          },
          unit_amount: item.price * 100, // Monto en centavos
        },
        quantity: 1,
      })),
      mode: 'payment',
      success_url: `${req.headers.origin}/success`, // URL de éxito
      cancel_url: `${req.headers.origin}/cancel`, // URL de cancelación
    });

    res.send({ sessionId: session.id });
  } catch (error) {
    res.status(500).send({ error: error.message });
  }
});

// 🔹 Usa el puerto de Railway o 3001 en local
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Servidor backend corriendo en el puerto ${PORT}`);
});
