// pages/api/send-email.js
import fetch from 'node-fetch';
import { del } from '@vercel/blob';

// ========================================
// TESTING MODE CONFIGURATION
// ========================================
const TESTING_MODE = process.env.TESTING_MODE === 'true';

// --- Environment Variables ---
const AZURE_TENANT_ID = process.env.AZURE_TENANT_ID;
const AZURE_CLIENT_ID = process.env.AZURE_CLIENT_ID;
const AZURE_CLIENT_SECRET = process.env.AZURE_CLIENT_SECRET;

const BUSINESS_EMAIL = TESTING_MODE 
    ? (process.env.BUSINESS_EMAIL_TEST || 'info@agcomponents.com.au')
    : process.env.BUSINESS_EMAIL;

const SENDER_EMAIL = TESTING_MODE
    ? (process.env.SENDER_EMAIL_TEST || process.env.SENDER_EMAIL)
    : process.env.SENDER_EMAIL;

const VALID_SERVER_KEY = process.env.VALID_SERVER_KEY;

console.log('=== SEND-EMAIL DEBUG ===');
console.log('🔑 VALID_SERVER_KEY exists?', !!VALID_SERVER_KEY);
console.log('🔑 Value length:', VALID_SERVER_KEY?.length || 0);
console.log('🔑 First 5 chars:', VALID_SERVER_KEY?.substring(0, 5) || 'MISSING');
console.log('========================');

if (TESTING_MODE) {
    console.log('🧪 EMAIL TESTING MODE ENABLED');
    console.log(`📧 Test emails will be sent to: ${BUSINESS_EMAIL}`);
}

// --- Allowed Origins Definition ---
const allowedOrigins = [
    process.env.LOCAL_DEV_URL,
    process.env.API_BASE_URL,
    'http://localhost:3000',
    'http://localhost:3001',
    'http://localhost:19006',
    'https://fluidpowergroup.com.au',
    'https://www.fluidpowergroup.com.au'
];
const vercelPreviewPattern = /^https:\/\/fluidpowergroup-[a-z0-9]+-fluidpower\.vercel\.app$/;

// --- Microsoft Graph Authentication ---
async function getGraphAccessToken() {
    const tokenEndpoint = `https://login.microsoftonline.com/${AZURE_TENANT_ID}/oauth2/v2.0/token`;
    
    const params = new URLSearchParams();
    params.append('client_id', AZURE_CLIENT_ID);
    params.append('client_secret', AZURE_CLIENT_SECRET);
    params.append('scope', 'https://graph.microsoft.com/.default');
    params.append('grant_type', 'client_credentials');

    try {
        const response = await fetch(tokenEndpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: params
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Token request failed: ${response.status} - ${errorText}`);
        }

        const data = await response.json();
        return data.access_token;
    } catch (error) {
        console.error('Failed to get Graph access token:', error);
        throw new Error('Authentication failed');
    }
}

// --- Send Email via Microsoft Graph ---
async function sendEmailViaGraph(accessToken, emailData, fromEmail) {
    const graphEndpoint = `https://graph.microsoft.com/v1.0/users/${fromEmail}/sendMail`;
    
    try {
        const response = await fetch(graphEndpoint, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(emailData)
        });

        if (response.status === 202) {
            return { success: true, messageId: response.headers.get('request-id') || 'sent' };
        } else {
            const errorText = await response.text();
            throw new Error(`Graph API error: ${response.status} - ${errorText}`);
        }
    } catch (error) {
        console.error('Graph API send failed:', error);
        throw error;
    }
}

// --- Format Email for Graph API with Multiple PDF Support ---
function formatEmailForGraph(toEmail, subject, htmlContent, pdfAttachments, orderNumber) {
    const finalSubject = TESTING_MODE ? `[TEST] ${subject}` : subject;

    const emailData = {
        message: {
            subject: finalSubject,
            body: {
                contentType: 'HTML',
                content: htmlContent
            },
            toRecipients: [
                {
                    emailAddress: {
                        address: toEmail
                    }
                }
            ]
        },
        saveToSentItems: true
    };

    if (pdfAttachments && Array.isArray(pdfAttachments) && pdfAttachments.length > 0) {
        emailData.message.attachments = pdfAttachments.map((pdf, index) => ({
            '@odata.type': '#microsoft.graph.fileAttachment',
            name: pdf.name || `Order-${orderNumber}-Attachment-${index + 1}.pdf`,
            contentType: 'application/pdf',
            contentBytes: pdf.contentBytes
        }));
        
        console.log(`Added ${pdfAttachments.length} PDF attachment(s) to email`);
    }

    return emailData;
}

// --- Main Handler Function ---
export default async function handler(req, res) {
    const origin = req.headers.origin;

    // --- CORS Logic ---
    let isOriginAllowed = false;
    if (origin) {
        if (allowedOrigins.includes(origin) || vercelPreviewPattern.test(origin)) {
            isOriginAllowed = true;
        }
    } else {
        isOriginAllowed = true;
    }

    if (isOriginAllowed && origin) {
       res.setHeader('Access-Control-Allow-Origin', origin);
    }
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-server-key');
    res.setHeader('Access-Control-Allow-Credentials', 'true');

    // --- Handle OPTIONS preflight request ---
    if (req.method === 'OPTIONS') {
        if (!isOriginAllowed && origin) {
             console.warn(`CORS preflight denied for origin: ${origin}`);
             return res.status(403).json({ error: 'Forbidden' });
        }
        console.log(`CORS preflight OK for origin: ${origin}`);
        return res.status(204).end();
    }

    // --- Handle POST request ---
    if (req.method === 'POST') {
        res.setHeader('Content-Type', 'application/json');
        
        // --- Authentication ---
        const serverKey = req.headers['x-server-key'];
        
        if (!VALID_SERVER_KEY) {
             console.error("FATAL: VALID_SERVER_KEY is not configured.");
             return res.status(500).json({ error: 'Server configuration error.' });
        }
        
        if (serverKey !== VALID_SERVER_KEY) {
            console.error(`Unauthorized access attempt. Key: ${serverKey ? 'Provided (mismatch)' : 'Missing'}`);
            return res.status(403).json({ error: 'Unauthorized' });
        }

        try {
            console.log('Graph email endpoint accessed (/api/send-email)');
            if (TESTING_MODE) {
                console.log('🧪 Running in TESTING MODE - using test email addresses');
            }

            // ============================================
            // 🔍 DEBUG: Log the entire request body
            // ============================================
            console.log('📦 Raw request body keys:', Object.keys(req.body));
            console.log('📦 Request body structure:', JSON.stringify(req.body, null, 2).substring(0, 500));

            // --- Validate Graph Configuration ---
            if (!AZURE_TENANT_ID || !AZURE_CLIENT_ID || !AZURE_CLIENT_SECRET) {
                console.error("FATAL: Microsoft Graph configuration missing.");
                return res.status(500).json({ success: false, error: "Email service configuration error." });
            }

            if (!BUSINESS_EMAIL || !SENDER_EMAIL) {
                console.error("FATAL: Business email or sender email not configured.");
                return res.status(500).json({ success: false, error: "Email service configuration error." });
            }

            // ============================================
            // FIXED: Handle both direct and QStash payloads
            // ============================================
            // QStash wraps the payload in a 'body' property
            const payload = req.body.body || req.body;
            
            console.log('📦 Using payload from:', req.body.body ? 'QStash wrapper' : 'direct body');

            const {
                orderNumber,
                userDetails,
                pdfAttachments,
                pwaOrders,
                trac360Orders,
                function360Orders, 
                blobUrls,
                emailTemplates,
                userEmail,
                testingMode
            } = payload;

            // ============================================
            // 🔍 DEBUG: Log extracted values
            // ============================================
            console.log('📧 Customer email from userDetails:', userDetails?.email);
            console.log('📧 Customer email from userEmail:', userEmail);
            console.log('📋 Email templates present:', !!emailTemplates);
            console.log('📋 Customer template present:', !!emailTemplates?.customerEmailContent);
            console.log('📋 Business template present:', !!emailTemplates?.businessEmailContent);
            console.log('📎 Blob URLs count:', blobUrls?.length || 0);
            console.log('📎 Direct attachments count:', pdfAttachments?.length || 0);

            // Validate required data
            const customerEmailAddress = userDetails?.email || userEmail;
            if (!customerEmailAddress || !emailTemplates || !emailTemplates.customerEmailContent || !emailTemplates.businessEmailContent) {
                 console.error('❌ Validation Failed: Missing crucial email content or customer email.');
                 console.error('Missing:', {
                     customerEmail: !customerEmailAddress,
                     emailTemplates: !emailTemplates,
                     customerContent: !emailTemplates?.customerEmailContent,
                     businessContent: !emailTemplates?.businessEmailContent
                 });
                 return res.status(400).json({ 
                     success: false, 
                     error: "Missing required email content or recipient data.",
                     debug: {
                         hasCustomerEmail: !!customerEmailAddress,
                         hasEmailTemplates: !!emailTemplates,
                         hasCustomerContent: !!emailTemplates?.customerEmailContent,
                         hasBusinessContent: !!emailTemplates?.businessEmailContent
                     }
                 });
            }
            
            const currentOrderNumber = orderNumber || 'Unknown';

            // ============================================
            // Download PDFs from Blob if provided
            // ============================================
            let actualPdfAttachments = [];

            if (blobUrls && blobUrls.length > 0) {
                console.log(`📥 Downloading ${blobUrls.length} PDF(s) from Vercel Blob...`);
                
                for (const blobInfo of blobUrls) {
                    try {
                        const response = await fetch(blobInfo.url);
                        if (!response.ok) {
                            throw new Error(`Failed to download from Blob: ${response.status}`);
                        }
                        
                        const buffer = await response.buffer();
                        const base64Data = buffer.toString('base64');
                        
                        actualPdfAttachments.push({
                            name: blobInfo.name,
                            contentBytes: base64Data
                        });
                        
                        console.log(`✅ Downloaded from Blob: ${blobInfo.name} (${(buffer.length / 1024).toFixed(2)}KB)`);
                    } catch (error) {
                        console.error(`❌ Failed to download ${blobInfo.name} from Blob:`, error.message);
                    }
                }
                
                console.log(`✅ Downloaded ${actualPdfAttachments.length}/${blobUrls.length} PDF(s) from Blob`);
            } else if (pdfAttachments) {
                actualPdfAttachments = pdfAttachments;
                console.log(`📎 Using direct PDF attachments (${pdfAttachments.length})`);
            } else {
                // LOCAL MODE - Extract PDFs from order data when Blob unavailable
                console.log('📎 Extracting PDFs from order data (local mode)...');
                
                if (trac360Orders && trac360Orders.length > 0) {
                    const trac360Pdfs = trac360Orders
                        .filter(order => order.pdfDataUrl)
                        .map(order => ({
                            name: `TRAC360-${order.cartId || Date.now()}.pdf`,
                            contentBytes: order.pdfDataUrl.split(',')[1]
                        }));
                    actualPdfAttachments.push(...trac360Pdfs);
                    console.log(`📎 Extracted ${trac360Pdfs.length} Trac360 PDF(s)`);
                }
                
                if (pwaOrders && pwaOrders.length > 0) {
                    const pwaPdfs = pwaOrders
                        .filter(order => order.pdfDataUrl)
                        .map(order => ({
                            name: `HOSE360-${order.cartId || Date.now()}.pdf`,
                            contentBytes: order.pdfDataUrl.split(',')[1]
                        }));
                    actualPdfAttachments.push(...pwaPdfs);
                    console.log(`📎 Extracted ${pwaPdfs.length} PWA PDF(s)`);
                }

                if (function360Orders && function360Orders.length > 0) {
                    const function360Pdfs = function360Orders
                      .filter(order => order.pdfDataUrl)
                      .map(order => ({
                        name: `FUNCTION360-${order.cartId || Date.now()}.pdf`,
                        contentBytes: order.pdfDataUrl.split(',')[1]
                      }));
                    actualPdfAttachments.push(...function360Pdfs);
                    console.log(`🔎 Extracted ${function360Pdfs.length} Function360 PDF(s)`);
                }
            }

            if (actualPdfAttachments && actualPdfAttachments.length > 0) {
                console.log(`Processing ${actualPdfAttachments.length} PDF attachment(s) for order ${currentOrderNumber}`);
            }

            // --- Get Graph Access Token ---
            console.log('Getting Microsoft Graph access token...');
            const accessToken = await getGraphAccessToken();
            console.log('Graph access token obtained successfully');

            // --- Prepare emails with PDF attachments ---
            const customerEmailData = formatEmailForGraph(
                customerEmailAddress,
                `Your Order Confirmation - Order #${currentOrderNumber}`,
                emailTemplates.customerEmailContent,
                actualPdfAttachments,
                currentOrderNumber
            );

            const businessEmailData = formatEmailForGraph(
                BUSINESS_EMAIL,
                `New Order Received - Order #${currentOrderNumber}`,
                emailTemplates.businessEmailContent,
                actualPdfAttachments,
                currentOrderNumber
            );

            // --- Send emails sequentially ---
            console.log(`Sending emails for order ${currentOrderNumber}`);
            console.log(`Customer email to: ${customerEmailAddress}`);
            console.log(`Business email to: ${BUSINESS_EMAIL}`);

            let results = {
                customerEmailSent: false,
                businessEmailSent: false,
                warnings: []
            };

            // Check if this is a cart request without customer copy
            const isCartRequestNoCustomerCopy = currentOrderNumber.startsWith('CART-') && !emailTemplates.customerEmailContent;

            // Step 1: Send customer email (SKIP if cart request without copy)
            if (!isCartRequestNoCustomerCopy) {
                try {
                    console.log('Sending customer email via Graph API...');
                    const customerResult = await sendEmailViaGraph(accessToken, customerEmailData, SENDER_EMAIL);
                    results.customerEmailSent = true;
                    console.log(`✓ Customer email sent successfully. ID: ${customerResult.messageId}`);
                } catch (customerError) {
                    console.error('CRITICAL: Customer email failed:', customerError.message);
                    return res.status(500).json({ 
                        success: false, 
                        error: 'Failed to send order confirmation to customer',
                        details: customerError.message 
                    });
                }
            } else {
                console.log('⏭️ Skipping customer email (cart request without customer copy)');
                results.customerEmailSent = true; // Mark as "sent" to avoid errors
            }

            // Step 2: Send business email
            try {
                console.log('Sending business email via Graph API...');
                const businessResult = await sendEmailViaGraph(accessToken, businessEmailData, SENDER_EMAIL);
                results.businessEmailSent = true;
                console.log(`✓ Business email sent successfully. ID: ${businessResult.messageId}`);
            } catch (businessError) {
                console.error('Business email failed (customer email succeeded):', businessError.message);
                results.warnings.push('Business notification email failed to send');
            }

            // ============================================
            // Clean up Blob storage after successful send
            // ============================================
            if (blobUrls && blobUrls.length > 0) {
                console.log(`🗑️ Cleaning up ${blobUrls.length} PDF(s) from Vercel Blob...`);
                
                for (const blobInfo of blobUrls) {
                    try {
                        await del(blobInfo.url);
                        console.log(`✅ Deleted from Blob: ${blobInfo.url.split('/').pop()}`);
                    } catch (error) {
                        console.error(`⚠️ Failed to delete from Blob ${blobInfo.url}:`, error.message);
                    }
                }
                
                console.log(`✅ Blob cleanup complete for order ${currentOrderNumber}`);
            }

            // --- Determine response ---
            if (results.customerEmailSent && results.businessEmailSent) {
                res.status(200).json({ 
                    success: true,
                    message: 'Order processed and all emails sent successfully via Microsoft Graph',
                    method: 'Microsoft Graph API',
                    attachmentCount: actualPdfAttachments?.length || 0,
                    testingMode: TESTING_MODE
                });
            } else if (results.customerEmailSent && !results.businessEmailSent) {
                res.status(200).json({ 
                    success: true,
                    message: 'Order processed and customer notified successfully via Microsoft Graph',
                    warnings: results.warnings,
                    method: 'Microsoft Graph API',
                    attachmentCount: actualPdfAttachments?.length || 0,
                    testingMode: TESTING_MODE
                });
            } else {
                res.status(500).json({ 
                    success: false, 
                    error: 'Unexpected error in email processing' 
                });
            }

        } catch (error) {
            console.error('Error in Graph email processing:', error);
            res.status(500).json({ 
                success: false, 
                error: error.message || 'Internal server error processing email request.' 
            });
        }
    } else {
        res.setHeader('Allow', ['POST', 'OPTIONS']);
        res.status(405).json({ error: `Method ${req.method} Not Allowed` });
    }
}

export const config = {
    api: {
      bodyParser: {
        sizeLimit: '10mb',
      },
    },
};