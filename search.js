export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { ean, name } = req.body;
  if (!ean) return res.status(400).json({ error: 'EAN manquant' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'Clé API non configurée sur le serveur' });

  const prompt = `Tu es un expert en veille prix pour les parfums de luxe.

Pour le parfum avec le code EAN "${ean}"${name ? ` (probablement: ${name})` : ''}, recherche sur le web et trouve les prix actuels publics.

Réponds UNIQUEMENT avec un objet JSON valide, sans markdown ni backticks :
{
  "product_name": "Nom complet (Marque + Nom + volume)",
  "brand": "Marque",
  "volume_ml": 75,
  "type": "Eau de Parfum",
  "found": true,
  "prices": [
    {
      "site": "Nom du site",
      "country": "FR",
      "currency": "EUR",
      "price": 68.90,
      "isOfficial": false,
      "url": "https://...",
      "in_stock": true
    }
  ],
  "notes": "Remarques sur les prix, promos en cours, disponibilités"
}

Cherche sur : le site officiel de la marque, Notino, Sephora, Marionnaud, Nocibé, Beauty Success, News Parfums, MyOrigines, Kapao, Tous mes Parfums, Fragrance.com, Feelunique, Douglas, Flaconi, parfumdreams, Amazon FR/DE/UK/US, et tout autre site pertinent.
Indique isOfficial:true uniquement pour le site officiel de la marque.
Cherche sur au moins 6 plateformes. Inclus prix EUR, GBP et USD si disponibles.
Si introuvable, mets found:false et prices:[].`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1500,
        tools: [{ type: 'web_search_20250305', name: 'web_search' }],
        messages: [{ role: 'user', content: prompt }]
      })
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      return res.status(502).json({ error: err.error?.message || 'Erreur API Anthropic' });
    }

    const data = await response.json();
    const text = data.content.filter(b => b.type === 'text').map(b => b.text).join('');
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return res.status(502).json({ error: 'Réponse inattendue' });

    const result = JSON.parse(match[0]);
    if (result.prices) {
      result.prices = result.prices.map(p => ({
        ...p,
        priceEur: p.currency === 'GBP' ? p.price * 1.18 : p.currency === 'USD' ? p.price * 0.92 : p.price
      }));
    }

    return res.status(200).json(result);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
