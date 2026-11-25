// pages/api/send-email.js
import fetch from 'node-fetch';
import { del } from '@vercel/blob';
const { sendPostmarkEmail, isPostmarkConfigured } = require('../../lib/email/postmark');
const { sendOrderToTelegram } = require('../../lib/alerts/order-telegram');
const { isTelegramConfigured } = require('../../lib/alerts/telegram');
const deliveryStore = require('../../lib/email/delivery-store');

// How long to wait on Microsoft before treating it as down.
const GRAPH_TIMEOUT_MS = 20000;

// Test hook: pretend Microsoft Graph is down so the Postmark + Telegram
// fallbacks can be exercised. Ignored on the production deployment.
const SIMULATE_GRAPH_FAILURE =
    process.env.EMAIL_SIMULATE_GRAPH_FAILURE === 'true' && process.env.VERCEL_ENV !== 'production';

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
const vercelPreviewPattern = /^https:\/\/(?:fluidpowergroup-(?:git-[a-z0-9-]+|[a-z0-9]+)-fluidpower|fpg-frontend-(?:git-[a-z0-9-]+|[a-z0-9]+)-wahwahkhans-projects)\.vercel\.app$/;

// --- Microsoft Graph Authentication ---
async function getGraphAccessToken() {
    const tokenEndpoint = `https://login.microsoftonline.com/${AZURE_TENANT_ID}/oauth2/v2.0/token`;
    
    const params = new URLSearchParams();
    params.append('client_id', AZURE_CLIENT_ID);
    params.append('client_secret', AZURE_CLIENT_SECRET);
    params.append('scope', 'https://graph.microsoft.com/.default');
    params.append('grant_type', 'client_credentials');

    try {
        if (SIMULATE_GRAPH_FAILURE) {
            throw new Error('Simulated Microsoft outage (EMAIL_SIMULATE_GRAPH_FAILURE=true)');
        }
        const response = await fetch(tokenEndpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: params,
            signal: AbortSignal.timeout(GRAPH_TIMEOUT_MS)
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Token request failed: ${response.status} - ${errorText}`);
        }

        const data = await response.json();
        return data.access_token;
    } catch (error) {
        console.error('Failed to get Graph access token:', error);
        throw new Error(`Authentication failed: ${error.message}`);
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
            body: JSON.stringify(emailData),
            signal: AbortSignal.timeout(GRAPH_TIMEOUT_MS)
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
                tube360Orders,
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
                    // The invoice entry used to carry `filename` instead of
                    // `name`, so its PDF arrived as "attachment.pdf". Accept
                    // either, else use the Blob file name (INV-FPG-....pdf).
                    const blobName = blobInfo.name || blobInfo.filename
                        || decodeURIComponent(String(blobInfo.url || '').split('/').pop().split('?')[0])
                        || `Order-${orderNumber}.pdf`;
                    try {
                        const response = await fetch(blobInfo.url);
                        if (!response.ok) {
                            throw new Error(`Failed to download from Blob: ${response.status}`);
                        }
                        
                        const buffer = await response.buffer();
                        const base64Data = buffer.toString('base64');
                        
                        actualPdfAttachments.push({
                            name: blobName,
                            contentBytes: base64Data
                        });
                        
                        console.log(`✅ Downloaded from Blob: ${blobName} (${(buffer.length / 1024).toFixed(2)}KB)`);
                    } catch (error) {
                        console.error(`❌ Failed to download ${blobName} from Blob:`, error.message);
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

                if (tube360Orders && tube360Orders.length > 0) {
                    const tube360Pdfs = tube360Orders
                      .filter(order => order.pdfDataUrl)
                      .map(order => ({
                        name: `TUBE360-${order.cartId || Date.now()}.pdf`,
                        contentBytes: order.pdfDataUrl.split(',')[1]
                      }));
                    actualPdfAttachments.push(...tube360Pdfs);
                    console.log(`🔎 Extracted ${tube360Pdfs.length} Tube360 PDF(s)`);
                }
            }

            if (actualPdfAttachments && actualPdfAttachments.length > 0) {
                console.log(`Processing ${actualPdfAttachments.length} PDF attachment(s) for order ${currentOrderNumber}`);
            }

            // ============================================
            // Send both halves. Each half has its own backup channel:
            //   customer: Microsoft Graph -> Postmark email
            //   business: Microsoft Graph -> Telegram (order details + every PDF)
            // A half that already went out on an earlier QStash attempt is
            // skipped (delivery-store), so retries never double-send.
            // ============================================
            const customerSubject = `Your Order Confirmation - Order #${currentOrderNumber}`;
            const businessSubject = `New Order Received - Order #${currentOrderNumber}`;

            console.log(`Sending emails for order ${currentOrderNumber}`);
            console.log(`Customer email to: ${customerEmailAddress}`);
            console.log(`Business email to: ${BUSINESS_EMAIL}`);

            const delivered = await deliveryStore.getDelivered(currentOrderNumber);
            const results = {
                customerVia: delivered.customer || null,
                businessVia: delivered.business || null,
                errors: []
            };
            if (results.customerVia || results.businessVia) {
                console.log(`↩️ Already delivered on an earlier attempt: customer=${results.customerVia || '-'}, business=${results.businessVia || '-'}`);
            }

            // Check if this is a cart request without customer copy
            const isCartRequestNoCustomerCopy = currentOrderNumber.startsWith('CART-') && !emailTemplates.customerEmailContent;
            if (isCartRequestNoCustomerCopy && !results.customerVia) {
                console.log('⏭️ Skipping customer email (cart request without customer copy)');
                results.customerVia = 'skipped';
            }

            // --- Microsoft Graph token (only if something is still to send) ---
            let accessToken = null;
            let graphError = null;
            if (!results.customerVia || !results.businessVia) {
                try {
                    console.log('Getting Microsoft Graph access token...');
                    accessToken = await getGraphAccessToken();
                    console.log('Graph access token obtained successfully');
                } catch (tokenError) {
                    graphError = tokenError.message;
                    console.error('⚠️ Microsoft Graph unavailable, using backup channels:', graphError);
                }
            }

            // --- Step 1: customer email ---
            if (!results.customerVia) {
                if (accessToken) {
                    try {
                        console.log('Sending customer email via Graph API...');
                        const customerEmailData = formatEmailForGraph(
                            customerEmailAddress, customerSubject, emailTemplates.customerEmailContent,
                            actualPdfAttachments, currentOrderNumber
                        );
                        const customerResult = await sendEmailViaGraph(accessToken, customerEmailData, SENDER_EMAIL);
                        results.customerVia = 'graph';
                        console.log(`✓ Customer email sent successfully. ID: ${customerResult.messageId}`);
                    } catch (customerError) {
                        console.error('⚠️ Customer email via Graph failed:', customerError.message);
                        results.errors.push(`customer/graph: ${customerError.message}`);
                    }
                } else {
                    results.errors.push(`customer/graph: ${graphError}`);
                }

                if (!results.customerVia) {
                    if (isPostmarkConfigured()) {
                        try {
                            console.log('📮 Sending customer email via Postmark backup...');
                            const pm = await sendPostmarkEmail({
                                to: customerEmailAddress,
                                subject: TESTING_MODE ? `[TEST] ${customerSubject}` : customerSubject,
                                html: emailTemplates.customerEmailContent,
                                replyTo: BUSINESS_EMAIL,
                                attachments: actualPdfAttachments,
                                tag: 'order-confirmation-backup'
                            });
                            results.customerVia = 'postmark';
                            console.log(`✓ Customer email sent via Postmark. ID: ${pm.messageId}`);
                        } catch (pmError) {
                            console.error('❌ Postmark backup failed:', pmError.message);
                            results.errors.push(`customer/postmark: ${pmError.message}`);
                        }
                    } else {
                        console.error('❌ Postmark backup not configured (POSTMARK_SERVER_TOKEN / POSTMARK_FROM_EMAIL)');
                        results.errors.push('customer/postmark: not configured');
                    }
                }
                if (results.customerVia) {
                    await deliveryStore.markDelivered(currentOrderNumber, 'customer', results.customerVia);
                }
            }

            // --- Step 2: business email (always attempted, even if the customer half failed) ---
            if (!results.businessVia) {
                if (accessToken) {
                    try {
                        console.log('Sending business email via Graph API...');
                        const businessEmailData = formatEmailForGraph(
                            BUSINESS_EMAIL, businessSubject, emailTemplates.businessEmailContent,
                            actualPdfAttachments, currentOrderNumber
                        );
                        const businessResult = await sendEmailViaGraph(accessToken, businessEmailData, SENDER_EMAIL);
                        results.businessVia = 'graph';
                        console.log(`✓ Business email sent successfully. ID: ${businessResult.messageId}`);
                    } catch (businessError) {
                        console.error('⚠️ Business email via Graph failed:', businessError.message);
                        results.errors.push(`business/graph: ${businessError.message}`);
                    }
                } else {
                    results.errors.push(`business/graph: ${graphError}`);
                }

                if (!results.businessVia) {
                    if (isTelegramConfigured()) {
                        try {
                            console.log(`📨 Sending business copy to Telegram (${actualPdfAttachments.length} PDF(s))...`);
                            await sendOrderToTelegram({
                                orderNumber: currentOrderNumber,
                                paypalCaptureID: payload.paypalCaptureID,
                                userDetails,
                                testingMode: TESTING_MODE,
                                reason: 'Microsoft email failed'
                            }, actualPdfAttachments);
                            results.businessVia = 'telegram';
                            console.log('✓ Business copy delivered to Telegram');
                        } catch (tgError) {
                            console.error('❌ Telegram backup failed:', tgError.message);
                            results.errors.push(`business/telegram: ${tgError.message}`);
                        }
                    } else {
                        console.error('❌ Telegram backup not configured (TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID)');
                        results.errors.push('business/telegram: not configured');
                    }
                }
                if (results.businessVia) {
                    await deliveryStore.markDelivered(currentOrderNumber, 'business', results.businessVia);
                }
            }

            const allDelivered = Boolean(results.customerVia && results.businessVia);

            // ============================================
            // Clean up Blob storage only once BOTH halves are out - a retry
            // still needs the PDFs otherwise.
            // ============================================
            if (allDelivered && blobUrls && blobUrls.length > 0) {
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
            // 200 only when both halves are delivered (by any channel), so
            // QStash stops retrying. Otherwise 500 -> QStash retries, and the
            // halves already delivered are skipped next time.
            const summary = {
                customer: results.customerVia || 'FAILED',
                business: results.businessVia || 'FAILED',
                attachmentCount: actualPdfAttachments?.length || 0,
                testingMode: TESTING_MODE
            };
            if (allDelivered) {
                const usedBackup = results.customerVia === 'postmark' || results.businessVia === 'telegram';
                console.log(`✅ Order ${currentOrderNumber} emails done: customer=${summary.customer}, business=${summary.business}`);
                res.status(200).json({
                    success: true,
                    message: usedBackup
                        ? 'Order emails delivered using backup channels'
                        : 'Order processed and all emails sent successfully via Microsoft Graph',
                    ...summary,
                    warnings: results.errors
                });
            } else {
                console.error(`❌ Order ${currentOrderNumber} emails incomplete: customer=${summary.customer}, business=${summary.business}`);
                res.status(500).json({
                    success: false,
                    error: 'Order emails not fully delivered; will retry',
                    ...summary,
                    details: results.errors
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