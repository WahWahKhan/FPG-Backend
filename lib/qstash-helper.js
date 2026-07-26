// lib/qstash-helper.js
// QStash integration for background email processing

const QSTASH_TOKEN = process.env.QSTASH_TOKEN;

/**
 * Push order to QStash for background email processing
 * @param {Object} orderData - Complete order data
 * @param {string} callbackUrl - Your /api/send-email endpoint URL
 * @returns {Promise<Object>} QStash response
 */
export async function pushToQStash(orderData, callbackUrl) {
    if (!QSTASH_TOKEN) {
        throw new Error('QSTASH_TOKEN environment variable not set');
    }

    try {
        if (!callbackUrl.startsWith('http://') && !callbackUrl.startsWith('https://')) {
            callbackUrl = `https://${callbackUrl}`;
        }
        
        const response = await fetch(`https://qstash.upstash.io/v2/publish/${callbackUrl}`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${QSTASH_TOKEN}`,
                'Content-Type': 'application/json',
                'Upstash-Forward-x-server-key': process.env.VALID_SERVER_KEY,
                'Upstash-Retries': '3',
            },
            body: JSON.stringify(orderData)
        });

        if (!response.ok) {
            const error = await response.text();
            throw new Error(`QStash push failed: ${error}`);
        }

        const result = await response.json();
        console.log(`[OK] Order ${orderData.orderNumber} pushed to QStash. Message ID: ${result.messageId}`);
        
        return {
            success: true,
            messageId: result.messageId
        };

    } catch (error) {
        console.error('[WARN] Failed to push to QStash:', error);
        return {
            success: false,
            error: error.message
        };
    }
}

/**
 * Generate email templates for customer and business
 * NOW SUPPORTS: Website Products, PWA Orders, and Trac 360 Orders
 */
export function generateEmailTemplates(
    orderNumber,
    userDetails,
    websiteProducts,
    pwaOrders,
    trac360Orders = [],
    function360Orders = [],
    totals,
    paypalCaptureID,
    TESTING_MODE
) {
    const currentDate = new Date().toLocaleDateString('en-AU', { 
        year: 'numeric', 
        month: 'long', 
        day: 'numeric' 
    });

    const businessEmailDisplay = TESTING_MODE 
        ? process.env.BUSINESS_EMAIL_TEST || 'info@agcomponents.com.au'
        : process.env.BUSINESS_EMAIL;

    // ============================================================================
    // CUSTOMER EMAIL TEMPLATE
    // ============================================================================
    const customerEmailContent = `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Order Confirmation</title>
        </head>
        <body style="margin: 0; padding: 0; font-family: Arial, sans-serif; background-color: #f4f4f4;">
            <div style="max-width: 600px; margin: 20px auto; background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
                <div style="background-color: #e74c3c; padding: 30px 20px; text-align: center;">
                    <h1 style="color: #ffffff; margin: 0; font-size: 28px;">Thank You for Your Order!</h1>
                </div>
                <div style="padding: 30px 20px;">
                    <p style="font-size: 16px; color: #333333; margin-bottom: 20px;">
                        Hi ${userDetails.firstName} ${userDetails.lastName},
                    </p>
                    <p style="font-size: 16px; color: #333333; margin-bottom: 20px;">
                        We've received your order and will begin processing it right away. Here are your order details:
                    </p>
                    <div style="background-color: #f8f9fa; border-left: 4px solid #e74c3c; padding: 15px; margin: 20px 0;">
                        <p style="margin: 5px 0; color: #333333;"><strong>Order Number:</strong> #${orderNumber}</p>
                        <p style="margin: 5px 0; color: #333333;"><strong>Order Date:</strong> ${currentDate}</p>
                        <p style="margin: 5px 0; color: #333333;"><strong>PayPal Transaction ID:</strong> ${paypalCaptureID}</p>
                    </div>
                    
                    ${websiteProducts.length > 0 ? `
                    <h2 style="color: #e74c3c; font-size: 20px; margin-top: 30px; margin-bottom: 15px; border-bottom: 2px solid #e74c3c; padding-bottom: 10px;">
                        Website Products
                    </h2>
                    <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px;">
                        <thead>
                            <tr style="background-color: #f8f9fa;">
                                <th style="padding: 12px; text-align: left; border-bottom: 2px solid #dee2e6;">Product</th>
                                <th style="padding: 12px; text-align: center; border-bottom: 2px solid #dee2e6;">Qty</th>
                                <th style="padding: 12px; text-align: right; border-bottom: 2px solid #dee2e6;">Price</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${websiteProducts.map(product => `
                                <tr>
                                    <td style="padding: 12px; border-bottom: 1px solid #dee2e6;">
                                        ${product.image ? `<img src="${product.image}" alt="${product.name}" style="width: 50px; height: 50px; object-fit: cover; margin-right: 10px; vertical-align: middle; border-radius: 4px;">` : ''}
                                        <span style="vertical-align: middle;"><strong>${product.name}<strong></span>
                                    </td>
                                    <td style="padding: 12px; text-align: center; border-bottom: 1px solid #dee2e6;">${product.quantity}</td>
                                    <td style="padding: 12px; text-align: right; border-bottom: 1px solid #dee2e6;">$${(product.price * product.quantity).toFixed(2)}</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                    ` : ''}
                    
                    ${pwaOrders.length > 0 ? `
                    <h2 style="color: #e74c3c; font-size: 20px; margin-top: 30px; margin-bottom: 15px; border-bottom: 2px solid #e74c3c; padding-bottom: 10px;">
                        Custom Hose Assemblies
                    </h2>
                    <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px;">
                        <thead>
                            <tr style="background-color: #f8f9fa;">
                                <th style="padding: 12px; text-align: left; border-bottom: 2px solid #dee2e6;">Assembly</th>
                                <th style="padding: 12px; text-align: center; border-bottom: 2px solid #dee2e6;">Qty</th>
                                <th style="padding: 12px; text-align: right; border-bottom: 2px solid #dee2e6;">Price</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${pwaOrders.map(order => `
                                <tr>
                                    <td style="padding: 12px; border-bottom: 1px solid #dee2e6;">
                                        <img src="${order.image || 'https://cdn.swell.store/fluidpowergroup/6959b1f1b8c9d700121d9651/b54c1b05d3da6917392f6c4a7b34ec33/Hose360.png'}" alt="${order.name}" style="width: 50px; height: 50px; object-fit: contain; margin-right: 10px; vertical-align: middle; border-radius: 4px;">
                                        <span style="vertical-align: middle;"><strong>${order.name}</strong></span>
                                    </td>
                                    <td style="padding: 12px; text-align: center; border-bottom: 1px solid #dee2e6;">${order.quantity}</td>
                                    <td style="padding: 12px; text-align: right; border-bottom: 1px solid #dee2e6;">$${order.totalPrice.toFixed(2)}</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                    <p style="font-size: 14px; color: #666; margin-top: 10px;">
                        &#x1F4CE; Detailed specifications for your custom hose assemblies are attached to this email as PDF files.
                    </p>
                    ` : ''}
                    
                    ${trac360Orders && trac360Orders.length > 0 ? `
                    <h2 style="color: #e74c3c; font-size: 20px; margin-top: 30px; margin-bottom: 15px; border-bottom: 2px solid #e74c3c; padding-bottom: 10px;">
                        Custom Tractor Configurations
                    </h2>
                    <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px;">
                        <thead>
                            <tr style="background-color: #f8f9fa;">
                                <th style="padding: 12px; text-align: left; border-bottom: 2px solid #dee2e6;">Configuration</th>
                                <th style="padding: 12px; text-align: center; border-bottom: 2px solid #dee2e6;">Model</th>
                                <th style="padding: 12px; text-align: right; border-bottom: 2px solid #dee2e6;">Price</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${trac360Orders.map(order => `
                                <tr>
                                    <td style="padding: 12px; border-bottom: 1px solid #dee2e6;">
                                        <img src="https://cdn.swell.store/fluidpowergroup/6954d8e3e8ab550012cbca57/8b530e036be3f21dcda1add5c7e592db/Trac360_Cart.png" alt="${order.name}" style="width: 50px; height: 50px; object-fit: contain; margin-right: 10px; vertical-align: middle; border-radius: 4px;">
                                        <div style="display: inline-block; vertical-align: middle;">
                                            <strong style="display: block;">${order.name}</strong>
                                            <small style="color: #666; display: block; margin-top: 4px;">
                                                ${order.tractorConfig?.driveType || ''} &#x2022; ${order.tractorConfig?.cabinType || ''}
                                            </small>
                                        </div>
                                    </td>
                                    <td style="padding: 12px; text-align: center; border-bottom: 1px solid #dee2e6;">
                                        ${order.tractorConfig?.modelNumber || 'N/A'}
                                    </td>
                                    <td style="padding: 12px; text-align: right; border-bottom: 1px solid #dee2e6;">
                                        $${order.totalPrice.toFixed(2)}
                                    </td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                    <p style="font-size: 14px; color: #666; margin-top: 10px;">
                        &#x1F4CE; Detailed tractor configurations are attached to this email as PDF files.
                    </p>
                    ` : ''}

                    ${function360Orders && function360Orders.length > 0 ? `
                        <h2 style="color: #e74c3c; font-size: 20px; margin-top: 30px; margin-bottom: 15px; border-bottom: 2px solid #e74c3c; padding-bottom: 10px;">
                          Custom Hydraulic Function Kits
                        </h2>
                        <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px;">
                          <thead>
                            <tr style="background-color: #f8f9fa;">
                              <th style="padding: 12px; text-align: left; border-bottom: 2px solid #dee2e6;">Configuration</th>
                              <th style="padding: 12px; text-align: center; border-bottom: 2px solid #dee2e6;">Components</th>
                              <th style="padding: 12px; text-align: right; border-bottom: 2px solid #dee2e6;">Price</th>
                            </tr>
                          </thead>
                          <tbody>
                            ${function360Orders.map(order => `
                              <tr>
                                <td style="padding: 12px; border-bottom: 1px solid #dee2e6;">
                                  <img src="https://cdn.swell.store/fluidpowergroup/6957bb3c051b2b001230beb7/64c31c423d0e72f488e9f09c3bd687a2/Function360.png" alt="${order.name}" style="width: 50px; height: 50px; object-fit: contain; margin-right: 10px; vertical-align: middle; border-radius: 4px;">
                                  <div style="display: inline-block; vertical-align: middle;">
                                    <strong style="display: block;">${order.name}</strong>
                                    <small style="color: #666; display: block; margin-top: 4px;">
                                      ${order.configuration?.equipment?.functionType?.replace(/_/g, ' ')?.toUpperCase() || 'Custom Kit'}
                                    </small>
                                  </div>
                                </td>
                                <td style="padding: 12px; text-align: center; border-bottom: 1px solid #dee2e6;">
                                  ${Object.values(order.configuration?.selectedComponents || {}).filter(Boolean).length}
                                </td>
                                <td style="padding: 12px; text-align: right; border-bottom: 1px solid #dee2e6;">
                                  $${order.totalPrice.toFixed(2)}
                                </td>
                              </tr>
                            `).join('')}
                          </tbody>
                        </table>
                        <p style="font-size: 14px; color: #666; margin-top: 10px;">
                          &#x1F4CE; Detailed hydraulic kit configurations are attached to this email as PDF files.
                        </p>
                        ` : ''}
                    
                    <div style="background-color: #f8f9fa; padding: 20px; border-radius: 8px; margin-top: 30px;">
                        <table style="width: 100%; border-collapse: collapse;">
                            <tr>
                                <td style="padding: 8px 0; color: #333333;">Subtotal:</td>
                                <td style="padding: 8px 0; text-align: right; color: #333333;">$${totals.subtotal.toFixed(2)}</td>
                            </tr>
                            ${totals.discount > 0 ? `
                            <tr>
                                <td style="padding: 8px 0; color: #28a745;">Discount:</td>
                                <td style="padding: 8px 0; text-align: right; color: #28a745;">-$${totals.discount.toFixed(2)}</td>
                            </tr>
                            ` : ''}
                            ${totals.shipping > 0 ? `
                            <tr>
                                <td style="padding: 8px 0; color: #333333;">Shipping:</td>
                                <td style="padding: 8px 0; text-align: right; color: #333333;">$${totals.shipping.toFixed(2)}</td>
                            </tr>
                            ` : ''}
                            <tr>
                                <td style="padding: 8px 0; color: #333333;">GST (10%):</td>
                                <td style="padding: 8px 0; text-align: right; color: #333333;">$${totals.gst.toFixed(2)}</td>
                            </tr>
                            <tr style="border-top: 2px solid #dee2e6;">
                                <td style="padding: 12px 0; font-size: 18px; font-weight: bold; color: #e74c3c;">Total:</td>
                                <td style="padding: 12px 0; text-align: right; font-size: 18px; font-weight: bold; color: #e74c3c;">$${totals.total.toFixed(2)}</td>
                            </tr>
                        </table>
                    </div>
                    
                    <div style="margin-top: 30px;">
                        <h3 style="color: #e74c3c; font-size: 18px; margin-bottom: 10px;">Shipping Address</h3>
                        <div style="background-color: #f8f9fa; padding: 15px; border-radius: 8px;">
                            <p style="margin: 5px 0; color: #333333;">${userDetails.firstName} ${userDetails.lastName}</p>
                            ${userDetails.companyName ? `<p style="margin: 5px 0; color: #333333;">${userDetails.companyName}</p>` : ''}
                            <p style="margin: 5px 0; color: #333333;">${userDetails.address}</p>
                            <p style="margin: 5px 0; color: #333333;">${userDetails.city}, ${userDetails.state} ${userDetails.postcode}</p>
                            <p style="margin: 5px 0; color: #333333;">${userDetails.country}</p>
                        </div>
                    </div>
                    
                    <div style="margin-top: 30px; padding: 20px; background-color: #e8f4f8; border-radius: 8px;">
                        <h3 style="color: #e74c3c; font-size: 18px; margin-top: 0;">What's Next?</h3>
                        <ul style="color: #333333; line-height: 1.8; margin: 10px 0; padding-left: 20px;">
                            <li>We'll prepare your order for shipment</li>
                            <li>You'll receive a tracking number once shipped</li>
                            <li>Contact us if you have any questions</li>
                        </ul>
                    </div>
                    
                    <div style="margin-top: 30px; text-align: center; color: #666666; font-size: 14px;">
                        <p>Questions about your order?</p>
                        <p style="color: #e74c3c; font-weight: bold;">${businessEmailDisplay}</p>
                    </div>
                </div>
                <div style="background-color: #333333; color: #ffffff; padding: 20px; text-align: center; font-size: 12px;">
                    <p style="margin: 0;">&copy; ${new Date().getFullYear()} FluidPower Group. All rights reserved.</p>
                    ${TESTING_MODE ? '<p style="margin: 10px 0 0 0; color: #ffc107;">&#x26A0;&#xFE0F; TEST MODE - This is a test order</p>' : ''}
                </div>
            </div>
        </body>
        </html>
    `;

    // ============================================================================
    // BUSINESS EMAIL TEMPLATE
    // ============================================================================
    const businessEmailContent = `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>New Order Notification</title>
        </head>
        <body style="margin: 0; padding: 0; font-family: Arial, sans-serif; background-color: #f4f4f4;">
            <div style="max-width: 600px; margin: 20px auto; background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
                <div style="background-color: #2c3e50; padding: 30px 20px; text-align: center;">
                    <h1 style="color: #ffffff; margin: 0; font-size: 28px;">&#x1F514; New Order Received</h1>
                    ${TESTING_MODE ? '<p style="color: #ffc107; margin: 10px 0 0 0; font-size: 16px;">&#x26A0;&#xFE0F; TEST MODE</p>' : ''}
                </div>
                <div style="padding: 30px 20px;">
                    <div style="background-color: #e8f4f8; border-left: 4px solid #3498db; padding: 15px; margin: 20px 0;">
                        <p style="margin: 5px 0; color: #333333;"><strong>Order Number:</strong> #${orderNumber}</p>
                        <p style="margin: 5px 0; color: #333333;"><strong>Order Date:</strong> ${currentDate}</p>
                        <p style="margin: 5px 0; color: #333333;"><strong>PayPal Transaction ID:</strong> ${paypalCaptureID}</p>
                    </div>
                    
                    <h2 style="color: #2c3e50; font-size: 20px; margin-top: 30px; margin-bottom: 15px; border-bottom: 2px solid #3498db; padding-bottom: 10px;">
                        Customer Information
                    </h2>
                    <div style="background-color: #f8f9fa; padding: 15px; border-radius: 8px;">
                        <p style="margin: 5px 0; color: #333333;"><strong>Name:</strong> ${userDetails.firstName} ${userDetails.lastName}</p>
                        ${userDetails.companyName ? `<p style="margin: 5px 0; color: #333333;"><strong>Company:</strong> ${userDetails.companyName}</p>` : ''}
                        <p style="margin: 5px 0; color: #333333;"><strong>Email:</strong> ${userDetails.email}</p>
                        <p style="margin: 5px 0; color: #333333;"><strong>Phone:</strong> ${userDetails.phone}</p>
                        <p style="margin: 5px 0; color: #333333;"><strong>Address:</strong> ${userDetails.address}, ${userDetails.city}, ${userDetails.state} ${userDetails.postcode}, ${userDetails.country}</p>
                    </div>
                    
                    ${websiteProducts.length > 0 ? `
                    <h2 style="color: #2c3e50; font-size: 20px; margin-top: 30px; margin-bottom: 15px; border-bottom: 2px solid #3498db; padding-bottom: 10px;">
                        Website Products (${websiteProducts.length})
                    </h2>
                    <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px;">
                        <thead>
                            <tr style="background-color: #2c3e50; color: #ffffff;">
                                <th style="padding: 12px; text-align: left;">Product</th>
                                <th style="padding: 12px; text-align: center;">Qty</th>
                                <th style="padding: 12px; text-align: right;">Price</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${websiteProducts.map(product => `
                                <tr style="border-bottom: 1px solid #dee2e6;">
                                    <td style="padding: 12px;">
                                        ${product.image ? `<img src="${product.image}" alt="${product.name}" style="width: 50px; height: 50px; object-fit: cover; margin-right: 10px; vertical-align: middle; border-radius: 4px;">` : ''}
                                        <span style="vertical-align: middle;"><strong>${product.name}<strong></span>
                                    </td>
                                    <td style="padding: 12px; text-align: center;">${product.quantity}</td>
                                    <td style="padding: 12px; text-align: right;">$${(product.price * product.quantity).toFixed(2)}</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                    ` : ''}
                    
                    ${pwaOrders.length > 0 ? `
                    <h2 style="color: #2c3e50; font-size: 20px; margin-top: 30px; margin-bottom: 15px; border-bottom: 2px solid #3498db; padding-bottom: 10px;">
                        Custom Hose Assemblies (${pwaOrders.length})
                    </h2>
                    <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px;">
                        <thead>
                            <tr style="background-color: #2c3e50; color: #ffffff;">
                                <th style="padding: 12px; text-align: left;">Assembly Details</th>
                                <th style="padding: 12px; text-align: center;">Qty</th>
                                <th style="padding: 12px; text-align: right;">Price</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${pwaOrders.map(order => `
                                <tr style="border-bottom: 1px solid #dee2e6;">
                                    <td style="padding: 12px;">
                                        <img src="${order.image || 'https://cdn.swell.store/fluidpowergroup/6959b1f1b8c9d700121d9651/b54c1b05d3da6917392f6c4a7b34ec33/Hose360.png'}" alt="${order.name}" style="width: 50px; height: 50px; object-fit: contain; margin-right: 10px; vertical-align: middle; border-radius: 4px;">
                                        <div style="display: inline-block; vertical-align: middle;">
                                            <strong>${order.name}</strong><br>
                                            <small style="color: #666;">PWA Order ID: ${order.pwaOrderNumber || `PWA-${order.cartId}` || 'N/A'}</small>
                                        </div>
                                    </td>
                                    <td style="padding: 12px; text-align: center;">${order.quantity}</td>
                                    <td style="padding: 12px; text-align: right;">$${order.totalPrice.toFixed(2)}</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                    <div style="background-color: #fff3cd; border-left: 4px solid #ffc107; padding: 15px; margin: 15px 0;">
                        <p style="margin: 0; color: #856404;">
                            &#x1F4CE; <strong>Detailed specifications attached as PDF(s)</strong><br>
                            Review the attached PDF files for complete assembly specifications.
                        </p>
                    </div>
                    ` : ''}
                    
                    ${trac360Orders && trac360Orders.length > 0 ? `
                    <h2 style="color: #2c3e50; font-size: 20px; margin-top: 30px; margin-bottom: 15px; border-bottom: 2px solid #3498db; padding-bottom: 10px;">
                        Custom Tractor Configurations (${trac360Orders.length})
                    </h2>
                    <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px;">
                        <thead>
                            <tr style="background-color: #2c3e50; color: #ffffff;">
                                <th style="padding: 12px; text-align: left;">Configuration Details</th>
                                <th style="padding: 12px; text-align: center;">Model</th>
                                <th style="padding: 12px; text-align: right;">Price</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${trac360Orders.map(order => `
                                <tr style="border-bottom: 1px solid #dee2e6;">
                                    <td style="padding: 12px;">
                                        <img src="https://cdn.swell.store/fluidpowergroup/6954d8e3e8ab550012cbca57/8b530e036be3f21dcda1add5c7e592db/Trac360_Cart.png" alt="${order.name}" style="width: 50px; height: 50px; object-fit: contain; margin-right: 10px; vertical-align: middle; border-radius: 4px;">
                                        <div style="display: inline-block; vertical-align: middle;">
                                            <strong>${order.name}</strong><br>
                                            <small style="color: #666; display: block; margin-top: 4px;">
                                                ${order.tractorConfig?.tractorType || ''} &#x2022; 
                                                ${order.tractorConfig?.driveType || ''} &#x2022; 
                                                ${order.tractorConfig?.cabinType || ''}
                                            </small>
                                            ${order.tractorConfig?.selectedOptions && order.tractorConfig.selectedOptions.length > 0 ? `
                                                <small style="color: #666; display: block; margin-top: 4px;">
                                                    Options: ${order.tractorConfig.selectedOptions.join(', ')}
                                                </small>
                                            ` : ''}
                                        </div>
                                    </td>
                                    <td style="padding: 12px; text-align: center;">
                                        ${order.tractorConfig?.modelNumber || 'N/A'}
                                    </td>
                                    <td style="padding: 12px; text-align: right;">
                                        $${order.totalPrice.toFixed(2)}
                                    </td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                    <div style="background-color: #d4edda; border-left: 4px solid #28a745; padding: 15px; margin: 15px 0;">
                        <p style="margin: 0; color: #155724;">
                            &#x1F69C; <strong>Tractor configurations attached as PDF(s)</strong><br>
                            Review the attached PDF files for complete tractor specifications and selected options.
                        </p>
                    </div>
                    ` : ''}

                    ${function360Orders && function360Orders.length > 0 ? `
                        <h2 style="color: #2c3e50; font-size: 20px; margin-top: 30px; margin-bottom: 15px; border-bottom: 2px solid #3498db; padding-bottom: 10px;">
                          Custom Hydraulic Function Kits (${function360Orders.length})
                        </h2>
                        <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px;">
                          <thead>
                            <tr style="background-color: #2c3e50; color: #ffffff;">
                              <th style="padding: 12px; text-align: left;">Configuration Details</th>
                              <th style="padding: 12px; text-align: center;">Components</th>
                              <th style="padding: 12px; text-align: right;">Price</th>
                            </tr>
                          </thead>
                          <tbody>
                            ${function360Orders.map(order => `
                              <tr style="border-bottom: 1px solid #dee2e6;">
                                <td style="padding: 12px;">
                                  <img src="https://cdn.swell.store/fluidpowergroup/6957bb3c051b2b001230beb7/64c31c423d0e72f488e9f09c3bd687a2/Function360.png" alt="${order.name}" style="width: 50px; height: 50px; object-fit: contain; margin-right: 10px; vertical-align: middle; border-radius: 4px;">
                                  <div style="display: inline-block; vertical-align: middle;">
                                    <strong>${order.name}</strong><br>
                                    <small style="color: #666; display: block; margin-top: 4px;">
                                      Equipment: ${order.configuration?.equipment?.horsepower?.replace(/_/g, ' ')?.toUpperCase() || 'N/A'} &#x2022;
                                      ${order.configuration?.equipment?.functionType?.replace(/_/g, ' ')?.toUpperCase() || 'N/A'}
                                    </small>
                                    ${order.configuration?.selectedComponents ? `
                                      <small style="color: #666; display: block; margin-top: 4px;">
                                        Selected: ${Object.entries(order.configuration.selectedComponents)
                                          .filter(([_, selected]) => selected)
                                          .map(([key]) => key.replace(/([A-Z])/g, ' $1').trim())
                                          .join(', ')}
                                      </small>
                                    ` : ''}
                                  </div>
                                </td>
                                <td style="padding: 12px; text-align: center;">
                                  ${Object.values(order.configuration?.selectedComponents || {}).filter(Boolean).length}
                                </td>
                                <td style="padding: 12px; text-align: right;">
                                  $${order.totalPrice.toFixed(2)}
                                </td>
                              </tr>
                            `).join('')}
                          </tbody>
                        </table>
                        <div style="background-color: #d1ecf1; border-left: 4px solid #17a2b8; padding: 15px; margin: 15px 0;">
                          <p style="margin: 0; color: #0c5460;">
                            &#x1F527; <strong>Hydraulic function kit configurations attached as PDF(s)</strong><br>
                            Review the attached PDF files for complete component specifications and customer notes.
                          </p>
                        </div>
                        ` : ''}
                    
                    <div style="background-color: #f8f9fa; padding: 20px; border-radius: 8px; margin-top: 30px;">
                        <h3 style="color: #2c3e50; margin-top: 0;">Order Summary</h3>
                        <table style="width: 100%; border-collapse: collapse;">
                            <tr>
                                <td style="padding: 8px 0; color: #333333;">Subtotal:</td>
                                <td style="padding: 8px 0; text-align: right; color: #333333;">$${totals.subtotal.toFixed(2)}</td>
                            </tr>
                            ${totals.discount > 0 ? `
                            <tr>
                                <td style="padding: 8px 0; color: #28a745;">Discount:</td>
                                <td style="padding: 8px 0; text-align: right; color: #28a745;">-$${totals.discount.toFixed(2)}</td>
                            </tr>
                            ` : ''}
                            ${totals.shipping > 0 ? `
                            <tr>
                                <td style="padding: 8px 0; color: #333333;">Shipping:</td>
                                <td style="padding: 8px 0; text-align: right; color: #333333;">$${totals.shipping.toFixed(2)}</td>
                            </tr>
                            ` : ''}
                            <tr>
                                <td style="padding: 8px 0; color: #333333;">GST (10%):</td>
                                <td style="padding: 8px 0; text-align: right; color: #333333;">$${totals.gst.toFixed(2)}</td>
                            </tr>
                            <tr style="border-top: 2px solid #dee2e6;">
                                <td style="padding: 12px 0; font-size: 18px; font-weight: bold; color: #2c3e50;">Total:</td>
                                <td style="padding: 12px 0; text-align: right; font-size: 18px; font-weight: bold; color: #2c3e50;">$${totals.total.toFixed(2)}</td>
                            </tr>
                        </table>
                    </div>
                    
                    <div style="margin-top: 30px; padding: 20px; background-color: #d4edda; border-radius: 8px; border-left: 4px solid #28a745;">
                        <h3 style="color: #155724; margin-top: 0;">&#x1F4CB; Action Items</h3>
                        <ul style="margin: 10px 0; padding-left: 20px;">
                            ${websiteProducts.length > 0 ? '<li>Check inventory levels (already updated automatically)</li>' : ''}
                            ${pwaOrders.length > 0 ? '<li>Review custom hose assembly specifications in attached PDF(s)</li>' : ''}
                            ${trac360Orders && trac360Orders.length > 0 ? '<li>Review custom tractor configurations in attached PDF(s)</li>' : ''}
                            <li>Prepare items for shipping</li>
                            <li>Send tracking information to customer</li>
                        </ul>
                    </div>
                </div>
            </div>
        </body>
        </html>
    `;

    return {
        customerEmailContent,
        businessEmailContent
    };
}

/**
 * Generate email templates for CART ASSISTANCE REQUESTS
 * Similar to generateEmailTemplates but with different wording
 */
export function generateCartEmailTemplates(
    cartNumber,
    userDetails,
    websiteProducts,
    pwaOrders,
    trac360Orders = [],
    function360Orders = [],
    totals,
    customerMessage = '',
    sendCopyToCustomer = false
) {
    const currentDate = new Date().toLocaleDateString('en-AU', { 
        year: 'numeric', 
        month: 'long', 
        day: 'numeric' 
    });

    const TESTING_MODE = process.env.TESTING_MODE === 'true';
    const businessEmailDisplay = TESTING_MODE 
        ? process.env.BUSINESS_EMAIL_TEST || 'info@agcomponents.com.au'
        : process.env.BUSINESS_EMAIL;

    // ============================================================================
    // CUSTOMER EMAIL TEMPLATE (Only if sendCopyToCustomer is true)
    // ============================================================================
    const customerEmailContent = sendCopyToCustomer ? `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Cart Assistance Request</title>
        </head>
        <body style="margin: 0; padding: 0; font-family: Arial, sans-serif; background-color: #f4f4f4;">
            <div style="max-width: 600px; margin: 20px auto; background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
                <div style="background-color: #3498db; padding: 30px 20px; text-align: center;">
                    <h1 style="color: #ffffff; margin: 0; font-size: 28px;">Cart Sent Successfully!</h1>
                </div>
                <div style="padding: 30px 20px;">
                    <p style="font-size: 16px; color: #333333; margin-bottom: 20px;">
                        Hi ${userDetails.firstName} ${userDetails.lastName},
                    </p>
                    <p style="font-size: 16px; color: #333333; margin-bottom: 20px;">
                        Thank you for reaching out! We've received your cart and will review it shortly. Here's a copy for your records:
                    </p>
                    <div style="background-color: #e8f4f8; border-left: 4px solid #3498db; padding: 15px; margin: 20px 0;">
                        <p style="margin: 5px 0; color: #333333;"><strong>Request Number:</strong> #${cartNumber}</p>
                        <p style="margin: 5px 0; color: #333333;"><strong>Request Date:</strong> ${currentDate}</p>
                    </div>
                    
                    ${customerMessage ? `
                    <div style="background-color: #fff3cd; border-left: 4px solid #ffc107; padding: 15px; margin: 20px 0;">
                        <p style="margin: 0 0 5px 0; color: #856404; font-weight: bold;">Your Message:</p>
                        <p style="margin: 0; color: #856404;">${customerMessage}</p>
                    </div>
                    ` : ''}
                    
                    ${websiteProducts.length > 0 ? `
                    <h2 style="color: #3498db; font-size: 20px; margin-top: 30px; margin-bottom: 15px; border-bottom: 2px solid #3498db; padding-bottom: 10px;">
                        Website Products
                    </h2>
                    <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px;">
                        <thead>
                            <tr style="background-color: #f8f9fa;">
                                <th style="padding: 12px; text-align: left; border-bottom: 2px solid #dee2e6;">Product</th>
                                <th style="padding: 12px; text-align: center; border-bottom: 2px solid #dee2e6;">Qty</th>
                                <th style="padding: 12px; text-align: right; border-bottom: 2px solid #dee2e6;">Price</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${websiteProducts.map(product => `
                                <tr>
                                    <td style="padding: 12px; border-bottom: 1px solid #dee2e6;">
                                        ${product.image ? `<img src="${product.image}" alt="${product.name}" style="width: 50px; height: 50px; object-fit: cover; margin-right: 10px; vertical-align: middle; border-radius: 4px;">` : ''}
                                        <span style="vertical-align: middle;"><strong>${product.name}</strong></span>
                                    </td>
                                    <td style="padding: 12px; text-align: center; border-bottom: 1px solid #dee2e6;">${product.quantity}</td>
                                    <td style="padding: 12px; text-align: right; border-bottom: 1px solid #dee2e6;">$${(product.price * product.quantity).toFixed(2)}</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                    ` : ''}
                    
                    ${pwaOrders.length > 0 ? `
                    <h2 style="color: #3498db; font-size: 20px; margin-top: 30px; margin-bottom: 15px; border-bottom: 2px solid #3498db; padding-bottom: 10px;">
                        Custom Hose Assemblies
                    </h2>
                    <p style="font-size: 14px; color: #666;">&#x1F4CE; Detailed specifications attached as PDF files.</p>
                    ` : ''}
                    
                    ${trac360Orders && trac360Orders.length > 0 ? `
                    <h2 style="color: #3498db; font-size: 20px; margin-top: 30px; margin-bottom: 15px; border-bottom: 2px solid #3498db; padding-bottom: 10px;">
                        Custom Tractor Configurations
                    </h2>
                    <p style="font-size: 14px; color: #666;">&#x1F4CE; Detailed configurations attached as PDF files.</p>
                    ` : ''}

                    ${function360Orders && function360Orders.length > 0 ? `
                    <h2 style="color: #3498db; font-size: 20px; margin-top: 30px; margin-bottom: 15px; border-bottom: 2px solid #3498db; padding-bottom: 10px;">
                        Custom Hydraulic Function Kits
                    </h2>
                    <p style="font-size: 14px; color: #666;">&#x1F4CE; Detailed kit configurations attached as PDF files.</p>
                    ` : ''}
                    
                    <div style="background-color: #f8f9fa; padding: 20px; border-radius: 8px; margin-top: 30px;">
                        <table style="width: 100%; border-collapse: collapse;">
                            <tr>
                                <td style="padding: 8px 0; color: #333333;">Subtotal:</td>
                                <td style="padding: 8px 0; text-align: right; color: #333333;">$${totals.subtotal.toFixed(2)}</td>
                            </tr>
                            <tr>
                                <td style="padding: 8px 0; color: #333333;">GST (10%):</td>
                                <td style="padding: 8px 0; text-align: right; color: #333333;">$${totals.gst.toFixed(2)}</td>
                            </tr>
                            <tr style="border-top: 2px solid #dee2e6;">
                                <td style="padding: 12px 0; font-size: 18px; font-weight: bold; color: #3498db;">Estimated Total:</td>
                                <td style="padding: 12px 0; text-align: right; font-size: 18px; font-weight: bold; color: #3498db;">$${totals.total.toFixed(2)}</td>
                            </tr>
                        </table>
                    </div>
                    
                    <div style="margin-top: 30px; padding: 20px; background-color: #d4edda; border-radius: 8px;">
                        <h3 style="color: #155724; font-size: 18px; margin-top: 0;">What's Next?</h3>
                        <ul style="color: #333333; line-height: 1.8; margin: 10px 0; padding-left: 20px;">
                            <li>Our team will review your cart request</li>
                            <li>We'll contact you to discuss pricing and options</li>
                            <li>Your order will be processed upon receiving payment</li>
                        </ul>
                    </div>
                    
                    <div style="margin-top: 30px; text-align: center; color: #666666; font-size: 14px;">
                        <p>Questions? Contact us:</p>
                        <p style="color: #3498db; font-weight: bold;">${businessEmailDisplay}</p>
                    </div>
                </div>
                <div style="background-color: #333333; color: #ffffff; padding: 20px; text-align: center; font-size: 12px;">
                    <p style="margin: 0;">&copy; ${new Date().getFullYear()} FluidPower Group. All rights reserved.</p>
                </div>
            </div>
        </body>
        </html>
    ` : ''; // Empty string if customer doesn't want a copy

    // ============================================================================
    // BUSINESS EMAIL TEMPLATE (Always sent)
    // ============================================================================
    const businessEmailContent = `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Cart Assistance Request</title>
        </head>
        <body style="margin: 0; padding: 0; font-family: Arial, sans-serif; background-color: #f4f4f4;">
            <div style="max-width: 600px; margin: 20px auto; background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
                <div style="background-color: #e67e22; padding: 30px 20px; text-align: center;">
                    <h1 style="color: #ffffff; margin: 0; font-size: 28px;">&#x1F6D2; Cart Assistance Request</h1>
                    ${TESTING_MODE ? '<p style="color: #ffc107; margin: 10px 0 0 0; font-size: 16px;">&#x26A0;&#xFE0F; TEST MODE</p>' : ''}
                </div>
                <div style="padding: 30px 20px;">
                    <div style="background-color: #fff3cd; border-left: 4px solid #ffc107; padding: 15px; margin: 20px 0;">
                        <p style="margin: 5px 0; color: #856404;"><strong>Request Number:</strong> #${cartNumber}</p>
                        <p style="margin: 5px 0; color: #856404;"><strong>Request Date:</strong> ${currentDate}</p>
                        <p style="margin: 5px 0; color: #856404;"><strong>Customer wants copy:</strong> ${sendCopyToCustomer ? 'Yes' : 'No'}</p>
                    </div>
                    
                    <h2 style="color: #e67e22; font-size: 20px; margin-top: 30px; margin-bottom: 15px; border-bottom: 2px solid #e67e22; padding-bottom: 10px;">
                        Customer Information
                    </h2>
                    <div style="background-color: #f8f9fa; padding: 15px; border-radius: 8px;">
                        <p style="margin: 5px 0; color: #333333;"><strong>Name:</strong> ${userDetails.firstName} ${userDetails.lastName}</p>
                        ${userDetails.companyName ? `<p style="margin: 5px 0; color: #333333;"><strong>Company:</strong> ${userDetails.companyName}</p>` : ''}
                        <p style="margin: 5px 0; color: #333333;"><strong>Email:</strong> ${userDetails.email}</p>
                        <p style="margin: 5px 0; color: #333333;"><strong>Phone:</strong> ${userDetails.phone}</p>
                        <p style="margin: 5px 0; color: #333333;"><strong>Address:</strong> ${userDetails.address}, ${userDetails.city}, ${userDetails.state} ${userDetails.postcode}</p>
                    </div>
                    
                    ${customerMessage ? `
                    <h2 style="color: #e67e22; font-size: 20px; margin-top: 30px; margin-bottom: 15px; border-bottom: 2px solid #e67e22; padding-bottom: 10px;">
                        Customer Message
                    </h2>
                    <div style="background-color: #e8f4f8; border-left: 4px solid #3498db; padding: 15px; margin: 20px 0;">
                        <p style="margin: 0; color: #2c3e50; white-space: pre-wrap;">${customerMessage}</p>
                    </div>
                    ` : ''}
                    
                    ${websiteProducts.length > 0 ? `
                    <h2 style="color: #e67e22; font-size: 20px; margin-top: 30px; margin-bottom: 15px; border-bottom: 2px solid #e67e22; padding-bottom: 10px;">
                        Website Products (${websiteProducts.length})
                    </h2>
                    <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px;">
                        <thead>
                            <tr style="background-color: #2c3e50; color: #ffffff;">
                                <th style="padding: 12px; text-align: left;">Product</th>
                                <th style="padding: 12px; text-align: center;">Qty</th>
                                <th style="padding: 12px; text-align: right;">Price</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${websiteProducts.map(product => `
                                <tr style="border-bottom: 1px solid #dee2e6;">
                                    <td style="padding: 12px;">
                                        ${product.image ? `<img src="${product.image}" alt="${product.name}" style="width: 50px; height: 50px; object-fit: cover; margin-right: 10px; vertical-align: middle; border-radius: 4px;">` : ''}
                                        <span style="vertical-align: middle;"><strong>${product.name}</strong></span>
                                    </td>
                                    <td style="padding: 12px; text-align: center;">${product.quantity}</td>
                                    <td style="padding: 12px; text-align: right;">$${(product.price * product.quantity).toFixed(2)}</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                    ` : ''}
                    
                    ${pwaOrders.length > 0 ? `
                    <h2 style="color: #e67e22; font-size: 20px; margin-top: 30px; margin-bottom: 15px; border-bottom: 2px solid #e67e22; padding-bottom: 10px;">
                        Custom Hose Assemblies (${pwaOrders.length})
                    </h2>
                    <div style="background-color: #fff3cd; border-left: 4px solid #ffc107; padding: 15px; margin: 15px 0;">
                        <p style="margin: 0; color: #856404;">&#x1F4CE; <strong>Detailed specifications attached as PDF(s)</strong></p>
                    </div>
                    ` : ''}
                    
                    ${trac360Orders && trac360Orders.length > 0 ? `
                    <h2 style="color: #e67e22; font-size: 20px; margin-top: 30px; margin-bottom: 15px; border-bottom: 2px solid #e67e22; padding-bottom: 10px;">
                        Custom Tractor Configurations (${trac360Orders.length})
                    </h2>
                    <div style="background-color: #d4edda; border-left: 4px solid #28a745; padding: 15px; margin: 15px 0;">
                        <p style="margin: 0; color: #155724;">&#x1F69C; <strong>Tractor configurations attached as PDF(s)</strong></p>
                    </div>
                    ` : ''}

                    ${function360Orders && function360Orders.length > 0 ? `
                    <h2 style="color: #e67e22; font-size: 20px; margin-top: 30px; margin-bottom: 15px; border-bottom: 2px solid #e67e22; padding-bottom: 10px;">
                        Custom Hydraulic Function Kits (${function360Orders.length})
                    </h2>
                    <div style="background-color: #d1ecf1; border-left: 4px solid #17a2b8; padding: 15px; margin: 15px 0;">
                        <p style="margin: 0; color: #0c5460;">&#x1F527; <strong>Kit configurations attached as PDF(s)</strong></p>
                    </div>
                    ` : ''}
                    
                    <div style="background-color: #f8f9fa; padding: 20px; border-radius: 8px; margin-top: 30px;">
                        <h3 style="color: #2c3e50; margin-top: 0;">Estimated Cart Total</h3>
                        <table style="width: 100%; border-collapse: collapse;">
                            <tr>
                                <td style="padding: 8px 0; color: #333333;">Subtotal:</td>
                                <td style="padding: 8px 0; text-align: right; color: #333333;">$${totals.subtotal.toFixed(2)}</td>
                            </tr>
                            <tr>
                                <td style="padding: 8px 0; color: #333333;">GST (10%):</td>
                                <td style="padding: 8px 0; text-align: right; color: #333333;">$${totals.gst.toFixed(2)}</td>
                            </tr>
                            <tr style="border-top: 2px solid #dee2e6;">
                                <td style="padding: 12px 0; font-size: 18px; font-weight: bold; color: #e67e22;">Estimated Total:</td>
                                <td style="padding: 12px 0; text-align: right; font-size: 18px; font-weight: bold; color: #e67e22;">$${totals.total.toFixed(2)}</td>
                            </tr>
                        </table>
                    </div>
                    
                    <div style="margin-top: 30px; padding: 20px; background-color: #d4edda; border-radius: 8px; border-left: 4px solid #28a745;">
                        <h3 style="color: #155724; margin-top: 0;">&#x1F4CB; Action Items</h3>
                        <ul style="margin: 10px 0; padding-left: 20px;">
                            <li>Review customer message and cart details</li>
                            <li>Contact customer at ${userDetails.email} or ${userDetails.phone}</li>
                            <li>Discuss pricing, options, and next steps</li>
                            <li>Process order upon receiving payment confirmation</li>
                        </ul>
                    </div>
                </div>
            </div>
        </body>
        </html>
    `;

    return {
        customerEmailContent,
        businessEmailContent
    };
}
/**
 * Generate email templates for INVOICE DELIVERY
 * Professional invoice delivery emails for customer and business
 */
export function generateInvoiceEmailTemplates(invoiceData, customOrderPdfsCount = 0) {
    const currentDate = new Date().toLocaleDateString('en-AU', { 
        year: 'numeric', 
        month: 'long', 
        day: 'numeric' 
    });

    const TESTING_MODE = process.env.TESTING_MODE === 'true';
    const businessEmailDisplay = TESTING_MODE 
        ? process.env.BUSINESS_EMAIL_TEST || 'info@agcomponents.com.au'
        : process.env.BUSINESS_EMAIL;

    // Customer Email Template
    const customerEmailContent = `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <title>Invoice from FluidPower Group</title>
        </head>
        <body style="margin: 0; padding: 0; font-family: Arial, sans-serif; background-color: #f4f4f4;">
            <div style="max-width: 600px; margin: 20px auto; background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
                <div style="background-color: #2c3e50; padding: 30px 20px; text-align: center;">
                    <h1 style="color: #ffffff; margin: 0; font-size: 28px;">&#x1F4C4; Invoice from FluidPower Group</h1>
                </div>
                <div style="padding: 30px 20px;">
                    <p style="font-size: 16px; color: #333333;">Dear ${invoiceData.customer.name},</p>
                    <p style="font-size: 16px; color: #333333;">Please find attached your invoice from FluidPower Group.</p>
                    
                    <div style="background-color: #e8f4f8; border-left: 4px solid #3498db; padding: 15px; margin: 20px 0;">
                        <p style="margin: 5px 0; color: #333333;"><strong>Invoice Number:</strong> ${invoiceData.invoiceNumber}</p>
                        <p style="margin: 5px 0; color: #333333;"><strong>Total Amount Due:</strong> $${invoiceData.total.toFixed(2)}</p>
                        <p style="margin: 5px 0; color: #333333;"><strong>Due Date:</strong> ${new Date(invoiceData.dueDate).toLocaleDateString('en-AU')}</p>
                    </div>
                    
                    ${customOrderPdfsCount > 0 ? `
                    <div style="background-color: #d4edda; border-left: 4px solid #28a745; padding: 15px; margin: 20px 0;">
                        <h3 style="color: #155724; margin-top: 0;">&#x1F4CE; Attached Documents</h3>
                        <p style="margin: 5px 0; color: #155724;">This invoice includes <strong>${customOrderPdfsCount + 1} PDF attachment(s)</strong>:</p>
                        <ul style="color: #155724; margin: 10px 0; padding-left: 20px;">
                            <li>Invoice (${invoiceData.invoiceNumber}.pdf)</li>
                            <li>${customOrderPdfsCount} Custom Order Specification(s)</li>
                        </ul>
                        <p style="margin: 5px 0; color: #155724; font-size: 14px;">
                            <em>Custom order PDFs contain detailed specifications for your hose assemblies, tractor configurations, or function kits.</em>
                        </p>
                    </div>
                    ` : ''}
                    
                    <div style="background-color: #fff3cd; border-left: 4px solid #ffc107; padding: 15px; margin: 20px 0;">
                        <h3 style="color: #856404; margin-top: 0;">Payment Details</h3>
                        <p style="margin: 5px 0; color: #856404;"><strong>Account:</strong> FluidPower Group Pty Ltd</p>
                        <p style="margin: 5px 0; color: #856404;"><strong>BSB:</strong> 063 531</p>
                        <p style="margin: 5px 0; color: #856404;"><strong>Account Number:</strong> 1059 0324</p>
                        <p style="margin: 10px 0 5px 0; color: #856404;"><strong>Reference:</strong> ${invoiceData.invoiceNumber}</p>
                    </div>
                    
                    <p style="font-size: 14px; color: #666666; text-align: center; margin-top: 30px;">
                        Questions? Contact us at ${businessEmailDisplay}
                    </p>
                </div>
            </div>
        </body>
        </html>
    `;

    // Business Email Template
    const businessEmailContent = `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <title>Invoice Sent Confirmation</title>
        </head>
        <body style="margin: 0; padding: 0; font-family: Arial, sans-serif; background-color: #f4f4f4;">
            <div style="max-width: 600px; margin: 20px auto; background-color: #ffffff; border-radius: 8px; overflow: hidden;">
                <div style="background-color: #28a745; padding: 30px 20px; text-align: center;">
                    <h1 style="color: #ffffff; margin: 0;">&#x2705; Invoice Sent Successfully</h1>
                </div>
                <div style="padding: 30px 20px;">
                    <p><strong>Invoice Number:</strong> ${invoiceData.invoiceNumber}</p>
                    <p><strong>Customer:</strong> ${invoiceData.customer.name} (${invoiceData.customer.email})</p>
                    <p><strong>Total:</strong> $${invoiceData.total.toFixed(2)}</p>
                    
                    ${customOrderPdfsCount > 0 ? `
                    <div style="background-color: #d1ecf1; border-left: 4px solid #17a2b8; padding: 15px; margin: 20px 0;">
                        <p style="margin: 0; color: #0c5460;">
                            <strong>&#x1F4CE; Attachments:</strong> ${customOrderPdfsCount + 1} PDF file(s) sent<br>
                            <small>Invoice + ${customOrderPdfsCount} custom order specification(s)</small>
                        </p>
                    </div>
                    ` : ''}
                    
                    <p style="font-size: 14px; color: #666666; margin-top: 20px;">
                        Invoice copy attached to this email for your records.
                    </p>
                </div>
            </div>
        </body>
        </html>
    `;

    return {
        customerEmailContent,
        businessEmailContent
    };
}
/**
 * Generate email templates for QUOTATION DELIVERY
 */
export function generateQuoteEmailTemplates(quoteData) {
    const currentDate = new Date().toLocaleDateString('en-AU', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
    });

    const expiryDate = new Date(quoteData.expiryDate).toLocaleDateString('en-AU', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
    });

    const TESTING_MODE = process.env.TESTING_MODE === 'true';
    const businessEmailDisplay = TESTING_MODE
        ? process.env.BUSINESS_EMAIL_TEST || 'info@agcomponents.com.au'
        : process.env.BUSINESS_EMAIL;
    const businessPhoneDisplay = '+61 409 517 333';

    // Customer Email Template
    const customerEmailContent = `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <title>Quotation from FluidPower Group</title>
        </head>
        <body style="margin: 0; padding: 0; font-family: Arial, sans-serif; background-color: #f4f4f4;">
            <div style="max-width: 600px; margin: 20px auto; background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
                <div style="background-color: #6d28d9; padding: 30px 20px; text-align: center;">
                    <h1 style="color: #ffffff; margin: 0; font-size: 28px;">&#x1F4CB; Quotation from FluidPower Group</h1>
                </div>
                <div style="padding: 30px 20px;">
                    <p style="font-size: 16px; color: #333333;">Dear ${quoteData.customer.name},</p>
                    <p style="font-size: 16px; color: #333333;">Please find attached your quotation from FluidPower Group.</p>

                    <div style="background-color: #f3e8ff; border-left: 4px solid #7c3aed; padding: 15px; margin: 20px 0;">
                        <p style="margin: 5px 0; color: #333333;"><strong>Quote Number:</strong> ${quoteData.quoteNumber}</p>
                        <p style="margin: 5px 0; color: #333333;"><strong>Total Amount:</strong> $${quoteData.total.toFixed(2)}</p>
                        <p style="margin: 5px 0; color: #333333;"><strong>Valid Until:</strong> ${expiryDate}</p>
                    </div>

                    <div style="background-color: #fff3cd; border-left: 4px solid #ffc107; padding: 15px; margin: 20px 0;">
                        <h3 style="color: #856404; margin-top: 0;">To Accept This Quote</h3>
                        <p style="margin: 5px 0; color: #856404;">
                            Please reply to this email or contact us at <strong>${businessEmailDisplay}</strong> to confirm your order.
                        </p>
                        <p style="margin: 5px 0; color: #856404;">
                            Or call us on <strong><a href="tel:${businessPhoneDisplay.replace(/\s/g, '')}" style="color: #856404; text-decoration: underline;">${businessPhoneDisplay}</a></strong>.
                        </p>
                        <p style="margin: 5px 0; color: #856404; font-size: 14px;">
                            <em>This quotation is valid until ${expiryDate}. Prices may change after this date.</em>
                        </p>
                    </div>

                    <p style="font-size: 14px; color: #666666; text-align: center; margin-top: 30px;">
                        Questions? Contact us at ${businessEmailDisplay} or <a href="tel:${businessPhoneDisplay.replace(/\s/g, '')}" style="color: #666666; text-decoration: underline;">${businessPhoneDisplay}</a>
                    </p>
                </div>
            </div>
        </body>
        </html>
    `;

    // Business Email Template (carbon copy &#x2014; matches customer email content exactly)
    const businessEmailContent = `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <title>Quotation from FluidPower Group</title>
        </head>
        <body style="margin: 0; padding: 0; font-family: Arial, sans-serif; background-color: #f4f4f4;">
            <div style="max-width: 600px; margin: 20px auto; background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
                <div style="background-color: #6d28d9; padding: 30px 20px; text-align: center;">
                    <h1 style="color: #ffffff; margin: 0; font-size: 28px;">&#x1F4CB; Quotation from FluidPower Group</h1>
                </div>
                <div style="padding: 30px 20px;">
                    <p style="font-size: 16px; color: #333333;">Dear ${quoteData.customer.name},</p>
                    <p style="font-size: 16px; color: #333333;">Please find attached your quotation from FluidPower Group.</p>

                    <div style="background-color: #f3e8ff; border-left: 4px solid #7c3aed; padding: 15px; margin: 20px 0;">
                        <p style="margin: 5px 0; color: #333333;"><strong>Quote Number:</strong> ${quoteData.quoteNumber}</p>
                        <p style="margin: 5px 0; color: #333333;"><strong>Total Amount:</strong> $${quoteData.total.toFixed(2)}</p>
                        <p style="margin: 5px 0; color: #333333;"><strong>Valid Until:</strong> ${expiryDate}</p>
                    </div>

                    <div style="background-color: #fff3cd; border-left: 4px solid #ffc107; padding: 15px; margin: 20px 0;">
                        <h3 style="color: #856404; margin-top: 0;">To Accept This Quote</h3>
                        <p style="margin: 5px 0; color: #856404;">
                            Please reply to this email or contact us at <strong>${businessEmailDisplay}</strong> to confirm your order.
                        </p>
                        <p style="margin: 5px 0; color: #856404;">
                            Or call us on <strong><a href="tel:${businessPhoneDisplay.replace(/\s/g, '')}" style="color: #856404; text-decoration: underline;">${businessPhoneDisplay}</a></strong>.
                        </p>
                        <p style="margin: 5px 0; color: #856404; font-size: 14px;">
                            <em>This quotation is valid until ${expiryDate}. Prices may change after this date.</em>
                        </p>
                    </div>

                    <p style="font-size: 14px; color: #666666; text-align: center; margin-top: 30px;">
                        Questions? Contact us at ${businessEmailDisplay} or <a href="tel:${businessPhoneDisplay.replace(/\s/g, '')}" style="color: #666666; text-decoration: underline;">${businessPhoneDisplay}</a>
                    </p>
                </div>
            </div>
        </body>
        </html>
    `;

    return {
        customerEmailContent,
        businessEmailContent
    };
}

// ============================================================================
// SAVED CART ("save cart for later") EMAIL TEMPLATES
// ============================================================================
// Symbols are ASCII HTML numeric entities on purpose (immune to source
// re-encoding / mojibake) - see the order-confirmation templates above.
export function generateSavedCartEmailTemplates(cart, options = {}) {
    const items = Array.isArray(cart && cart.items) ? cart.items : [];
    const {
        customerName = '',
        checkoutUrl = '#',
        catalogueUrl = '#',
        priceHoldUntil = '',
        businessEmailDisplay = process.env.BUSINESS_EMAIL_TEST || 'info@agcomponents.com.au',
        businessPhoneDisplay = '',
        testingMode = false,
    } = options;

    const money = (n) => `A$${(Number(n) || 0).toFixed(2)}`;
    const lineTotal = (it) =>
        (it && it.type && it.type !== 'website_product')
            ? (Number(it.totalPrice) || 0)
            : (Number(it.price) || 0) * (Number(it.quantity) || 1);
    const estimatedSubtotal = items.reduce((sum, it) => sum + lineTotal(it), 0);
    const esc = (s) => String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    const rows = items.map((it) => `
        <tr>
            <td style="padding: 12px; border-bottom: 1px solid #dee2e6;">${esc(it.name || 'Item')}</td>
            <td style="padding: 12px; border-bottom: 1px solid #dee2e6; text-align: center;">${Number(it.quantity) || 1}</td>
            <td style="padding: 12px; border-bottom: 1px solid #dee2e6; text-align: right;">${money(lineTotal(it))}</td>
        </tr>`).join('');

    const itemsTable = `
        <table style="width: 100%; border-collapse: collapse; margin: 8px 0 4px 0;">
            <thead>
                <tr style="background-color: #f8f9fa;">
                    <th style="padding: 12px; text-align: left; font-size: 13px; color: #333;">Item</th>
                    <th style="padding: 12px; text-align: center; font-size: 13px; color: #333;">Qty</th>
                    <th style="padding: 12px; text-align: right; font-size: 13px; color: #333;">Price</th>
                </tr>
            </thead>
            <tbody>${rows}</tbody>
        </table>
        <p style="text-align: right; font-size: 16px; font-weight: bold; margin: 8px 0; color: #111;">
            Estimated subtotal: ${money(estimatedSubtotal)}
        </p>`;

    const testBanner = testingMode
        ? '<p style="margin: 10px 0 0 0; color: #ffc107; font-size: 14px;">&#x26A0;&#xFE0F; TEST MODE - This is a test cart</p>'
        : '';

    const priceNote = priceHoldUntil
        ? `We&#x2019;ll honour today&#x2019;s pricing until <strong>${esc(priceHoldUntil)}</strong>; after that, current pricing applies. Final totals (incl. GST and shipping) are calculated at checkout.`
        : `Final totals (incl. GST and shipping) are calculated at checkout.`;

    // ---- Customer email --------------------------------------------------------
    const customerEmailContent = `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
        </head>
        <body style="margin: 0; padding: 0; background-color: #f4f4f4; font-family: Arial, Helvetica, sans-serif;">
            <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff;">
                <div style="background: linear-gradient(135deg, #1a1a1a 0%, #333333 100%); padding: 30px; text-align: center;">
                    <h1 style="color: #ffffff; margin: 0; font-size: 26px;">&#x1F6D2; Your cart is saved</h1>
                    ${testBanner}
                </div>
                <div style="padding: 30px;">
                    <p style="font-size: 16px; color: #333333;">Hi${customerName ? ' ' + esc(customerName) : ''},</p>
                    <p style="font-size: 15px; color: #555555; line-height: 1.6;">
                        Busy day? No problem. We&#x2019;ve saved the items below so you can pick up right where you
                        left off &#x2014; same cart, same price promise.
                    </p>

                    <h3 style="color: #d32f2f; border-bottom: 2px solid #d32f2f; padding-bottom: 6px;">Your Saved Items</h3>
                    ${itemsTable}
                    <p style="font-size: 13px; color: #777777; line-height: 1.6;">${priceNote}</p>

                    <div style="text-align: center; margin: 32px 0 8px 0;">
                        <a href="${checkoutUrl}" style="display: inline-block; background-color: #111111; color: #ffffff; text-decoration: none; font-weight: bold; font-size: 16px; padding: 14px 34px; border-radius: 40px; margin: 6px;">Proceed to Checkout</a>
                    </div>
                    <div style="text-align: center; margin: 0 0 8px 0;">
                        <a href="${catalogueUrl}" style="display: inline-block; background-color: #facc15; color: #111111; text-decoration: none; font-weight: bold; font-size: 16px; padding: 14px 34px; border-radius: 40px; margin: 6px;">Continue Shopping</a>
                    </div>

                    <p style="font-size: 13px; color: #999999; text-align: center; margin-top: 24px; line-height: 1.6;">
                        This link will keep your cart${priceHoldUntil ? ' available for the next 30 days' : ''}. If a button doesn&#x2019;t work, copy this link into your browser:<br>
                        <span style="word-break: break-all; color: #666666;">${checkoutUrl}</span>
                    </p>
                    <p style="font-size: 13px; color: #999999; text-align: center; margin-top: 16px;">
                        Questions? Contact us at ${businessEmailDisplay}${businessPhoneDisplay ? ` or <a href="tel:${String(businessPhoneDisplay).replace(/\s/g, '')}" style="color: #666666;">${businessPhoneDisplay}</a>` : ''}.
                    </p>
                </div>
                <div style="background-color: #1a1a1a; padding: 20px; text-align: center;">
                    <p style="color: #ffffff; margin: 0; font-size: 12px;">&#xA9; ${new Date().getFullYear()} FluidPower Group. All rights reserved.</p>
                </div>
            </div>
        </body>
        </html>
    `;

    // ---- Business notification --------------------------------------------------
    const businessEmailContent = `
        <!DOCTYPE html>
        <html>
        <head><meta charset="UTF-8"></head>
        <body style="margin: 0; padding: 0; background-color: #f4f4f4; font-family: Arial, Helvetica, sans-serif;">
            <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff;">
                <div style="background: linear-gradient(135deg, #1a1a1a 0%, #333333 100%); padding: 24px; text-align: center;">
                    <h1 style="color: #ffffff; margin: 0; font-size: 22px;">&#x1F6D2; Cart saved for later</h1>
                    ${testBanner}
                </div>
                <div style="padding: 24px;">
                    <p style="font-size: 15px; color: #333333;">
                        <strong>${customerName ? esc(customerName) : 'A customer'}</strong> just saved items to their cart to continue later.
                    </p>
                    ${itemsTable}
                    <p style="font-size: 13px; color: #777777;">No action required &#x2014; this is a heads-up in case they reach out for help completing the order.</p>
                </div>
            </div>
        </body>
        </html>
    `;

    return { customerEmailContent, businessEmailContent };
}