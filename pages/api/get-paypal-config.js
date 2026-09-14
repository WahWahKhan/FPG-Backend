// Allowed Origins (consider moving to a shared config file)
const allowedOrigins = [
    process.env.LOCAL_DEV_URL,
    process.env.API_BASE_URL,
    'http://localhost:3000',
    'http://localhost:19006',
    'https://fluidpowergroup.com.au'
];
const vercelPreviewPattern = /^https:\/\/(?:fluidpowergroup-(?:git-[a-z0-9-]+|[a-z0-9]+)-fluidpower|fpg-frontend-(?:git-[a-z0-9-]+|[a-z0-9]+)-wahwahkhans-projects)\.vercel\.app$/;

export default async function handler(req, res) {
    const origin = req.headers.origin;

    // --- CORS Handling ---
    if (origin) {
       if (allowedOrigins.includes(origin) || vercelPreviewPattern.test(origin)) {
            res.setHeader('Access-Control-Allow-Origin', origin);
       }
    } else {
       // Allow requests without an origin
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-server-key'); // Note: x-server-key needed

    // --- Handle OPTIONS preflight request ---
    if (req.method === 'OPTIONS') {
        return res.status(204).end();
    }

    // --- Handle GET request ---
    if (req.method === 'GET') {
        // --- Authentication ---
        const serverKey = req.headers['x-server-key'];
        if (serverKey !== process.env.VALID_SERVER_KEY) {
            console.error(`Unauthorized access attempt to /api/get-paypal-config. Key: ${serverKey ? 'Provided' : 'Missing'}`);
            return res.status(403).json({ error: 'Unauthorized' });
        }
        console.log('Server authorization passed for /api/get-paypal-config');

        // --- Main Logic ---
        try {
            console.log('PayPal config endpoint accessed (/api/get-paypal-config)');
            res.setHeader('Content-Type', 'application/json');
            res.status(200).json({
                environment: process.env.EXPO_PUBLIC_PAYPAL_ENVIRONMENT,
                sandboxEmail: process.env.EXPO_PUBLIC_PAYPAL_SANDBOX_EMAIL,
                productionEmail: process.env.EXPO_PUBLIC_PAYPAL_PRODUCTION_EMAIL
            });
        } catch (error) {
            console.error('Error processing /api/get-paypal-config:', error);
            res.status(500).json({ error: 'Internal Server Error' });
        }
    } else {
        // --- Handle unsupported methods ---
        res.setHeader('Allow', ['GET', 'OPTIONS']);
        res.status(405).json({ error: `Method ${req.method} Not Allowed` });
    }
}