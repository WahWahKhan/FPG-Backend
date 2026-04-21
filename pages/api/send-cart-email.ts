// pages/api/send-cart-email.ts

import type { NextApiRequest, NextApiResponse } from 'next';
import { IItemCart } from '../../types/cart';
import { separateCartItems } from '../../utils/cart-helpers';
import { put } from '@vercel/blob';

const { pushToQStash, generateCartEmailTemplates } = require('../../lib/qstash-helper');

// âœ… ADD CORS CONFIGURATION (same as send-email.js)
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

// Simple in-memory rate limiting (Phase 1)
const requestTracker = new Map<string, number[]>();
const RATE_LIMIT = 5;
const RATE_WINDOW = 3600000;

const checkRateLimit = (identifier: string): boolean => {
  const now = Date.now();
  const requests = requestTracker.get(identifier) || [];
  
  const recentRequests = requests.filter(time => now - time < RATE_WINDOW);
  
  if (recentRequests.length >= RATE_LIMIT) {
    return false;
  }
  
  recentRequests.push(now);
  requestTracker.set(identifier, recentRequests);
  return true;
};

// Upload PDFs to Vercel Blob
async function uploadPDFsToBlob(ordersWithPDFs: any[], cartNumber: string) {
  const blobUrls = [];
  
  console.log('Ã°Å¸â€œÂ¦ uploadPDFsToBlob for cart:', cartNumber);
  
  for (let i = 0; i < ordersWithPDFs.length; i++) {
    const order = ordersWithPDFs[i];
    
    if (!order.pdfDataUrl) continue;
    
    try {
      const base64Data = order.pdfDataUrl.split(',')[1];
      const buffer = Buffer.from(base64Data, 'base64');
      
      const orderType = order.type === 'trac360_order' ? 'tractor' : 
                        order.type === 'pwa_order' ? 'assembly' : 
                        order.type === 'function360_order' ? 'function' : 'unknown';
      const filename = `cart-requests/${cartNumber}/${orderType}-${order.cartId || i}.pdf`;
      
      console.log(`Ã°Å¸â€œÂ¤ Uploading PDF to Blob: ${filename} (${(buffer.length / 1024).toFixed(2)}KB)`);
      
      const blob = await put(filename, buffer, {
        access: 'public',
        addRandomSuffix: true,
        contentType: 'application/pdf',
      });
      
      console.log(`âœ… PDF uploaded: ${blob.url}`);
      
      const pdfName = order.type === 'trac360_order' 
        ? `TRAC360-${order.cartId || 'order'}.pdf`
        : order.type === 'pwa_order'
        ? `HOSE360-${order.cartId || 'order'}.pdf`
        : order.type === 'function360_order'
        ? `FUNCTION360-${order.cartId || 'order'}.pdf`
        : `Cart-${order.cartId || 'order'}.pdf`;
      
      blobUrls.push({
        url: blob.url,
        name: pdfName,
        cartId: order.cartId,
        type: order.type
      });
      
    } catch (error) {
      console.error(`âŒ Failed to upload PDF for cart item ${order.cartId}:`, error);
    }
  }
  
  return blobUrls;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const origin = req.headers.origin;

  // âœ… ADD CORS HANDLING (same pattern as send-email.js)
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
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Credentials', 'true');

  // âœ… Handle OPTIONS preflight request
  if (req.method === 'OPTIONS') {
    if (!isOriginAllowed && origin) {
      console.warn(`CORS preflight denied for origin: ${origin}`);
      return res.status(403).json({ error: 'Forbidden' });
    }
    console.log(`CORS preflight OK for origin: ${origin}`);
    return res.status(204).end();
  }

  // âœ… Only allow POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // ============================================================================
    // DETECT REQUEST TYPE: CART or INVOICE
    // ============================================================================
    const requestType = req.body.type || 'cart'; // Default to 'cart' for backwards compatibility
    
    console.log(`ðŸ“¬ Processing ${requestType} email request...`);
    
    // ============================================================================
    // INVOICE EMAIL FLOW
    // ============================================================================
    if (requestType === 'invoice') {
      const { invoiceData, pdfData, customerEmail, customOrderPdfs } = req.body;
      
      if (!invoiceData || !pdfData || !customerEmail) {
        return res.status(400).json({ error: 'Invoice data, PDF, and customer email are required' });
      }
      
      // Rate limiting
      const rateLimitKey = customerEmail.toLowerCase();
      if (!checkRateLimit(rateLimitKey)) {
        return res.status(429).json({ error: 'Too many requests. Please try again later.' });
      }
      
      console.log('ðŸ“„ Processing invoice email...');
      console.log(`ðŸ“§ Customer: ${customerEmail}`);
      console.log(`ðŸ§¾ Invoice: ${invoiceData.invoiceNumber}`);
      
      if (customOrderPdfs && customOrderPdfs.length > 0) {
        console.log(`ðŸ“Ž Including ${customOrderPdfs.length} custom order PDF(s)`);
      }
      
      const isLocalMode = process.env.API_BASE_URL?.includes('localhost') || false;
      let blobUrls = [];
      
      // Upload invoice PDF to Blob
      const base64Data = pdfData.split(',')[1];
      const buffer = Buffer.from(base64Data, 'base64');
      const filename = `invoices/${invoiceData.invoiceNumber}/${invoiceData.invoiceNumber}.pdf`;
      
      if (!isLocalMode) {
        console.log(`ðŸ“¤ Uploading invoice PDF to Blob: ${filename} (${(buffer.length / 1024).toFixed(2)}KB)`);
        
        const blob = await put(filename, buffer, {
          access: 'public',
          addRandomSuffix: true,
          contentType: 'application/pdf',
        });
        
        console.log(`âœ… Invoice PDF uploaded: ${blob.url}`);
        
        blobUrls.push({
          url: blob.url,
          name: `${invoiceData.invoiceNumber}.pdf`,
          type: 'invoice'
        });
        
        // ============================================================================
        // UPLOAD CUSTOM ORDER PDFs TO BLOB
        // ============================================================================
        if (customOrderPdfs && customOrderPdfs.length > 0) {
          console.log(`ðŸ“¤ Uploading ${customOrderPdfs.length} custom order PDF(s)...`);
          
          for (const orderPdf of customOrderPdfs) {
            try {
              const orderBase64Data = orderPdf.pdfDataUrl.split(',')[1];
              const orderBuffer = Buffer.from(orderBase64Data, 'base64');
              const orderFilename = `invoices/${invoiceData.invoiceNumber}/${orderPdf.name}`;
              
              console.log(`ðŸ“¤ Uploading ${orderPdf.name} (${(orderBuffer.length / 1024).toFixed(2)}KB)`);
              
              const orderBlob = await put(orderFilename, orderBuffer, {
                access: 'public',
                addRandomSuffix: true,
                contentType: 'application/pdf',
              });
              
              console.log(`âœ… Custom order PDF uploaded: ${orderBlob.url}`);
              
              blobUrls.push({
                url: orderBlob.url,
                name: orderPdf.name,
                type: orderPdf.type
              });
            } catch (error) {
              console.error(`âŒ Failed to upload ${orderPdf.name}:`, error);
              // Continue with other PDFs
            }
          }
          
          console.log(`âœ… Uploaded ${blobUrls.length - 1} custom order PDF(s)`);
        }
      } else {
        console.log('ðŸ  LOCAL MODE: Skipping Blob upload, will use base64 PDFs');
      }
      
      // Generate invoice email templates
      const { generateInvoiceEmailTemplates } = require('../../lib/qstash-helper');
      const customOrderPdfsCount = customOrderPdfs && customOrderPdfs.length > 0 ? customOrderPdfs.length : 0;
      const emailTemplates = generateInvoiceEmailTemplates(invoiceData, customOrderPdfsCount);
      
      // Determine callback URL
      const callbackUrl = (() => {
        if (process.env.VERCEL_URL) {
          return `https://${process.env.VERCEL_URL}/api/send-email`;
        }
        if (process.env.API_BASE_URL) {
          return `${process.env.API_BASE_URL}/api/send-email`;
        }
        const TESTING_MODE = process.env.TESTING_MODE === 'true';
        if (TESTING_MODE) {
          return process.env.API_BASE_URL_TEST 
            ? `${process.env.API_BASE_URL_TEST}/api/send-email`
            : 'http://localhost:3001/api/send-email';
        }
        return 'https://fluidpowergroup.com.au/api/send-email';
      })();
      
      // Prepare email data
      const emailData = {
        orderNumber: invoiceData.invoiceNumber,
        userDetails: {
          firstName: invoiceData.customer.name.split(' ')[0],
          lastName: invoiceData.customer.name.split(' ').slice(1).join(' ') || '',
          email: customerEmail,
          phone: invoiceData.customer.phone,
          address: invoiceData.customer.address,
          city: invoiceData.customer.suburb,
          state: invoiceData.customer.state,
          postcode: invoiceData.customer.postcode,
          country: 'Australia',
          companyName: invoiceData.customer.company
        },
        blobUrls: isLocalMode ? [] : blobUrls,
        pdfAttachments: isLocalMode ? [
          {
            name: `${invoiceData.invoiceNumber}.pdf`,
            contentBytes: base64Data
          },
          // Add custom order PDFs for local mode
          ...(customOrderPdfs && customOrderPdfs.length > 0 
            ? customOrderPdfs.map((orderPdf: any) => ({
                name: orderPdf.name,
                contentBytes: orderPdf.pdfDataUrl.split(',')[1]
              }))
            : []
          )
        ] : undefined,
        totals: {
          subtotal: invoiceData.subtotal,
          gst: invoiceData.gst,
          total: invoiceData.total,
          discount: invoiceData.discountAmount,
          shipping: 0
        },
        testingMode: process.env.TESTING_MODE === 'true',
        emailTemplates: emailTemplates,
        userEmail: customerEmail
      };
      
      // Send via QStash or direct
      if (isLocalMode) {
        console.log('ðŸ  LOCAL MODE: Calling send-email directly...');
        
        const emailResponse = await fetch(callbackUrl, {
          method: 'POST',
          headers: { 
            'Content-Type': 'application/json',
            'x-server-key': process.env.VALID_SERVER_KEY || ''
          },
          body: JSON.stringify(emailData)
        });
        
        if (emailResponse.ok) {
          console.log('✅ Invoice email sent successfully (local mode)');
          return res.status(200).json({
            success: true,
            invoiceNumber: invoiceData.invoiceNumber,
            emailsSent: true,
            localMode: true
          });
        } else {
          const errorText = await emailResponse.text();
          console.error('âŒ Email sending failed:', errorText);
          throw new Error('Failed to send invoice email');
        }
      } else {
        console.log('ðŸš€ PRODUCTION MODE: Using QStash...');
        const qstashResult = await pushToQStash(emailData, callbackUrl);
        
        if (qstashResult.success) {
          console.log(`✅ Invoice email queued: ${invoiceData.invoiceNumber}`);
          return res.status(200).json({
            success: true,
            invoiceNumber: invoiceData.invoiceNumber,
            emailsQueued: true
          });
        } else {
          console.error(`âŒ Failed to queue invoice email:`, qstashResult.error);
          throw new Error('Failed to queue invoice email');
        }
      }
    }
    
    // ============================================================================
    // CART EMAIL FLOW (Original Logic)
    // ============================================================================
    const { items, userDetails, sendCopyToCustomer, message } = req.body as {
      items: IItemCart[];
      userDetails: {
        name: string;
        email: string;
        phone: string;
        address: string;
        suburb: string;
        state: string;
        postcode: string;
        companyName?: string;
      };
      sendCopyToCustomer: boolean;
      message?: string;
    };

    // Validate required fields
    if (!items || items.length === 0) {
      return res.status(400).json({ error: 'Cart is empty' });
    }

    if (!userDetails || !userDetails.email || !userDetails.name) {
      return res.status(400).json({ error: 'User details are required' });
    }

    // Rate limiting
    const rateLimitKey = userDetails.email.toLowerCase();
    if (!checkRateLimit(rateLimitKey)) {
      return res.status(429).json({ error: 'Too many requests. Please try again later.' });
    }

    console.log('Ã°Å¸â€œÂ§ Processing cart email request...');
    console.log(`Ã°Å¸â€œÂ¦ Cart items: ${items.length}`);
    console.log(`Ã°Å¸â€˜Â¤ Customer: ${userDetails.email}`);
    console.log(`ðŸ“‹ Send copy to customer: ${sendCopyToCustomer}`);
    console.log(`Ã°Å¸â€™Â¬ Message: ${message ? 'Yes' : 'No'}`);

    // Generate cart number
    const cartNumber = `CART-${Date.now()}`;

    // Separate cart items by type
    const { pwaItems, websiteItems, trac360Items, function360Items } = separateCartItems(items);

    console.log('Ã°Å¸â€œÅ  Cart Composition:');
    console.log(`   Website products: ${websiteItems.length}`);
    console.log(`   PWA orders: ${pwaItems.length}`);
    console.log(`   Trac 360 orders: ${trac360Items.length}`);
    console.log(`   Function 360 orders: ${function360Items.length}`);

    // Calculate totals
    const subtotal = items.reduce((sum, item) => {
      if (item.type === 'pwa_order' || item.type === 'trac360_order' || item.type === 'function360_order') {
        return sum + (item.totalPrice || 0);
      }
      return sum + ((item.price || 0) * item.quantity);
    }, 0);

    const shipping = 0;
    const gst = subtotal * 0.1;
    const total = subtotal + gst;

    const totals = { subtotal, shipping, gst, total, discount: 0 };

    // Upload PDFs to Vercel Blob
    let blobUrls: any[] = [];
    
    const allOrdersWithPDFs = [
      ...pwaItems,
      ...trac360Items,
      ...function360Items
    ].filter(order => order.pdfDataUrl);

    // Determine callback URL
    const callbackUrl = (() => {
      if (process.env.VERCEL_URL) {
        return `https://${process.env.VERCEL_URL}/api/send-email`;
      }
      
      if (process.env.API_BASE_URL) {
        return `${process.env.API_BASE_URL}/api/send-email`;
      }
      
      const TESTING_MODE = process.env.TESTING_MODE === 'true';
      if (TESTING_MODE) {
        return process.env.API_BASE_URL_TEST 
          ? `${process.env.API_BASE_URL_TEST}/api/send-email`
          : 'http://localhost:3001/api/send-email';
      }
      
      return 'https://fluidpowergroup.com.au/api/send-email';
    })();

    const isLocalMode = callbackUrl.includes('localhost') || callbackUrl.includes('127.0.0.1');

    if (allOrdersWithPDFs.length > 0) {
      if (isLocalMode) {
        console.log(`ðŸ“Ž LOCAL MODE: Skipping Blob upload for ${allOrdersWithPDFs.length} PDF(s)`);
      } else {
        console.log(`Ã°Å¸â€œÂ¤ Uploading ${allOrdersWithPDFs.length} PDF(s) to Vercel Blob...`);
        blobUrls = await uploadPDFsToBlob(allOrdersWithPDFs, cartNumber);
        console.log(`âœ… Uploaded ${blobUrls.length} PDF(s) to Blob`);
      }
    }

    // Generate email templates
    console.log('Ã°Å¸â€œÂ§ Generating cart email templates...');
    const emailTemplates = generateCartEmailTemplates(
      cartNumber,
      userDetails,
      websiteItems,
      pwaItems,
      trac360Items,
      function360Items,
      totals,
      message || '',
      sendCopyToCustomer
    );

    console.log('âœ… Email templates generated');

    // Prepare email data
    const sanitizedPwaOrders = isLocalMode 
      ? pwaItems 
      : pwaItems.map(({ pdfDataUrl, ...rest }) => rest);

    const sanitizedTrac360Orders = isLocalMode 
      ? trac360Items 
      : trac360Items.map(({ pdfDataUrl, ...rest }) => rest);

    const sanitizedFunction360Orders = isLocalMode 
      ? function360Items 
      : function360Items.map(({ pdfDataUrl, ...rest }) => rest);

    const emailData = {
      orderNumber: cartNumber,
      userDetails,
      websiteProducts: websiteItems,
      pwaOrders: sanitizedPwaOrders,
      trac360Orders: sanitizedTrac360Orders,
      function360Orders: sanitizedFunction360Orders,
      blobUrls,
      totals,
      testingMode: process.env.TESTING_MODE === 'true',
      emailTemplates: emailTemplates,
      userEmail: userDetails.email
    };

    // Send via QStash or direct
    if (isLocalMode) {
      console.log('Ã°Å¸â€œÂ§ LOCAL MODE: Calling send-email directly...');
      
      try {
        const emailResponse = await fetch(callbackUrl, {
          method: 'POST',
          headers: { 
            'Content-Type': 'application/json',
            'x-server-key': process.env.VALID_SERVER_KEY || ''
          },
          body: JSON.stringify(emailData)
        });
        
        if (emailResponse.ok) {
          console.log('âœ… Cart email sent successfully (local mode)');
          
          return res.status(200).json({
            success: true,
            cartNumber,
            emailsSent: true,
            localMode: true
          });
        } else {
          const errorText = await emailResponse.text();
          console.error('âŒ Email sending failed:', errorText);
          throw new Error('Failed to send cart email');
        }
      } catch (emailError: any) {
        console.error('âŒ Error calling email API:', emailError);
        throw emailError;
      }
      
    } else {
      console.log('Ã°Å¸Å¡â‚¬ PRODUCTION MODE: Using QStash...');
      
      const qstashResult = await pushToQStash(emailData, callbackUrl);

      if (qstashResult.success) {
        console.log(`âœ… Cart email queued: ${cartNumber}`);
        
        return res.status(200).json({
          success: true,
          cartNumber,
          emailsQueued: true
        });
      } else {
        console.error(`âŒ Failed to queue cart email:`, qstashResult.error);
        throw new Error('Failed to queue cart email');
      }
    }

  } catch (error: any) {
    console.error('âŒ Cart email error:', error);
    return res.status(500).json({ 
      error: 'Failed to send cart email',
      details: error.message 
    });
  }
}