// pages/api/paypal/capture-order.js - TRAC 360 VERSION
// This version supports: Website Products, PWA Orders, and Trac 360 Orders

import fetch from 'node-fetch';
import swell from 'swell-node';
import { put } from '@vercel/blob';
import { setOrderStatus, getOrderStatus, updateOrderStatus } from './order-status.js';
import { pushToQStash, generateEmailTemplates } from '../../../lib/qstash-helper';
import { generateInvoicePDF } from '../../../lib/invoice/invoice-generator';

// ========================================
// TESTING MODE CONFIGURATION
// ========================================
const TESTING_MODE = process.env.TESTING_MODE === 'true';

// ========================================
// IDEMPOTENCY TRACKING
// ========================================
const processedPayPalOrders = new Map();

function isPayPalOrderProcessed(paypalOrderId) {
    return processedPayPalOrders.has(paypalOrderId);
}

function markPayPalOrderProcessed(paypalOrderId, internalOrderNumber) {
    processedPayPalOrders.set(paypalOrderId, {
        internalOrderNumber,
        timestamp: new Date().toISOString()
    });
    console.log(`🔒 Marked PayPal order ${paypalOrderId} as processed`);
}

setInterval(() => {
    const dayAgo = Date.now() - (24 * 60 * 60 * 1000);
    for (const [orderId, data] of processedPayPalOrders.entries()) {
        const orderTime = new Date(data.timestamp).getTime();
        if (orderTime < dayAgo) {
            console.log(`🗑️ Cleaning up old processed order: ${orderId}`);
            processedPayPalOrders.delete(orderId);
        }
    }
}, 60 * 60 * 1000);

// ========================================
// HELPER FUNCTIONS
// ========================================

async function uploadPDFsToBlob(ordersWithPDFs, orderNumber) {
    const blobUrls = [];
    
    console.log('📦 uploadPDFsToBlob received:', ordersWithPDFs.map(o => ({
        type: o.type,
        cartId: o.cartId
    })));
    
    for (let i = 0; i < ordersWithPDFs.length; i++) {
        const order = ordersWithPDFs[i];

        console.log(`🔍 Processing order ${i}: type="${order.type}", cartId="${order.cartId}"`);
        
        if (!order.pdfDataUrl) continue;
        
        try {
            const base64Data = order.pdfDataUrl.split(',')[1];
            const buffer = Buffer.from(base64Data, 'base64');
            
            // Determine filename based on order type
            const orderType = order.type === 'trac360_order' ? 'tractor' : 
                  order.type === 'pwa_order' ? 'assembly' : 
                  order.type === 'function360_order' ? 'function' : 'unknown';
            const filename = `orders/${orderNumber}/${orderType}-${order.cartId || i}.pdf`;

            // Add debug logging:
            console.log(`📄 Uploading PDF - Type: ${order.type}, Filename: ${filename}`);
            
            console.log(`📤 Uploading PDF to Blob: ${filename} (${(buffer.length / 1024).toFixed(2)}KB)`);
            
            const blob = await put(filename, buffer, {
                access: 'public',
                addRandomSuffix: true,
                contentType: 'application/pdf',
            });
            
            console.log(`✅ PDF uploaded: ${blob.url}`);
            
            const pdfName = order.type === 'trac360_order' 
                ? `TRAC360-${order.cartId || 'order'}.pdf`
                : order.type === 'pwa_order'
                ? `HOSE360-${order.cartId || 'order'}.pdf`
                : order.type === 'function360_order'
                ? `FUNCTION360-${order.cartId || 'order'}.pdf`
                : `Order-${order.cartId || 'order'}.pdf`;

            console.log(`✅ PDF uploaded - Type: ${order.type}, Name: ${pdfName}`);

            blobUrls.push({
                url: blob.url,
                name: pdfName,
                cartId: order.cartId,
                type: order.type
            });
            
        } catch (error) {
            console.error(`❌ Failed to upload PDF for order ${order.cartId}:`, error);
        }
    }
    
    return blobUrls;
}

async function getPayPalAccessToken(PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET, PAYPAL_API_BASE) {
    const auth = Buffer.from(`${PAYPAL_CLIENT_ID}:${PAYPAL_CLIENT_SECRET}`).toString('base64');
    const url = `${PAYPAL_API_BASE}/v1/oauth2/token`;
    try {
        const response = await fetch(url, { 
            method: 'POST', 
            headers: { 
                'Authorization': `Basic ${auth}`, 
                'Content-Type': 'application/x-www-form-urlencoded', 
            }, 
            body: 'grant_type=client_credentials', 
        });
        if (!response.ok) {
            const errorData = await response.json().catch(() => ({ message: `Failed to get token, status: ${response.status}`}));
            throw new Error(errorData.message || `Failed to get PayPal access token. Status: ${response.status}`);
        }
        const data = await response.json();
        return data.access_token;
    } catch (error) { 
        console.error("Error fetching PayPal access token:", error); 
        throw new Error('Could not obtain PayPal access token.'); 
    }
}

async function updateSwellInventory(products, orderId) {
    if (!products || products.length === 0) {
        console.log('No products to update inventory for.');
        return { success: true, message: 'No inventory to update' };
    }

    const results = [];

    for (const item of products) {
        try {
            console.log(`\n📦 Processing: ${item.name} (${item.id})`);
            console.log(`   Quantity sold: ${item.quantity}`);

            const adjustment = await swell.post('/products:stock', {
                parent_id: item.id,
                quantity: -item.quantity,
                reason: 'sold',
                reason_message: `PayPal Order ${orderId}`
            });

            console.log(`✅ Stock updated successfully!`);
            console.log(`   Previous level: ${adjustment.level + item.quantity}`);
            console.log(`   New level: ${adjustment.level}`);

            results.push({
                productId: item.id,
                productName: item.name,
                success: true,
                newStockLevel: adjustment.level
            });

        } catch (error) {
            console.error(`❌ Failed to update stock for ${item.id}:`, error.message);
            results.push({
                productId: item.id,
                productName: item.name,
                success: false,
                error: error.message
            });
        }
    }

    console.log('\n✅ Inventory update complete!');
    
    const successCount = results.filter(r => r.success).length;
    const failCount = results.filter(r => !r.success).length;
    
    return {
        success: failCount === 0,
        totalProcessed: results.length,
        successCount,
        failCount,
        details: results
    };
}

// ========================================
// MAIN API HANDLER
// ========================================
export default async function handler(req, res) {
    const origin = req.headers.origin;

    console.log('📍 Request origin:', origin);
    console.log('📍 Request method:', req.method);

    const allowedOrigins = [
        'http://localhost:3000',
        'http://localhost:3001',
        'https://fluidpowergroup.com.au',
        'https://www.fluidpowergroup.com.au',
    ];

    if (origin && origin.includes('.vercel.app')) {
        allowedOrigins.push(origin);
    }

    const isAllowed = allowedOrigins.includes(origin);

    if (isAllowed && origin) {
        res.setHeader('Access-Control-Allow-Origin', origin);
    } else if (!origin) {
        res.setHeader('Access-Control-Allow-Origin', '*');
    } else {
        res.setHeader('Access-Control-Allow-Origin', origin);
    }

    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-server-key');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Max-Age', '86400');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'POST') { 
        res.setHeader('Allow', ['POST', 'OPTIONS']); 
        return res.status(405).json({ success: false, error: `Method ${req.method} Not Allowed` }); 
    }

    swell.init(process.env.SWELL_STORE_ID, process.env.SWELL_SECRET_KEY);

    const isVercelPreview = process.env.VERCEL_ENV === 'preview';
    let PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET, PAYPAL_API_BASE;

    if (TESTING_MODE) {
        const useTestSandbox = process.env.TEST_USE_SANDBOX !== 'false';
        PAYPAL_CLIENT_ID = useTestSandbox ? process.env.SANDBOX_CLIENT_ID_TEST : process.env.PRODUCTION_CLIENT_ID_TEST;
        PAYPAL_CLIENT_SECRET = useTestSandbox ? process.env.SANDBOX_SECRET_TEST : process.env.PRODUCTION_SECRET_TEST;
        PAYPAL_API_BASE = useTestSandbox ? 'https://api-m.sandbox.paypal.com' : 'https://api-m.paypal.com';
    } else {
        const forceSandbox = process.env.PAYPAL_MODE === 'sandbox';
        const forceProduction = process.env.PAYPAL_MODE === 'production';
        const USE_SANDBOX = forceProduction ? false : (forceSandbox || isVercelPreview || process.env.NODE_ENV !== 'production');
        PAYPAL_CLIENT_ID = USE_SANDBOX ? process.env.SANDBOX_CLIENT_ID : process.env.PRODUCTION_CLIENT_ID;
        PAYPAL_CLIENT_SECRET = USE_SANDBOX ? process.env.SANDBOX_SECRET : process.env.PRODUCTION_SECRET;
        PAYPAL_API_BASE = USE_SANDBOX ? 'https://api-m.sandbox.paypal.com' : 'https://api-m.paypal.com';
    }

    if (!PAYPAL_CLIENT_ID || !PAYPAL_CLIENT_SECRET) {
        console.error(`❌ Missing PayPal credentials`);
        return res.status(500).json({ 
            success: false, 
            error: 'PayPal configuration error'
        });
    }

    console.log('=== PAYPAL CREDENTIAL DEBUG ===');
    console.log('TESTING_MODE:', TESTING_MODE);
    console.log('PAYPAL_API_BASE:', PAYPAL_API_BASE);
    console.log('PAYPAL_CLIENT_ID (first 10 chars):', PAYPAL_CLIENT_ID?.substring(0, 10));
    console.log('Using SANDBOX?', PAYPAL_API_BASE.includes('sandbox'));
    console.log('================================');

    console.log("📥 Received capture-order request");
    if (TESTING_MODE) console.log("🧪 Running in TESTING MODE");

    // NEW: Extract trac360Orders from request body
    const {
        orderID,
        payerID,
        orderNumber,
        userDetails,
        websiteProducts = [],
        pwaOrders = [],
        trac360Orders = [],
        function360Orders = [],
        totals
    } = req.body;

    // NEW: Log order composition
    console.log('📊 Order Composition:');
    console.log(`   Website products: ${websiteProducts.length}`);
    console.log(`   PWA orders: ${pwaOrders.length}`);
    console.log(`   Trac 360 orders: ${trac360Orders.length}`);
    console.log(`   Function 360 orders: ${function360Orders.length}`)

    if (!orderID) {
        console.error("❌ Missing PayPal orderID");
        return res.status(400).json({ success: false, error: 'Missing required PayPal orderID.' });
    }

    try {
        // ============================================================================
        // STEP 1: Check for duplicate processing
        // ============================================================================
        
        if (isPayPalOrderProcessed(orderID)) {
            const existingOrder = processedPayPalOrders.get(orderID);
            console.warn(`⚠️ PayPal order ${orderID} already processed as ${existingOrder.internalOrderNumber}`);
            
            return res.status(200).json({
                success: true,
                message: 'Order already processed',
                duplicate: true,
                orderNumber: existingOrder.internalOrderNumber,
                paypalOrderID: orderID
            });
        }

        // ============================================================================
        // STEP 2: Initialize order status tracking
        // ============================================================================
        
        console.log(`📊 Initializing order status for ${orderNumber}`);
        setOrderStatus(orderNumber, 'pending', {
            paypalOrderID: orderID,
            payerID: payerID,
            createdAt: new Date().toISOString()
        });

        // ============================================================================
        // STEP 3: Capture payment from PayPal
        // ============================================================================
        
        console.log(`💳 Capturing PayPal order: ${orderID}`);
        const accessToken = await getPayPalAccessToken(PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET, PAYPAL_API_BASE);
        
        const captureUrl = `${PAYPAL_API_BASE}/v2/checkout/orders/${orderID}/capture`;
        const captureResponse = await fetch(captureUrl, {
            method: 'POST',
            headers: { 
                'Authorization': `Bearer ${accessToken}`, 
                'Content-Type': 'application/json', 
            }
        });

        const captureData = await captureResponse.json().catch(async () => ({ 
            error_text: await captureResponse.text() 
        }));

        if (!captureResponse.ok) {
            console.error(`❌ PayPal capture failed: ${captureResponse.status}`, captureData);
            
            const errorMessage = captureData?.details?.[0]?.description || 
                                captureData?.message || 
                                captureData?.error_text || 
                                'Payment capture failed.';
            
            if (captureData.name === 'ORDER_ALREADY_CAPTURED' || 
                (captureData?.details?.[0]?.issue === 'ORDER_ALREADY_CAPTURED')) {
                console.warn(`⚠️ Order ${orderID} already captured`);
                
                markPayPalOrderProcessed(orderID, orderNumber);
                
                return res.status(200).json({ 
                    success: true, 
                    message: 'Order already captured', 
                    paypalStatus: 'COMPLETED', 
                    duplicate: true
                });
            }
            
            setOrderStatus(orderNumber, 'failed', {
                error: errorMessage,
                paypalStatus: captureResponse.status
            });
            
            return res.status(captureResponse.status >= 500 ? 502 : 400).json({ 
                success: false, 
                error: errorMessage 
            });
        }

        console.log(`✅ PayPal order captured: ${orderID}`);

        let finalCaptureStatus = captureData.status;
        let captureId = null;

        if (captureData.purchase_units?.[0]?.payments?.captures?.[0]) {
            finalCaptureStatus = captureData.purchase_units[0].payments.captures[0].status;
            captureId = captureData.purchase_units[0].payments.captures[0].id;
            console.log(`📋 Capture ID: ${captureId}, Status: ${finalCaptureStatus}`);
        }

        if (finalCaptureStatus !== 'COMPLETED' && finalCaptureStatus !== 'PENDING') {
            console.warn(`⚠️ Unexpected capture status: ${finalCaptureStatus}`);
            setOrderStatus(orderNumber, 'failed', {
                error: `Payment status is ${finalCaptureStatus}`,
                paypalCaptureStatus: finalCaptureStatus
            });
            
            return res.status(400).json({ 
                success: false, 
                error: `Payment status is ${finalCaptureStatus}` 
            });
        }

        // ============================================================================
        // STEP 4: Mark order as processed
        // ============================================================================
        
        markPayPalOrderProcessed(orderID, orderNumber);

        // ============================================================================
        // STEP 5: Update inventory for all product types
        // ============================================================================
        
        let inventoryResult = { success: true };
        
        // Update website product inventory
        if (websiteProducts && websiteProducts.length > 0) {
            console.log(`📦 Updating inventory for ${websiteProducts.length} website products...`);
            inventoryResult = await updateSwellInventory(websiteProducts, captureId);
            console.log(`✅ Website inventory update result:`, inventoryResult.success);
        }
        
        // NEW: Update Trac 360 inventory
        if (trac360Orders && trac360Orders.length > 0) {
            console.log(`🚜 Processing inventory for ${trac360Orders.length} Trac 360 orders...`);
            
            // Extract Swell product IDs from tractor configurations
            const trac360Products = trac360Orders.flatMap(order => {
                const productIds = order.tractorConfig?.productIds || [];
                return productIds.map(productId => ({
                    id: productId,
                    quantity: 1,  // Each tractor config uses 1 of each component
                    name: `${order.name} - ${productId}`
                }));
            });
            
            if (trac360Products.length > 0) {
                console.log(`📦 Updating inventory for ${trac360Products.length} Trac 360 components...`);
                const trac360InventoryResult = await updateSwellInventory(trac360Products, captureId);
                console.log(`✅ Trac 360 inventory update result:`, trac360InventoryResult.success);
                
                updateOrderStatus(orderNumber, { 
                    trac360InventoryUpdated: trac360InventoryResult.success 
                });
            }
        }

        // NEW: Update Function 360 inventory
        if (function360Orders && function360Orders.length > 0) {
            console.log(`🔧 Processing inventory for ${function360Orders.length} Function 360 orders...`);
            
            // Extract Swell product IDs from configuration
            const function360Products = function360Orders.flatMap(order => {
            const productIds = order.configuration?.swellProductIds || [];
            return productIds.map(productId => ({
                id: productId,
                quantity: 1,
                name: `${order.name} - ${productId}`
            }));
            });
            
            if (function360Products.length > 0) {
            console.log(`📦 Updating inventory for ${function360Products.length} Function 360 components...`);
            const function360InventoryResult = await updateSwellInventory(function360Products, captureId);
            console.log(`✅ Function 360 inventory update result:`, function360InventoryResult.success);
            
            updateOrderStatus(orderNumber, { 
                function360InventoryUpdated: function360InventoryResult.success 
            });
            }
        }
        
        updateOrderStatus(orderNumber, { 
            inventoryUpdated: inventoryResult.success 
        });

        // ============================================================================
        // STEP 5.5: Generate invoice PDF for all order types
        // ============================================================================

        // Determine callback URL and local mode early (needed by STEP 5.5 and STEP 6)
        const callbackUrl = (() => {
            if (process.env.VERCEL_URL) {
                return `https://${process.env.VERCEL_URL}/api/send-email`;
            }
            if (process.env.API_BASE_URL) {
                return `${process.env.API_BASE_URL}/api/send-email`;
            }
            if (TESTING_MODE) {
                return process.env.API_BASE_URL_TEST
                    ? `${process.env.API_BASE_URL_TEST}/api/send-email`
                    : 'http://localhost:3001/api/send-email';
            }
            return 'https://fluidpowergroup.com.au/api/send-email';
        })();

        const isLocalMode = callbackUrl.includes('localhost') || callbackUrl.includes('127.0.0.1');

        let invoiceBlobUrl = null;

        try {
            console.log('📄 Generating invoice PDF for order...');

            // PayPal's actual captured amount (authoritative total)
            const paypalCapturedAmount = parseFloat(
                captureData.purchase_units?.[0]?.payments?.captures?.[0]?.amount?.value ?? '0'
            );

            const today = new Date().toISOString().split('T')[0];

            // Build line items from all order types
            const invoiceLineItems = [
                // Website products
                ...websiteProducts.map(item => ({
                    id: item.id,
                    name: item.name,
                    quantity: item.quantity,
                    unitPrice: item.price,
                    subtotal: item.price * item.quantity,
                })),
                // HOSE360 orders
                ...pwaOrders.map(item => ({
                    id: item.id || 'hose360',
                    name: item.name || 'HOSE360 Custom Order',
                    quantity: 1,
                    unitPrice: item.totalPrice,
                    subtotal: item.totalPrice,
                })),
                // TRAC360 orders
                ...trac360Orders.map(item => ({
                    id: item.id || 'trac360',
                    name: item.name || 'TRAC360 Custom Order',
                    quantity: 1,
                    unitPrice: item.totalPrice,
                    subtotal: item.totalPrice,
                })),
                // FUNCTION360 orders
                ...function360Orders.map(item => ({
                    id: item.id || 'function360',
                    name: item.name || 'FUNCTION360 Custom Order',
                    quantity: 1,
                    unitPrice: item.totalPrice,
                    subtotal: item.totalPrice,
                })),
            ];

            const invoiceData = {
                invoiceNumber: `INV-${orderNumber}`,
                invoiceDate: today,
                dueDate: today,
                poNumber: 'N/A',
                paymentTerms: 'Paid',
                discount: 0,
                discountAmount: 0,
                notes: '',
                customer: {
                    name: `${userDetails.firstName} ${userDetails.lastName}`.trim(),
                    company: userDetails.companyName || '',
                    email: userDetails.email,
                    phone: userDetails.phone || '',
                    address: userDetails.address || '',
                    suburb: userDetails.city || '',
                    state: userDetails.state || '',
                    postcode: userDetails.postcode || '',
                },
                shippingAddress: null,
                items: invoiceLineItems,
                subtotal: totals.subtotal || 0,
                shippingCharge: totals.shipping || 0,
                gst: totals.gst || 0,
                total: paypalCapturedAmount,
            };

            const invoicePDF = generateInvoicePDF(invoiceData, captureId);
            const invoicePDFBase64 = invoicePDF.output('datauristring');
            const base64Data = invoicePDFBase64.split(',')[1];
            const invoiceBuffer = Buffer.from(base64Data, 'base64');

            if (!isLocalMode) {
                const invoiceBlob = await put(
                    `invoices/INV-${orderNumber}.pdf`,
                    invoiceBuffer,
                    { access: 'public', contentType: 'application/pdf' }
                );
                invoiceBlobUrl = { url: invoiceBlob.url, filename: `INV-${orderNumber}.pdf`, type: 'invoice' };
                console.log(`✅ Invoice PDF uploaded: ${invoiceBlob.url}`);
            } else {
                console.log('📎 LOCAL MODE: Skipping invoice PDF Blob upload');
            }

        } catch (invoiceError) {
            // Non-fatal: log but don't block order — invoice simply won't attach
            console.error('⚠️ Invoice PDF generation failed (order still processed):', invoiceError);
        }

        // ============================================================================
        // STEP 6: Upload PDFs to Vercel Blob (handles both PWA and Trac 360)
        // ============================================================================
        
        let blobUrls = [];
        
        // Prepend invoice blob if generated
        if (invoiceBlobUrl) {
            blobUrls.push(invoiceBlobUrl);
        }
        
        // NEW: Combine both order types for PDF upload
        const allOrdersWithPDFs = [
            ...pwaOrders,
            ...trac360Orders,
            ...function360Orders
        ].filter(order => order.pdfDataUrl);

        console.log('🔍 Orders before Blob upload:', allOrdersWithPDFs.map(o => ({
            type: o.type,
            cartId: o.cartId,
            hasType: !!o.type
        })));

        // callbackUrl and isLocalMode declared in STEP 5.5 above
        
        if (allOrdersWithPDFs.length > 0) {
            if (isLocalMode) {
                // Local mode: Skip Blob upload, PDFs will be attached directly
                console.log(`📎 LOCAL MODE: Skipping Blob upload for ${allOrdersWithPDFs.length} PDF(s)`);
                console.log(`📎 PDFs will be attached directly to emails from base64 data`);
            } else {
                // Production mode: Upload to Vercel Blob
                console.log(`📤 Uploading ${allOrdersWithPDFs.length} PDF(s) to Vercel Blob...`);
                const uploadedBlobs = await uploadPDFsToBlob(allOrdersWithPDFs, orderNumber);
                blobUrls = [...blobUrls, ...uploadedBlobs];
                console.log(`✅ Uploaded ${uploadedBlobs.length} PDF(s) to Blob, total blobs: ${blobUrls.length}`);
            }
        }

        // ============================================================================
        // STEP 7: Push to QStash for background email processing
        // ============================================================================
        
        console.log(`📧 Preparing order ${orderNumber} for QStash...`);
        
        // Generate email templates (updated to include trac360Orders)
        console.log('📧 Generating email templates...');
        const emailTemplates = generateEmailTemplates(
            orderNumber,
            userDetails,
            websiteProducts,
            pwaOrders,
            trac360Orders,
            function360Orders,
            totals,
            captureId,
            TESTING_MODE
        );
        
        console.log('✅ Email templates generated:', {
            hasCustomerEmail: !!emailTemplates.customerEmailContent,
            hasBusinessEmail: !!emailTemplates.businessEmailContent,
            customerLength: emailTemplates.customerEmailContent?.length || 0,
            businessLength: emailTemplates.businessEmailContent?.length || 0
        });

        const sanitizedPwaOrders = isLocalMode 
            ? pwaOrders  // Keep PDFs in local mode
            : pwaOrders.map(({ pdfDataUrl, ...rest }) => rest);  // Strip in production

        const sanitizedTrac360Orders = isLocalMode 
            ? trac360Orders  // Keep PDFs in local mode
            : trac360Orders.map(({ pdfDataUrl, ...rest }) => rest);  // Strip in production

        const sanitizedFunction360Orders = isLocalMode 
            ? function360Orders  // Keep PDFs in local mode
            : function360Orders.map(({ pdfDataUrl, ...rest }) => rest);  // Strip in production

        console.log(`📎 PDF sanitization - Local mode: ${isLocalMode}, PDFs ${isLocalMode ? 'KEPT' : 'STRIPPED'}`);
        
        // NEW: Prepare email data with Trac 360 orders
        const emailData = {
            orderNumber,
            paypalCaptureID: captureId,
            userDetails,
            websiteProducts,
            pwaOrders: sanitizedPwaOrders,
            trac360Orders: sanitizedTrac360Orders,
            function360Orders: sanitizedFunction360Orders,
            blobUrls,
            totals,
            testingMode: TESTING_MODE,
            emailTemplates: emailTemplates
        };

        const payloadSize = JSON.stringify(emailData).length;
        const sizeMB = (payloadSize / 1024 / 1024).toFixed(2);
        console.log(`📊 Email payload size: ${sizeMB}MB (with Blob URLs)`);
        
        console.log(`🔍 QStash will call: ${callbackUrl}`);
        console.log(`📍 Deployment: ${process.env.VERCEL_URL || 'local/custom'}`);

        // ============================================================================
        // 🆕 LOCAL MODE: Bypass QStash and send emails directly
        // ============================================================================

        if (isLocalMode) {
            console.log('📧 LOCAL MODE: Bypassing QStash, calling send-email directly...');
            
            try {
                // Call our own email API directly
                const emailResponse = await fetch(callbackUrl, {
                    method: 'POST',
                    headers: { 
                        'Content-Type': 'application/json',
                        'x-server-key': process.env.VALID_SERVER_KEY  // ADD THIS LINE
                    },
                    body: JSON.stringify(emailData)  // Use emailData, not emailPayload
                });
                
                if (emailResponse.ok) {
                    const emailResult = await emailResponse.json();
                    console.log('✅ Emails sent successfully in local mode:', emailResult);
                    
                    // Update order status
                    updateOrderStatus(orderNumber, { 
                        emailsSent: true,
                        sentDirectly: true,
                        sentAt: new Date().toISOString()
                    });
                } else {
                    const errorText = await emailResponse.text();
                    console.error('❌ Email sending failed:', errorText);
                    
                    updateOrderStatus(orderNumber, { 
                        emailsSent: false,
                        emailError: errorText
                    });
                }
            } catch (emailError) {
                console.error('❌ Error calling email API:', emailError);
                updateOrderStatus(orderNumber, { 
                    emailsSent: false,
                    emailError: emailError.message
                });
            }
            
            // Mark order as completed
            console.log(`✅ Order ${orderNumber} processed successfully (local mode)`);
            setOrderStatus(orderNumber, 'processing', {
                paymentCaptured: true,
                inventoryUpdated: inventoryResult.success,
                emailsSent: true,
                completedAt: new Date().toISOString()
            });
            
            return res.status(200).json({
                success: true,
                message: 'Payment captured and emails sent directly (local mode).',
                paypalOrderStatus: captureData.status,
                paypalCaptureStatus: finalCaptureStatus,
                paypalCaptureID: captureId,
                orderNumber: orderNumber,
                emailsSent: true,
                localMode: true
            });
            
        } else {
            // Production mode - use QStash as normal
            console.log('🚀 PRODUCTION MODE: Using QStash...');
            
            const qstashResult = await pushToQStash(emailData, callbackUrl);

            if (qstashResult.success) {
                console.log(`✅ Order ${orderNumber} email processing initiated`);
                updateOrderStatus(orderNumber, { 
                    emailsQueued: true,
                    qstashMessageId: qstashResult.messageId,
                    blobUrls: blobUrls.length > 0 ? blobUrls.map(b => b.url) : [],
                    queuedAt: new Date().toISOString()
                });
            } else {
                console.error(`❌ Failed to process order ${orderNumber} emails:`, qstashResult.error);
                updateOrderStatus(orderNumber, { 
                    emailsQueued: false,
                    qstashError: qstashResult.error
                });
            }
            
            // Mark as completed
            console.log(`✅ Order ${orderNumber} processed successfully`);
            setOrderStatus(orderNumber, 'processing', {
                paymentCaptured: true,
                inventoryUpdated: inventoryResult.success,
                emailsQueued: qstashResult.success,
                completedAt: new Date().toISOString()
            });

            console.log(`✅ Returning success response for ${orderNumber}`);
            return res.status(200).json({
                success: true,
                message: 'Payment captured and order queued for email processing via QStash.',
                paypalOrderStatus: captureData.status,
                paypalCaptureStatus: finalCaptureStatus,
                paypalCaptureID: captureId,
                orderNumber: orderNumber,
                emailsQueued: qstashResult.success
            });
        }

    } catch (error) {
        console.error(`❌ Unhandled error for order ${orderID}:`, error);
        
        if (orderNumber) {
            setOrderStatus(orderNumber, 'failed', {
                error: error.message,
                failedAt: new Date().toISOString()
            });
        }
        
        return res.status(500).json({ 
            success: false, 
            error: error.message || 'Internal server error' 
        });
    }
}

export const config = {
    api: {
        bodyParser: {
            sizeLimit: '10mb',
        },
    },
};