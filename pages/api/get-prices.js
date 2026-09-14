// Define valid client keys (consider moving to a shared config file if it grows)
const validClientKeys = {
    [process.env.EXPO_PUBLIC_API_CLIENT_KEY]: {
        name: 'web-client',
        permissions: ['read_prices']
    }
};

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
    // Set CORS headers based on origin validation
    if (origin) { // Only set Allow-Origin if origin header is present
       if (allowedOrigins.includes(origin) || vercelPreviewPattern.test(origin)) {
            res.setHeader('Access-Control-Allow-Origin', origin);
       }
       // Note: If origin is not allowed, the header isn't set, and the browser should block the request.
    } else {
       // Allow requests without an origin (e.g., curl, server-to-server)
       // You might want to be stricter depending on use case. For now, allowing.
       // Alternatively, set a default allowed origin if applicable:
       // res.setHeader('Access-Control-Allow-Origin', 'https://fluidpowergroup.com.au');
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-api-key');
    // res.setHeader('Access-Control-Allow-Credentials', 'true'); // Only if needed

    // --- Handle OPTIONS preflight request ---
    if (req.method === 'OPTIONS') {
        return res.status(204).end();
    }

    // --- Handle GET request ---
    if (req.method === 'GET') {
        // --- Authentication ---
        const clientKey = req.headers['x-api-key'];
        const clientInfo = validClientKeys[clientKey];

        if (!clientInfo || !clientInfo.permissions.includes('read_prices')) {
            console.error(`Unauthorized access attempt to /api/get-prices. Key: ${clientKey ? 'Provided' : 'Missing'}`);
            return res.status(403).json({ error: 'Unauthorized' });
        }
        console.log('Client authorization passed for /api/get-prices');

        // --- Main Logic ---
        try {
            console.log('Prices endpoint accessed (/api/get-prices)');
            // console.log('Request headers:', req.headers); // Keep if needed for debugging

            // Ensure Content-Type is set correctly for JSON response
            res.setHeader('Content-Type', 'application/json');

            res.status(200).json({
                hosePrices: {
                    "1/4": process.env.REACT_APP_HOSE_PRICE_1_4,
                    "3/8": process.env.REACT_APP_HOSE_PRICE_3_8,
                    "1/2": process.env.REACT_APP_HOSE_PRICE_1_2,
                    "5/8": process.env.REACT_APP_HOSE_PRICE_5_8,
                    "3/4": process.env.REACT_APP_HOSE_PRICE_3_4,
                    "1": process.env.REACT_APP_HOSE_PRICE_1
                },
                bspPrices: {
                    "1/8": process.env.REACT_APP_BSP_PRICE_1_8,
                    "1/4": process.env.REACT_APP_BSP_PRICE_1_4,
                    "3/8": process.env.REACT_APP_BSP_PRICE_3_8,
                    "1/2": process.env.REACT_APP_BSP_PRICE_1_2,
                    "3/4": process.env.REACT_APP_BSP_PRICE_3_4,
                    "1": process.env.REACT_APP_BSP_PRICE_1
                },
                jicPrices: {
                    "7/16": process.env.REACT_APP_JIC_PRICE_7_16,
                    "9/16": process.env.REACT_APP_JIC_PRICE_9_16,
                    "3/4": process.env.REACT_APP_JIC_PRICE_3_4,
                    "7/8": process.env.REACT_APP_JIC_PRICE_7_8,
                    "1-1/16": process.env.REACT_APP_JIC_PRICE_1_1_16,
                    "1-3/16": process.env.REACT_APP_JIC_PRICE_1_3_16
                },
                metricPrices: {
                  "M12": process.env.REACT_APP_METRIC_PRICE_M12,
                  "M14": process.env.REACT_APP_METRIC_PRICE_M14,
                  "M16": process.env.REACT_APP_METRIC_PRICE_M16,
                  "M18": process.env.REACT_APP_METRIC_PRICE_M18,
                  "M22": process.env.REACT_APP_METRIC_PRICE_M22,
                  "M26": process.env.REACT_APP_METRIC_PRICE_M26,
                  "M30": process.env.REACT_APP_METRIC_PRICE_M30,
                  "M36": process.env.REACT_APP_METRIC_PRICE_M36
                },
                orfsPrices: {
                  "9/16": process.env.REACT_APP_ORFS_PRICE_9_16,
                  "11/16": process.env.REACT_APP_ORFS_PRICE_11_16,
                  "13/16": process.env.REACT_APP_ORFS_PRICE_13_16,
                  "1": process.env.REACT_APP_ORFS_PRICE_1,
                  "1-3/16": process.env.REACT_APP_ORFS_PRICE_1_3_16
                }
            });
        } catch (error) {
            console.error('Error processing /api/get-prices:', error);
            res.status(500).json({ error: 'Internal Server Error' });
        }
    } else {
        // --- Handle unsupported methods ---
        res.setHeader('Allow', ['GET', 'OPTIONS']);
        res.status(405).json({ error: `Method ${req.method} Not Allowed` });
    }
}